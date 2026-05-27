import { PenLine, Ruler, Sparkles, Target, Trash2 } from "lucide-react";
import { useEffect, useState } from "react";
import type { MouseEvent, PointerEvent, ReactNode, WheelEvent } from "react";
import { bodyMassEstimate, bodyMaterialLabels, bodySurfaceAreaEstimate, computeSizingAnalysis, roleLabels, shapeBounds } from "./sizingEngine";
import type {
  BodyMaterial,
  SizePoint,
  SizeShape,
  SizeShapeRole,
  SizingAnalysis,
  SizingProject,
} from "./sizingEngine";

export { defaultSizingProject, normalizeSizingProject } from "./sizingEngine";
export type {
  SizePoint,
  SizeShape,
  SizeShapeRole,
  SizingAnalysis,
  SizingProject,
} from "./sizingEngine";

const baseCanvasView: CanvasView = { width: 900, height: 720, originX: 450, originY: 72, scale: 190 };
const scaleUnits = ["cm", "m", "mm"] as const;
type ScaleUnit = (typeof scaleUnits)[number];

export function SizeWorkspace({
  sizing,
  onChange,
  onOpenVspAnalysis,
}: {
  sizing: SizingProject;
  onChange: (next: SizingProject) => void;
  onOpenVspAnalysis?: () => void | Promise<void>;
}) {
  const [draftPoints, setDraftPoints] = useState<SizePoint[]>([]);
  const [draftPreviewPoint, setDraftPreviewPoint] = useState<SizePoint | null>(null);
  const [extendingShapeId, setExtendingShapeId] = useState<string | null>(null);
  const [drawActive, setDrawActive] = useState(false);
  const [undoStack, setUndoStack] = useState<SizingProject[]>([]);
  const selected = sizing.shapes.find((shape) => shape.id === sizing.selectedShapeId);
  const activeRole = sizing.activeRole ?? "body";

  useEffect(() => {
    function handleUndo(event: KeyboardEvent) {
      if (!(event.ctrlKey || event.metaKey) || event.key.toLowerCase() !== "z" || event.shiftKey) return;
      const target = event.target as HTMLElement | null;
      if (target?.closest("input, textarea, select")) return;
      event.preventDefault();
      setUndoStack((stack) => {
        const previous = stack[stack.length - 1];
        if (!previous) return stack;
        onChange(cloneSizingProject(previous));
        return stack.slice(0, -1);
      });
    }
    window.addEventListener("keydown", handleUndo);
    return () => window.removeEventListener("keydown", handleUndo);
  }, [onChange]);

  function update(next: Partial<SizingProject>, undoable = true) {
    if (undoable) {
      setUndoStack((stack) => [...stack.slice(-49), cloneSizingProject(sizing)]);
    }
    onChange({ ...sizing, ...next });
  }

  function updateShapes(shapes: SizeShape[], selectedShapeId = sizing.selectedShapeId) {
    update({ shapes, selectedShapeId, analysis: undefined });
  }

  function updateSelected(patch: Partial<SizeShape>) {
    if (!selected) return;
    updateShapes(sizing.shapes.map((shape) => (shape.id === selected.id ? { ...shape, ...patch } : shape)));
  }

  function addDraftPoint(point: SizePoint) {
    const snapped = snapToExistingNode(point, sizing.shapes);
    const nextPoint = {
      ...(snapped?.point ?? point),
      curveMode: snapped?.point.curveMode ?? point.curveMode,
    };
    const normalizedPoint = {
      ...point,
      ...nextPoint,
      curveMode: nextPoint.curveMode ?? ("corner" as const),
    };
    if (!draftPoints.length && snapped && snapped.shape.role === activeRole && isEndpoint(snapped.shape, snapped.index)) {
      const points = snapped.index === 0 ? [...snapped.shape.points].reverse() : snapped.shape.points;
      setExtendingShapeId(snapped.shape.id);
      update({ selectedShapeId: snapped.shape.id }, false);
      setDraftPoints(points.map((entry) => ({ ...entry, curveMode: entry.curveMode ?? "spline" })));
      return;
    }
    setDraftPoints((points) => [...points, normalizedPoint]);
  }

  function finishShape() {
    if (draftPoints.length < 2) {
      setDrawActive(false);
      return;
    }
    const extendingShape = extendingShapeId ? sizing.shapes.find((shape) => shape.id === extendingShapeId) : undefined;
    const count = sizing.shapes.filter((shape) => shape.role === activeRole).length + 1;
    const shape: SizeShape = {
      id: extendingShape?.id ?? `${activeRole}-${crypto.randomUUID()}`,
      role: extendingShape?.role ?? activeRole,
      label: extendingShape?.label ?? `${roleLabels[activeRole]} ${count}`,
      drawMode: "spline",
      points: closeIfNearCenterline(draftPoints),
      airfoil: extendingShape?.airfoil ?? (activeRole === "liftingSurface" ? "NACA 0012" : undefined),
      massKg: extendingShape?.massKg ?? (activeRole === "body" ? 0.5 : 0.15),
      bodyMaterial: extendingShape?.bodyMaterial ?? (activeRole === "body" ? "carbonFibre" : undefined),
      bodyThicknessMm: extendingShape?.bodyThicknessMm ?? (activeRole === "body" ? 1.2 : undefined),
    };
    setDraftPoints([]);
    setDraftPreviewPoint(null);
    setExtendingShapeId(null);
    setDrawActive(false);
    updateShapes(
      extendingShape ? sizing.shapes.map((entry) => (entry.id === extendingShape.id ? shape : entry)) : [...sizing.shapes, shape],
      shape.id,
    );
  }

  function cancelDraft() {
    setDraftPoints([]);
    setDraftPreviewPoint(null);
    setExtendingShapeId(null);
    setDrawActive(false);
  }

  function toggleDraftPoint(index: number) {
    setDraftPoints((points) =>
      points.map((point, pointIndex) =>
        pointIndex === index
          ? { ...point, curveMode: point.curveMode === "corner" ? ("spline" as const) : ("corner" as const) }
          : point,
      ),
    );
  }

  function toggleShapePoint(shapeId: string, index: number) {
    const shapes: SizeShape[] = sizing.shapes.map((shape) =>
      shape.id === shapeId
        ? {
            ...shape,
            points: shape.points.map((point, pointIndex) =>
              pointIndex === index
                ? { ...point, curveMode: point.curveMode === "corner" ? "spline" as const : "corner" as const }
                : point,
            ),
          }
        : shape,
    );
    updateShapes(shapes, shapeId);
  }

  function moveDraftPoint(index: number, point: SizePoint) {
    setDraftPoints((points) =>
      points.map((entry, pointIndex) =>
        pointIndex === index ? { ...entry, xM: Math.abs(point.xM), yM: point.yM } : entry,
      ),
    );
  }

  function moveShapePoint(shapeId: string, index: number, point: SizePoint) {
    updateShapes(
      sizing.shapes.map((shape) =>
        shape.id === shapeId
          ? {
              ...shape,
              points: shape.points.map((entry, pointIndex) =>
                pointIndex === index ? { ...entry, xM: Math.abs(point.xM), yM: point.yM } : entry,
              ),
            }
          : shape,
      ),
      shapeId,
    );
  }

  function setDraftSegmentMode(index: number, side: "in" | "out", mode: "corner" | "spline") {
    setDraftPoints((points) => setSegmentMode(points, index, side, mode));
  }

  function setShapeSegmentMode(shapeId: string, index: number, side: "in" | "out", mode: "corner" | "spline") {
    updateShapes(
      sizing.shapes.map((shape) =>
        shape.id === shapeId ? { ...shape, points: setSegmentMode(shape.points, index, side, mode) } : shape,
      ),
      shapeId,
    );
  }

  function moveDraftTangent(index: number, side: "in" | "out", point: SizePoint) {
    setDraftPoints((points) => setTangentVector(points, index, side, point));
  }

  function moveShapeTangent(shapeId: string, index: number, side: "in" | "out", point: SizePoint) {
    updateShapes(
      sizing.shapes.map((shape) =>
        shape.id === shapeId ? { ...shape, points: setTangentVector(shape.points, index, side, point) } : shape,
      ),
      shapeId,
    );
  }

  function removeSelected() {
    if (!selected) return;
    const shapes = sizing.shapes.filter((shape) => shape.id !== selected.id);
    updateShapes(shapes, shapes[0]?.id ?? "");
  }

  function compute() {
    update({ analysis: computeSizingAnalysis(sizing) }, false);
  }

  return (
    <main className="size-workspace sizing-sketch-workspace">
      <aside className="size-panel sizing-left-panel">
        <SizePanelTitle icon={<PenLine size={18} />} title="Sketch" />
        <div className="sizing-hint">
          Use Draw on the canvas to place points. Done commits the line. Then drag nodes and use half-moons to choose line or spline per side.
        </div>

        <button className="compute-button" onClick={compute}>
          <Sparkles size={16} />
          Compute
        </button>
        <button className="compute-button" onClick={() => void onOpenVspAnalysis?.()}>
          <Sparkles size={16} />
          OpenVSP
        </button>
      </aside>

      <section className="size-canvas-panel sizing-canvas-panel">
        <SizingCanvas
          analysis={sizing.analysis}
          draftPoints={draftPoints}
          draftPreviewPoint={draftPreviewPoint}
          draftRole={activeRole}
          drawActive={drawActive}
          onActiveRoleChange={(activeRole) => update({ activeRole }, false)}
          onCancel={cancelDraft}
          onAddPoint={addDraftPoint}
          onDone={finishShape}
          onSelect={(selectedShapeId) => update({ selectedShapeId }, false)}
          onSetPreviewPoint={setDraftPreviewPoint}
          onSetDrawActive={(active) => {
            if (active) setDraftPreviewPoint(null);
            setDrawActive(active);
          }}
          onMoveDraftPoint={moveDraftPoint}
          onMoveShapePoint={moveShapePoint}
          onMoveDraftTangent={moveDraftTangent}
          onMoveShapeTangent={moveShapeTangent}
          onSetDraftSegmentMode={setDraftSegmentMode}
          onSetShapeSegmentMode={setShapeSegmentMode}
          onToggleDraftPoint={toggleDraftPoint}
          onToggleShapePoint={toggleShapePoint}
          selectedShapeId={sizing.selectedShapeId}
          shapes={sizing.shapes}
        />
      </section>

      <aside className="size-panel sizing-right-panel">
        <SizePanelTitle icon={<Ruler size={18} />} title="Shape" />
        {selected ? (
          <ShapeEditor shape={selected} onChange={updateSelected} onDelete={removeSelected} />
        ) : (
          <p className="empty-text">Draw a body or lifting surface to edit it.</p>
        )}

        <SizePanelTitle icon={<Target size={18} />} title="Compute" />
        {sizing.analysis ? <AnalysisPanel analysis={sizing.analysis} /> : <p className="empty-text">Press Compute to update sizing estimates.</p>}
      </aside>
    </main>
  );
}

export function SizingSummaryFooter({ analysis }: { analysis?: SizingAnalysis }) {
  if (!analysis) {
    return (
      <>
        <span>Run Compute</span>
        <span>CoM, CoP, inertia, CL, CD, L/D, stall speed</span>
      </>
    );
  }
  return (
    <>
      <span>MTOW {analysis.totalMassKg.toFixed(1)} kg</span>
      <span>Static margin {analysis.staticMarginPct.toFixed(1)}%</span>
      <span>L/D {analysis.liftDragRatio.toFixed(1)}</span>
      <span>Energy margin {analysis.energyMarginWh.toFixed(0)} Wh</span>
      {analysis.warnings[0] ? <span className="sizing-warning-text">{analysis.warnings[0]}</span> : null}
    </>
  );
}

function SizePanelTitle({ icon, title }: { icon: ReactNode; title: string }) {
  return (
    <h2 className="panel-title">
      {icon}
      {title}
    </h2>
  );
}

function ShapeEditor({
  shape,
  onChange,
  onDelete,
}: {
  shape: SizeShape;
  onChange: (patch: Partial<SizeShape>) => void;
  onDelete: () => void;
}) {
  const bounds = shapeBounds(shape);
  return (
    <div className="component-editor">
      <label className="sizing-field">
        <span>Label</span>
        <input value={shape.label} onChange={(event) => onChange({ label: event.target.value })} />
      </label>
      <div className="segmented-control sizing-role-control" aria-label="Selected shape type">
        <button className={shape.role === "body" ? "active" : ""} onClick={() => onChange({ role: "body", airfoil: undefined })}>
          Body
        </button>
        <button
          className={shape.role === "liftingSurface" ? "active" : ""}
          onClick={() => onChange({ role: "liftingSurface", airfoil: shape.airfoil ?? "NACA 0012" })}
        >
          Lifting surface
        </button>
      </div>
      {shape.role === "liftingSurface" ? (
        <label className="sizing-field">
          <span>Aerofoil</span>
          <input value={shape.airfoil ?? ""} onChange={(event) => onChange({ airfoil: event.target.value })} placeholder="NACA 0012" />
        </label>
      ) : (
        <>
          <label className="sizing-field">
            <span>Material</span>
            <select
              value={shape.bodyMaterial ?? "carbonFibre"}
              onChange={(event) => onChange({ bodyMaterial: event.target.value as BodyMaterial })}
            >
              {Object.entries(bodyMaterialLabels).map(([value, label]) => (
                <option key={value} value={value}>
                  {label}
                </option>
              ))}
            </select>
          </label>
          <NumberField
            label="Thickness"
            suffix="mm"
            value={shape.bodyThicknessMm ?? 1.2}
            step={0.1}
            onChange={(bodyThicknessMm) => onChange({ bodyThicknessMm })}
          />
          <div className="shape-readout">
            <span>Surface area {bodySurfaceAreaEstimate(shape).toFixed(3)} m2</span>
            <span>Body mass {bodyMassEstimate(shape).toFixed(3)} kg</span>
          </div>
        </>
      )}
      {shape.role === "liftingSurface" ? (
        <NumberField label="Surface mass" suffix="kg" value={shape.massKg ?? 0} onChange={(massKg) => onChange({ massKg })} />
      ) : null}
      <div className="shape-readout">
        <span>{shape.points.length} points</span>
        <span>{(bounds.maxX * 2).toFixed(2)} m mirrored width</span>
        <span>{(bounds.maxY - bounds.minY).toFixed(2)} m length</span>
      </div>
      <button className="delete-component-button" onClick={onDelete}>
        <Trash2 size={15} />
        Delete shape
      </button>
    </div>
  );
}

function NumberField({
  label,
  suffix,
  value,
  step = 0.01,
  onChange,
}: {
  label: string;
  suffix: string;
  value: number;
  step?: number;
  onChange: (value: number) => void;
}) {
  return (
    <label className="sizing-field">
      <span>{label}</span>
      <div>
        <input
          type="number"
          step={step}
          value={Number.isFinite(value) ? value : 0}
          onChange={(event) => onChange(Number(event.target.value))}
        />
        {suffix ? <em>{suffix}</em> : null}
      </div>
    </label>
  );
}

function AnalysisPanel({ analysis }: { analysis: SizingAnalysis }) {
  return (
    <div className="analysis-panel">
      <Metric label="CoM" value={`${analysis.com.xM.toFixed(2)}, ${analysis.com.yM.toFixed(2)} m`} />
      <Metric label="CoP" value={`${analysis.cop.xM.toFixed(2)}, ${analysis.cop.yM.toFixed(2)} m`} />
      <Metric label="Static margin" value={`${analysis.staticMarginPct.toFixed(1)}%`} />
      <Metric label="Ix roll" value={`${analysis.inertia.rollKgM2.toFixed(2)} kg m2`} />
      <Metric label="Iy pitch" value={`${analysis.inertia.pitchKgM2.toFixed(2)} kg m2`} />
      <Metric label="Iz yaw" value={`${analysis.inertia.yawKgM2.toFixed(2)} kg m2`} />
      <Metric label="CL cruise" value={analysis.clCruise.toFixed(2)} />
      <Metric label="CD estimate" value={analysis.cdEstimate.toFixed(3)} />
      <Metric label="L/D" value={analysis.liftDragRatio.toFixed(1)} />
      <Metric label="Wing loading" value={`${analysis.wingLoadingKgM2.toFixed(1)} kg/m2`} />
      <Metric label="Thrust/weight" value={analysis.thrustToWeight.toFixed(2)} />
      <Metric label="Stall speed" value={`${analysis.stallSpeedMS.toFixed(1)} m/s`} />
      <Metric label="Battery margin" value={`${analysis.energyMarginWh.toFixed(0)} Wh`} />
      {analysis.warnings.length ? (
        <div className="analysis-warnings">
          {analysis.warnings.map((warning) => <span key={warning}>{warning}</span>)}
        </div>
      ) : null}
    </div>
  );
}

function Metric({ label, value }: { label: string; value: string }) {
  return (
    <div className="analysis-metric">
      <span>{label}</span>
      <strong>{value}</strong>
    </div>
  );
}

function SizingCanvas({
  shapes,
  selectedShapeId,
  draftPoints,
  draftPreviewPoint,
  draftRole,
  drawActive,
  analysis,
  onAddPoint,
  onActiveRoleChange,
  onCancel,
  onDone,
  onSelect,
  onSetDrawActive,
  onSetPreviewPoint,
  onMoveDraftPoint,
  onMoveShapePoint,
  onMoveDraftTangent,
  onMoveShapeTangent,
  onSetDraftSegmentMode,
  onSetShapeSegmentMode,
  onToggleDraftPoint,
  onToggleShapePoint,
}: {
  shapes: SizeShape[];
  selectedShapeId: string;
  draftPoints: SizePoint[];
  draftPreviewPoint: SizePoint | null;
  draftRole: SizeShapeRole;
  drawActive: boolean;
  analysis?: SizingAnalysis;
  onAddPoint: (point: SizePoint) => void;
  onActiveRoleChange: (role: SizeShapeRole) => void;
  onCancel: () => void;
  onDone: () => void;
  onSelect: (id: string) => void;
  onSetDrawActive: (active: boolean) => void;
  onSetPreviewPoint: (point: SizePoint | null) => void;
	  onMoveDraftPoint: (index: number, point: SizePoint) => void;
	  onMoveShapePoint: (shapeId: string, index: number, point: SizePoint) => void;
	  onMoveDraftTangent: (index: number, side: "in" | "out", point: SizePoint) => void;
	  onMoveShapeTangent: (shapeId: string, index: number, side: "in" | "out", point: SizePoint) => void;
	  onSetDraftSegmentMode: (index: number, side: "in" | "out", mode: "corner" | "spline") => void;
	  onSetShapeSegmentMode: (shapeId: string, index: number, side: "in" | "out", mode: "corner" | "spline") => void;
	  onToggleDraftPoint: (index: number) => void;
	  onToggleShapePoint: (shapeId: string, index: number) => void;
}) {
  const [dragTarget, setDragTarget] = useState<
	    | { kind: "draft"; index: number; pointerId: number }
	    | { kind: "shape"; shapeId: string; index: number; pointerId: number }
	    | { kind: "draftTangent"; index: number; side: "in" | "out"; pointerId: number }
	    | { kind: "shapeTangent"; shapeId: string; index: number; side: "in" | "out"; pointerId: number }
	    | null
	  >(null);
  const [canvasView, setCanvasView] = useState<CanvasView>(baseCanvasView);
  const [scaleUnit, setScaleUnit] = useState<ScaleUnit>("cm");
  const [canvasCursorPoint, setCanvasCursorPoint] = useState<SizePoint | null>(null);

  function pointFromEvent(event: MouseEvent<SVGSVGElement> | PointerEvent<SVGSVGElement>, snap = true) {
    const cursorPoint = svgPointFromEvent(event, canvasView);
    const point = fromCanvas(cursorPoint.x, cursorPoint.y, canvasView);
    const snapped = snap ? snapPoint(point, canvasView, shapes) : point;
    return { ...snapped, xM: Math.abs(snapped.xM), curveMode: "spline" as const };
  }

  function handleCanvasClick(event: MouseEvent<SVGSVGElement>) {
    if ((event.target as Element).closest(".shape-node")) return;
    if ((event.target as Element).closest(".curve-toggle")) return;
    if ((event.target as Element).closest(".tangent-handle")) return;
    if (!drawActive) {
      onSelect("");
      return;
    }
    onAddPoint(pointFromEvent(event));
  }

  function handleMouseMove(event: MouseEvent<SVGSVGElement>) {
    const point = pointFromEvent(event);
    setCanvasCursorPoint(drawActive ? point : null);
    if (!drawActive || !draftPoints.length) return;
    onSetPreviewPoint(point);
  }

  function handlePointerMove(event: PointerEvent<SVGSVGElement>) {
    if (!dragTarget) return;
    event.preventDefault();
	    const point = pointFromEvent(event, dragTarget.kind === "draft" || dragTarget.kind === "shape");
    setCanvasCursorPoint(point);
	    if (dragTarget.kind === "draft") {
	      onMoveDraftPoint(dragTarget.index, point);
	    } else if (dragTarget.kind === "shape") {
	      onMoveShapePoint(dragTarget.shapeId, dragTarget.index, point);
	    } else if (dragTarget.kind === "draftTangent") {
	      onMoveDraftTangent(dragTarget.index, dragTarget.side, point);
	    } else {
	      onMoveShapeTangent(dragTarget.shapeId, dragTarget.index, dragTarget.side, point);
	    }
	  }

  function handlePointerUp(event: PointerEvent<SVGSVGElement>) {
    if (!dragTarget || dragTarget.pointerId !== event.pointerId) return;
    event.currentTarget.releasePointerCapture(event.pointerId);
    setDragTarget(null);
  }

  function handleWheel(event: WheelEvent<SVGSVGElement>) {
    event.preventDefault();
    const zoomFactor = event.deltaY < 0 ? 1.1 : 0.9;
    const cursor = svgPointFromEvent(event, canvasView);
    const cursorWorld = fromCanvas(cursor.x, cursor.y, canvasView);
    setCanvasView((current) => {
      const nextScale = Math.min(baseCanvasView.scale * 5, Math.max(baseCanvasView.scale * 0.25, current.scale * zoomFactor));
      return {
        ...current,
        originX: cursor.x - cursorWorld.xM * nextScale,
        originY: cursor.y + cursorWorld.yM * nextScale,
        scale: nextScale,
      };
    });
  }

  function cycleScaleUnit() {
    setScaleUnit((current) => scaleUnits[(scaleUnits.indexOf(current) + 1) % scaleUnits.length]);
  }

  return (
    <div className="sizing-canvas-wrap">
      <div className="canvas-sketch-toolbar">
        <button className={drawActive ? "active" : ""} onClick={() => onSetDrawActive(!drawActive)}>
          Draw
        </button>
        <button disabled={draftPoints.length < 2} onClick={onDone}>
          Done
        </button>
        <button disabled={!draftPoints.length && !drawActive} onClick={onCancel}>
          Cancel
        </button>
        {drawActive ? (
          <div className="canvas-role-toggle" aria-label="Shape type">
            <button className={draftRole === "body" ? "active" : ""} onClick={() => onActiveRoleChange("body")}>
              Body
            </button>
            <button
              className={draftRole === "liftingSurface" ? "active" : ""}
              onClick={() => onActiveRoleChange("liftingSurface")}
            >
              Lifting surface
            </button>
          </div>
        ) : null}
      </div>
      <svg
        className="sizing-canvas"
        onClick={handleCanvasClick}
        onMouseLeave={() => {
          setCanvasCursorPoint(null);
          onSetPreviewPoint(null);
        }}
        onMouseMove={handleMouseMove}
        onPointerCancel={handlePointerUp}
        onPointerMove={handlePointerMove}
        onPointerUp={handlePointerUp}
        onWheel={handleWheel}
        role="img"
        viewBox={`0 0 ${canvasView.width} ${canvasView.height}`}
        aria-label="Top down half aircraft sizing sketch"
      >
      <SizingGrid onCycleUnit={cycleScaleUnit} unit={scaleUnit} view={canvasView} />
      <line className="sizing-centerline" x1={canvasView.originX} y1="20" x2={canvasView.originX} y2={canvasView.height - 28} />
      <circle className="sizing-origin" cx={canvasView.originX} cy={canvasView.originY} r="5" />
      <text className="view-label" x="28" y="42">Top down half sketch</text>
      <text className="view-label subtle" x={canvasView.originX + 10} y={canvasView.originY - 12}>origin</text>
      <g>
        {shapes.map((shape) => (
          <SketchShape
            drawActive={drawActive}
            key={shape.id}
            onSelect={() => onSelect(shape.id)}
            selected={shape.id === selectedShapeId}
            shape={shape}
	            onBeginDrag={(index, event) => {
	              event.currentTarget.ownerSVGElement?.setPointerCapture(event.pointerId);
	              setDragTarget({ kind: "shape", shapeId: shape.id, index, pointerId: event.pointerId });
	            }}
	            onBeginTangentDrag={(index, side, event) => {
	              event.currentTarget.ownerSVGElement?.setPointerCapture(event.pointerId);
	              setDragTarget({ kind: "shapeTangent", shapeId: shape.id, index, side, pointerId: event.pointerId });
	            }}
	            onSetSegmentMode={(index, side, mode) => onSetShapeSegmentMode(shape.id, index, side, mode)}
	            onTogglePoint={(index) => onToggleShapePoint(shape.id, index)}
	            view={canvasView}
	          />
        ))}
      </g>
      {draftPoints.length ? (
        <DraftShape
          onTogglePoint={onToggleDraftPoint}
	          onBeginDrag={(index, event) => {
	            event.currentTarget.ownerSVGElement?.setPointerCapture(event.pointerId);
	            setDragTarget({ kind: "draft", index, pointerId: event.pointerId });
	          }}
	          onBeginTangentDrag={(index, side, event) => {
	            event.currentTarget.ownerSVGElement?.setPointerCapture(event.pointerId);
	            setDragTarget({ kind: "draftTangent", index, side, pointerId: event.pointerId });
	          }}
	          onSetSegmentMode={onSetDraftSegmentMode}
	          points={draftPoints}
          previewPoint={draftPreviewPoint}
          role={draftRole}
          view={canvasView}
        />
      ) : null}
      {analysis ? <AnalysisMarkers analysis={analysis} view={canvasView} /> : null}
      {drawActive && canvasCursorPoint ? <CanvasCursorPoint point={canvasCursorPoint} view={canvasView} /> : null}
      </svg>
    </div>
  );
}

function SizingGrid({ view, unit, onCycleUnit }: { view: CanvasView; unit: ScaleUnit; onCycleUnit: () => void }) {
  const majorTickM = chooseMajorTickMeters(view.scale);
  const minorTickM = majorTickM / 5;
  const gridLines = [];
  const axisTicks = [];
  const firstX = Math.floor(fromCanvas(0, view.originY, view).xM / minorTickM) * minorTickM;
  const lastX = Math.ceil(fromCanvas(view.width, view.originY, view).xM / minorTickM) * minorTickM;
  const firstY = Math.floor(fromCanvas(view.originX, view.height, view).yM / minorTickM) * minorTickM;
  const lastY = Math.ceil(fromCanvas(view.originX, 0, view).yM / minorTickM) * minorTickM;

  for (let xM = firstX; xM <= lastX; xM += minorTickM) {
    const normalized = snapNumber(xM, minorTickM);
    const isMajor = isMultipleOf(normalized, majorTickM);
    const x = toCanvas({ xM, yM: 0 }, view).x;
    gridLines.push(<line className={isMajor ? "major" : "minor"} key={`v-${normalized}`} x1={x} y1="0" x2={x} y2={view.height} />);
    if (isMajor && Math.abs(normalized) > 0.0001) {
      axisTicks.push(
        <g key={`xt-${normalized}`}>
          <line x1={x} y1={view.originY - 5} x2={x} y2={view.originY + 5} />
          <text x={x + 4} y={view.originY + 18}>{formatScaleValue(normalized, unit)}</text>
        </g>,
      );
    }
  }

  for (let yM = firstY; yM <= lastY; yM += minorTickM) {
    const normalized = snapNumber(yM, minorTickM);
    const isMajor = isMultipleOf(normalized, majorTickM);
    const y = toCanvas({ xM: 0, yM }, view).y;
    gridLines.push(<line className={isMajor ? "major" : "minor"} key={`h-${normalized}`} x1="0" y1={y} x2={view.width} y2={y} />);
    if (isMajor && Math.abs(normalized) > 0.0001) {
      axisTicks.push(
        <g key={`yt-${normalized}`}>
          <line x1={view.originX - 5} y1={y} x2={view.originX + 5} y2={y} />
          <text x={view.originX + 10} y={y - 5}>{formatScaleValue(normalized, unit)}</text>
        </g>,
      );
    }
  }

  return (
    <>
      <g className="sizing-grid">{gridLines}</g>
      <g className="sizing-axes">
        <line x1="20" y1={view.originY} x2={view.width - 24} y2={view.originY} />
        <line x1={view.originX} y1="20" x2={view.originX} y2={view.height - 24} />
        {axisTicks}
        <text className="axis-name" x={view.width - 46} y={view.originY - 10}>X</text>
        <text className="axis-name" x={view.originX + 12} y="32">Y</text>
        <text className="axis-unit" x={view.originX + 14} y={view.originY + 20} onClick={onCycleUnit}>
          {unit}
        </text>
      </g>
    </>
  );
}

type CanvasView = { width: number; height: number; originX: number; originY: number; scale: number };

function chooseMajorTickMeters(scale: number) {
  const targetPixels = 72;
  const rawMeters = targetPixels / scale;
  const magnitude = 10 ** Math.floor(Math.log10(rawMeters));
  const normalized = rawMeters / magnitude;
  const step = normalized <= 1 ? 1 : normalized <= 2 ? 2 : normalized <= 5 ? 5 : 10;
  return step * magnitude;
}

function formatScaleValue(valueM: number, unit: ScaleUnit) {
  const multiplier = unit === "m" ? 1 : unit === "cm" ? 100 : 1000;
  const value = valueM * multiplier;
  if (Math.abs(value) >= 100 || Number.isInteger(value)) return value.toFixed(0);
  if (Math.abs(value) >= 10) return value.toFixed(1);
  return value.toFixed(2);
}

function snapPoint(point: SizePoint, view: CanvasView, shapes: SizeShape[]) {
  const geometrySnap = snapPointToGeometry(point, view, shapes);
  return geometrySnap ?? snapPointToGrid(point, view);
}

function snapPointToGeometry(point: SizePoint, view: CanvasView, shapes: SizeShape[]) {
  const thresholdM = 12 / view.scale;
  let best: { point: SizePoint; distanceM: number } | undefined;

  for (const shape of shapes) {
    for (const shapePoint of shape.points) {
      const candidate = { ...shapePoint, xM: Math.abs(shapePoint.xM) };
      const distanceM = distanceBetweenPoints(point, candidate);
      if (distanceM <= thresholdM && (!best || distanceM < best.distanceM)) {
        best = { point: candidate, distanceM };
      }
    }

    for (let index = 0; index < shape.points.length - 1; index += 1) {
      const start = { ...shape.points[index], xM: Math.abs(shape.points[index].xM) };
      const end = { ...shape.points[index + 1], xM: Math.abs(shape.points[index + 1].xM) };
      const candidate = projectPointToSegment(point, start, end);
      const distanceM = distanceBetweenPoints(point, candidate);
      if (distanceM <= thresholdM && (!best || distanceM < best.distanceM)) {
        best = { point: candidate, distanceM };
      }
    }
  }

  return best?.point;
}

function snapPointToGrid(point: SizePoint, view: CanvasView) {
  const tickM = chooseMajorTickMeters(view.scale) / 5;
  return {
    ...point,
    xM: snapNumber(point.xM, tickM),
    yM: snapNumber(point.yM, tickM),
  };
}

function snapNumber(value: number, step: number) {
  return Number((Math.round(value / step) * step).toFixed(6));
}

function isMultipleOf(value: number, step: number) {
  return Math.abs(value / step - Math.round(value / step)) < 0.001;
}

function distanceBetweenPoints(a: SizePoint, b: SizePoint) {
  return Math.hypot(a.xM - b.xM, a.yM - b.yM);
}

function projectPointToSegment(point: SizePoint, start: SizePoint, end: SizePoint) {
  const dx = end.xM - start.xM;
  const dy = end.yM - start.yM;
  const lengthSquared = dx * dx + dy * dy;
  if (lengthSquared <= 1e-9) return start;
  const rawT = ((point.xM - start.xM) * dx + (point.yM - start.yM) * dy) / lengthSquared;
  const t = Math.min(1, Math.max(0, rawT));
  return {
    xM: start.xM + dx * t,
    yM: start.yM + dy * t,
  };
}

function svgPointFromEvent(event: MouseEvent<SVGSVGElement> | PointerEvent<SVGSVGElement>, view: CanvasView) {
  const svg = event.currentTarget;
  const matrix = svg.getScreenCTM();
  if (matrix && typeof svg.createSVGPoint === "function") {
    const point = svg.createSVGPoint();
    point.x = event.clientX;
    point.y = event.clientY;
    const transformed = point.matrixTransform(matrix.inverse());
    return { x: transformed.x, y: transformed.y };
  }

  const rect = svg.getBoundingClientRect();
  const scale = Math.min(rect.width / view.width, rect.height / view.height);
  const drawnWidth = view.width * scale;
  const drawnHeight = view.height * scale;
  const offsetX = (rect.width - drawnWidth) / 2;
  const offsetY = (rect.height - drawnHeight) / 2;
  return {
    x: (event.clientX - rect.left - offsetX) / scale,
    y: (event.clientY - rect.top - offsetY) / scale,
  };
}

function SketchShape({
  drawActive,
  shape,
  selected,
  view,
  onSelect,
  onBeginDrag,
  onBeginTangentDrag,
  onSetSegmentMode,
  onTogglePoint,
}: {
  drawActive: boolean;
  shape: SizeShape;
  selected: boolean;
  view: CanvasView;
  onSelect: () => void;
  onBeginDrag: (index: number, event: PointerEvent<SVGCircleElement>) => void;
  onBeginTangentDrag: (index: number, side: "in" | "out", event: PointerEvent<SVGCircleElement>) => void;
  onSetSegmentMode: (index: number, side: "in" | "out", mode: "corner" | "spline") => void;
  onTogglePoint: (index: number) => void;
}) {
  const mirrored = mirrorPoints(shape.points);
  const className = `sizing-shape ${shape.role} ${selected ? "selected" : ""}`;
  const labelPoint = toCanvas(shape.points[Math.max(0, Math.floor(shape.points.length / 2))], view);
  const livePath = pathForPoints(shape.points, view);
  const mirrorPath = pathForPoints(mirrored, view);
  return (
    <g
      className={className}
      onClick={(event) => {
        if (drawActive) return;
        event.stopPropagation();
        onSelect();
      }}
    >
      <path className="shape-hit shape-hit-live" d={livePath} />
      <path className="shape-hit shape-hit-mirror" d={mirrorPath} />
      <path className="shape-live" d={livePath} />
      <path className="shape-mirror" d={mirrorPath} />
      {selected ? <TangencyHandles onBeginDrag={onBeginTangentDrag} points={shape.points} view={view} /> : null}
      {selected ? <TangencyHandles mirrored points={mirrored} view={view} /> : null}
      {shape.points.map((point, index) => {
        const canvasPoint = toCanvas(point, view);
        return (
          <g key={`${shape.id}-${index}`}>
            {selected ? (
              <NodeCurveControls index={index} onSetSegmentMode={onSetSegmentMode} point={point} points={shape.points} view={view} />
            ) : null}
            <circle
              className={`shape-node ${point.curveMode === "corner" ? "corner" : "spline"}`}
              cx={canvasPoint.x}
              cy={canvasPoint.y}
              onPointerDown={(event) => {
                if (drawActive) return;
                event.stopPropagation();
                onBeginDrag(index, event);
              }}
              onDoubleClick={(event) => {
                event.stopPropagation();
                onTogglePoint(index);
              }}
              r="4"
            />
          </g>
        );
      })}
      <text x={labelPoint.x + 8} y={labelPoint.y - 8}>{shape.label}</text>
    </g>
  );
}

function DraftShape({
  points,
  role,
  previewPoint,
  view,
  onBeginDrag,
  onBeginTangentDrag,
  onSetSegmentMode,
  onTogglePoint,
}: {
  points: SizePoint[];
  role: SizeShapeRole;
  previewPoint: SizePoint | null;
  view: CanvasView;
  onBeginDrag: (index: number, event: PointerEvent<SVGCircleElement>) => void;
  onBeginTangentDrag: (index: number, side: "in" | "out", event: PointerEvent<SVGCircleElement>) => void;
  onSetSegmentMode: (index: number, side: "in" | "out", mode: "corner" | "spline") => void;
  onTogglePoint: (index: number) => void;
}) {
  const className = `sizing-shape draft ${role}`;
  const displayPoints = previewPoint ? [...points, { ...previewPoint, preview: true } as SizePoint & { preview: true }] : points;
  return (
    <g className={className}>
      <path className="shape-live" d={pathForPoints(displayPoints, view)} />
      <path className="shape-mirror" d={pathForPoints(mirrorPoints(displayPoints), view)} />
      <TangencyHandles onBeginDrag={onBeginTangentDrag} points={displayPoints} view={view} />
      <TangencyHandles mirrored points={mirrorPoints(displayPoints)} view={view} />
      {points.map((point, index) => {
        const canvasPoint = toCanvas(point, view);
        return (
          <g key={`draft-${index}`}>
            <NodeCurveControls index={index} onSetSegmentMode={onSetSegmentMode} point={point} points={points} view={view} />
            <circle
              className={`shape-node ${point.curveMode === "corner" ? "corner" : "spline"}`}
              cx={canvasPoint.x}
              cy={canvasPoint.y}
              onPointerDown={(event) => {
                event.stopPropagation();
                onBeginDrag(index, event);
              }}
              onDoubleClick={(event) => {
                event.stopPropagation();
                onTogglePoint(index);
              }}
              r="4"
            />
          </g>
        );
      })}
      {previewPoint ? <circle className="shape-node preview" cx={toCanvas(previewPoint, view).x} cy={toCanvas(previewPoint, view).y} r="3" /> : null}
    </g>
  );
}

function NodeCurveControls({
  point,
  points,
  index,
  view,
  onSetSegmentMode,
}: {
  point: SizePoint;
  points: SizePoint[];
  index: number;
  view: CanvasView;
  onSetSegmentMode: (index: number, side: "in" | "out", mode: "corner" | "spline") => void;
}) {
  const center = toCanvas(point, view);
  const inMode = point.segmentInMode ?? "corner";
  const outMode = point.segmentOutMode ?? "corner";
  const controls = [
    index > 0
      ? curveControlForSegment(
          center,
          inMode === "spline" ? tangentCanvasPoint(point, "in", points, index, view) : toCanvas(points[index - 1], view),
          "in",
          inMode,
        )
      : null,
    index < points.length - 1
      ? curveControlForSegment(
          center,
          outMode === "spline" ? tangentCanvasPoint(point, "out", points, index, view) : toCanvas(points[index + 1], view),
          "out",
          outMode,
        )
      : null,
  ].filter(Boolean) as { side: "in" | "out"; x: number; y: number; angleDeg: number; mode: "corner" | "spline" }[];

  return (
    <g className="curve-toggles">
      {controls.map((control) => (
        <path
          className={`curve-toggle ${control.mode === "spline" ? "spline" : "corner"}`}
          d={halfMoonPath(control.side)}
          key={control.side}
          onClick={(event) => {
            event.stopPropagation();
            onSetSegmentMode(index, control.side, control.mode === "spline" ? "corner" : "spline");
          }}
          transform={`translate(${control.x} ${control.y}) rotate(${control.angleDeg})`}
        />
      ))}
    </g>
  );
}

function curveControlForSegment(
  center: { x: number; y: number },
  neighbor: { x: number; y: number },
  side: "in" | "out",
  mode: "corner" | "spline",
) {
  const dx = neighbor.x - center.x;
  const dy = neighbor.y - center.y;
  const length = Math.hypot(dx, dy) || 1;
  const offset = 15;
  return {
    side,
    mode,
    x: center.x + (dx / length) * offset,
    y: center.y + (dy / length) * offset,
    angleDeg: (Math.atan2(dy, dx) * 180) / Math.PI,
  };
}

function TangencyHandles({
  points,
  view,
  mirrored = false,
  onBeginDrag,
}: {
  points: SizePoint[];
  view: CanvasView;
  mirrored?: boolean;
  onBeginDrag?: (index: number, side: "in" | "out", event: PointerEvent<SVGCircleElement>) => void;
}) {
  if (points.length < 3) return null;
  return (
    <g className={`tangent-handles ${mirrored ? "mirrored" : ""}`}>
      {points.map((point, index) => {
        const current = toCanvas(point, view);
        const handles = [
          point.segmentInMode === "spline" && index > 0
            ? { side: "in" as const, point: tangentCanvasPoint(point, "in", points, index, view) }
            : null,
          point.segmentOutMode === "spline" && index < points.length - 1
            ? { side: "out" as const, point: tangentCanvasPoint(point, "out", points, index, view) }
            : null,
        ].filter(Boolean) as { side: "in" | "out"; point: { x: number; y: number } }[];
        if (!handles.length) return null;
        return (
          <g key={`handle-${index}`}>
            {handles.map((handle) => (
              <g key={handle.side}>
                <line x1={current.x} y1={current.y} x2={handle.point.x} y2={handle.point.y} />
                <circle
                  className="tangent-handle"
                  cx={handle.point.x}
                  cy={handle.point.y}
                  onPointerDown={
                    onBeginDrag
                      ? (event) => {
                          event.stopPropagation();
                          onBeginDrag(index, handle.side, event);
                        }
                      : undefined
                  }
                  r="4"
                />
              </g>
            ))}
          </g>
        );
      })}
    </g>
  );
}

function AnalysisMarkers({ analysis, view }: { analysis: SizingAnalysis; view: CanvasView }) {
  const com = toCanvas(analysis.com, view);
  const cop = toCanvas(analysis.cop, view);
  return (
    <g className="analysis-markers">
      <g className="com-marker">
        <circle cx={com.x} cy={com.y} r="9" />
        <line x1={com.x - 13} y1={com.y} x2={com.x + 13} y2={com.y} />
        <line x1={com.x} y1={com.y - 13} x2={com.x} y2={com.y + 13} />
        <text x={com.x + 14} y={com.y - 10}>CoM</text>
      </g>
      <g className="cop-marker">
        <circle cx={cop.x} cy={cop.y} r="9" />
        <text x={cop.x + 14} y={cop.y + 4}>CoP</text>
      </g>
    </g>
  );
}

function CanvasCursorPoint({ point, view }: { point: SizePoint; view: CanvasView }) {
  const cursor = toCanvas(point, view);
  return (
    <g className="canvas-cursor-point">
      <line x1={cursor.x - 8} y1={cursor.y} x2={cursor.x + 8} y2={cursor.y} />
      <line x1={cursor.x} y1={cursor.y - 8} x2={cursor.x} y2={cursor.y + 8} />
      <circle cx={cursor.x} cy={cursor.y} r="4" />
    </g>
  );
}

function pathForPoints(points: SizePoint[], view: CanvasView) {
  if (!points.length) return "";
  const canvasPoints = points.map((point) => toCanvas(point, view));
  if (canvasPoints.length === 1) return `M ${canvasPoints[0].x} ${canvasPoints[0].y}`;
  if (canvasPoints.length < 3) {
    return canvasPoints.map((point, index) => `${index === 0 ? "M" : "L"} ${point.x} ${point.y}`).join(" ");
  }
  let path = `M ${canvasPoints[0].x} ${canvasPoints[0].y}`;
  for (let index = 1; index < canvasPoints.length; index += 1) {
    const previousPoint = points[index - 1];
    const point = points[index];
    const previous = canvasPoints[index - 1];
    const current = canvasPoints[index];
    const segmentMode = previousPoint.segmentOutMode ?? point.segmentInMode ?? "corner";
    if (segmentMode !== "spline") {
      path += ` L ${current.x} ${current.y}`;
    } else {
      const c1 = tangentCanvasPoint(previousPoint, "out", points, index - 1, view);
      const c2 = tangentCanvasPoint(point, "in", points, index, view);
      path += ` C ${c1.x} ${c1.y} ${c2.x} ${c2.y} ${current.x} ${current.y}`;
    }
  }
  return path;
}

function tangentCanvasPoint(point: SizePoint, side: "in" | "out", points: SizePoint[], index: number, view: CanvasView) {
  const base = toCanvas(point, view);
  const vector = side === "in" ? point.tangentIn : point.tangentOut;
  if (vector) {
    return {
      x: base.x + vector.xM * view.scale,
      y: base.y - vector.yM * view.scale,
    };
  }
  const neighbor = side === "in" ? points[index - 1] : points[index + 1];
  if (!neighbor) return base;
  const neighborCanvas = toCanvas(neighbor, view);
  return {
    x: base.x + (neighborCanvas.x - base.x) / 3,
    y: base.y + (neighborCanvas.y - base.y) / 3,
  };
}

function halfMoonPath(side: "in" | "out") {
  const radius = 6;
  const sweep = side === "in" ? 0 : 1;
  const x1 = 0;
  const y1 = -radius;
  const x2 = 0;
  const y2 = radius;
  return `M ${x1} ${y1} A ${radius} ${radius} 0 0 ${sweep} ${x2} ${y2} L ${x1} ${y1} Z`;
}

function mirrorPoints(points: SizePoint[]) {
  return points.map((point) => ({ xM: -point.xM, yM: point.yM }));
}

function closeIfNearCenterline(points: SizePoint[]) {
  return points.map((point): SizePoint => ({ ...point, xM: Math.max(0, point.xM) }));
}

function setSegmentMode(points: SizePoint[], index: number, side: "in" | "out", mode: "corner" | "spline") {
  const segmentStart = side === "in" ? index - 1 : index;
  const segmentEnd = segmentStart + 1;
  return points.map((point, pointIndex) => {
    if (pointIndex === segmentStart) {
      return {
        ...point,
        segmentOutMode: mode,
        tangentOut: mode === "corner" ? undefined : point.tangentOut,
      };
    }
    if (pointIndex === segmentEnd) {
      return {
        ...point,
        segmentInMode: mode,
        tangentIn: mode === "corner" ? undefined : point.tangentIn,
      };
    }
    return point;
  });
}

function setTangentVector(points: SizePoint[], index: number, side: "in" | "out", target: SizePoint) {
  return points.map((point, pointIndex) =>
    pointIndex === index
      ? {
          ...point,
          [side === "in" ? "tangentIn" : "tangentOut"]: {
            xM: target.xM - point.xM,
            yM: target.yM - point.yM,
          },
        }
      : point,
  );
}

function snapToExistingNode(point: SizePoint, shapes: SizeShape[]) {
  const thresholdM = 0.055;
  let best: { shape: SizeShape; index: number; point: SizePoint; distance: number } | undefined;
  shapes.forEach((shape) => {
    shape.points.forEach((shapePoint, index) => {
      const distance = Math.hypot(point.xM - shapePoint.xM, point.yM - shapePoint.yM);
      if (distance <= thresholdM && (!best || distance < best.distance)) {
        best = { shape, index, point: shapePoint, distance };
      }
    });
  });
  return best;
}

function isEndpoint(shape: SizeShape, index: number) {
  return index === 0 || index === shape.points.length - 1;
}

function cloneSizingProject(project: SizingProject): SizingProject {
  return JSON.parse(JSON.stringify(project)) as SizingProject;
}

function toCanvas(point: SizePoint, view: CanvasView) {
  return {
    x: view.originX + point.xM * view.scale,
    y: view.originY - point.yM * view.scale,
  };
}

function fromCanvas(x: number, y: number, view: CanvasView): SizePoint {
  return {
    xM: (x - view.originX) / view.scale,
    yM: (view.originY - y) / view.scale,
  };
}
