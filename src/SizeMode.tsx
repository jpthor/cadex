import { Eye, EyeOff, Ruler, Sparkles, Trash2 } from "lucide-react";
import { useEffect, useMemo, useRef, useState } from "react";
import type { MouseEvent, PointerEvent, ReactNode, WheelEvent } from "react";
import {
  bodyMassEstimate,
  bodySurfaceAreaEstimate,
  batteryMassEstimate,
  batteryPlanformAreaEstimate,
  batteryVolumeEstimate,
  computeSizingAnalysis,
  inferredBatteryThicknessM,
  inferredMotorDepthM,
  liftingSurfaceMassEstimate,
  liftingSurfaceSkinAreaEstimate,
  motorMassEstimate,
  motorPlanformAreaEstimate,
  motorVolumeEstimate,
  rotorDiameterEstimate,
  rotorInstanceCount,
  rotorMassPerRotorEstimate,
  rotorTotalMassEstimate,
  rotorVolumePerRotorEstimate,
  shapeBounds,
} from "./sizing/auditedSizingEngine";
import {
  bodyMaterialLabels,
  partTypeLabels,
  roleLabels,
  liftingSurfaceKindLabels,
} from "./sizingEngine";
import type {
  BodyMaterial,
  LiftingSurfaceKind,
  PartType,
  SizeDimension,
  SizeDimensionTarget,
  SizePoint,
  SizeSnapAttachment,
  SizeShape,
  SizeShapeRole,
  SizingAnalysis,
  SizingProject,
} from "./sizingEngine";

export { defaultSizingProject, normalizeSizingProject } from "./sizingEngine";
export type {
  SizePoint,
  SizeDimension,
  SizeDimensionTarget,
  SizeSnapAttachment,
  SizeShape,
  SizeShapeRole,
  SizingAnalysis,
  SizingProject,
} from "./sizingEngine";

const baseCanvasView: CanvasView = { width: 900, height: 720, originX: 450, originY: 72, scale: 190 };
const scaleUnits = ["cm", "m", "mm"] as const;
type ScaleUnit = (typeof scaleUnits)[number];
type AirfoilStation = "root10" | "tip90";
type CanvasViewMode = "top" | "front" | "side";
type JoinPointSelection = { shapeId: string; pointIndex: number };
type DimensionDraft = { firstTarget: SizeDimensionTarget } | null;
type PendingDimension = { targetA: SizeDimensionTarget; targetB: SizeDimensionTarget } | null;
const referenceRoles: SizeShapeRole[] = ["referenceLine", "mirrorPlane"];
const airfoilOptions = ["NACA 0012", "NACA 2412", "NACA 4412", "Clark Y", "MH 32", "Selig S1223"];
const mirrorAxisTouchToleranceM = 0.005;
const drawablePartTypes: PartType[] = ["payload", "battery", "motor", "rotor"];
const sideCollapseProgress = 0.58;

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
  const [drawActive, setDrawActive] = useState(false);
  const [undoStack, setUndoStack] = useState<SizingProject[]>([]);
  const [redoStack, setRedoStack] = useState<SizingProject[]>([]);
  const sizingRef = useRef(sizing);
  const undoStackRef = useRef<SizingProject[]>([]);
  const redoStackRef = useRef<SizingProject[]>([]);
  const [activeAirfoilStation, setActiveAirfoilStation] = useState<AirfoilStation>("root10");
  const [rightPaneTab, setRightPaneTab] = useState<"aircraft" | "shape">("aircraft");
  const [joinSourcePoint, setJoinSourcePoint] = useState<JoinPointSelection | null>(null);
  const [dimensionDraft, setDimensionDraft] = useState<DimensionDraft>(null);
  const [dimensionToolActive, setDimensionToolActive] = useState(false);
  const [pendingDimension, setPendingDimension] = useState<PendingDimension>(null);
  const [pendingDimensionValue, setPendingDimensionValue] = useState("");
  const [selectedDimensionId, setSelectedDimensionId] = useState<string | null>(null);
  const selected = sizing.shapes.find((shape) => shape.id === sizing.selectedShapeId);
  const activeRole = sizing.activeRole ?? "body";
  const [activePartType, setActivePartType] = useState<PartType>("payload");
  const liveAnalysis = useMemo(() => (sizing.shapes.length ? computeSizingAnalysis(sizing) : sizing.analysis), [sizing]);
  const mirrorPlanes = useMemo(() => sizing.shapes.filter((shape) => shape.role === "mirrorPlane" && shape.points.length >= 2), [sizing.shapes]);

  useEffect(() => {
    sizingRef.current = sizing;
  }, [sizing]);

  useEffect(() => {
    function handleKeyDown(event: KeyboardEvent) {
      const target = event.target as HTMLElement | null;
      if (target?.closest("input, textarea, select")) return;
      if ((event.key === "Delete" || event.key === "Backspace") && selectedDimensionId) {
        event.preventDefault();
        deleteDimension(selectedDimensionId);
        return;
      }
      if (!(event.ctrlKey || event.metaKey) || event.key.toLowerCase() !== "z") return;
      event.preventDefault();
      if (event.shiftKey) {
        const next = redoStackRef.current[redoStackRef.current.length - 1];
        if (!next) return;
        setHistoryStacks([...undoStackRef.current, cloneSizingProject(sizingRef.current)], redoStackRef.current.slice(0, -1));
        restoreHistoryProject(next);
        return;
      }
      const previous = undoStackRef.current[undoStackRef.current.length - 1];
      if (!previous) return;
      setHistoryStacks(undoStackRef.current.slice(0, -1), [...redoStackRef.current, cloneSizingProject(sizingRef.current)]);
      restoreHistoryProject(previous);
    }
    window.addEventListener("keydown", handleKeyDown);
    return () => window.removeEventListener("keydown", handleKeyDown);
  }, [onChange, selectedDimensionId]);

  useEffect(() => {
    if (selected) setRightPaneTab("shape");
  }, [selected?.id]);

  function update(next: Partial<SizingProject>, undoable = true) {
    if (undoable) pushUndoCheckpoint();
    const nextProject = { ...sizingRef.current, ...next };
    sizingRef.current = nextProject;
    onChange(nextProject);
  }

  function setHistoryStacks(undo: SizingProject[], redo: SizingProject[]) {
    undoStackRef.current = undo;
    redoStackRef.current = redo;
    setUndoStack(undo);
    setRedoStack(redo);
  }

  function pushUndoCheckpoint() {
    setHistoryStacks([...undoStackRef.current, cloneSizingProject(sizingRef.current)], []);
  }

  function restoreHistoryProject(project: SizingProject) {
    setDraftPoints([]);
    setDraftPreviewPoint(null);
    setDrawActive(false);
    setDimensionDraft(null);
    setDimensionToolActive(false);
    setPendingDimension(null);
    setPendingDimensionValue("");
    setSelectedDimensionId(null);
    const restored = cloneSizingProject(project);
    sizingRef.current = restored;
    onChange(restored);
  }

  function updateShapes(shapes: SizeShape[], selectedShapeId = sizing.selectedShapeId, undoable = true) {
    const attached = resolveAttachedShapes(shapes);
    update({ shapes: enforceDimensions(attached, sizing.dimensions ?? []), selectedShapeId, analysis: undefined }, undoable);
  }

  function selectJoinPoint(shapeId: string, pointIndex: number) {
    setSelectedDimensionId(null);
    setJoinSourcePoint({ shapeId, pointIndex });
    update({ selectedShapeId: shapeId }, false);
  }

  function selectDimension(id: string) {
    setJoinSourcePoint(null);
    setSelectedDimensionId(id);
    update({ selectedShapeId: "" }, false);
  }

  function deleteDimension(id: string) {
    setSelectedDimensionId(null);
    const dimensions = (sizing.dimensions ?? []).filter((dimension) => dimension.id !== id);
    update(
      {
        dimensions,
        shapes: enforceDimensions(sizing.shapes, dimensions),
        analysis: undefined,
      },
      true,
    );
  }

  function selectDimensionTarget(target: SizeDimensionTarget) {
    if (!dimensionToolActive) return;
    if (!dimensionDraft) {
      setDimensionDraft({ firstTarget: target });
      return;
    }
    if (sameDimensionTarget(dimensionDraft.firstTarget, target)) return;
    const measured = measureDimension(dimensionDraft.firstTarget, target, sizing.shapes);
    setDimensionDraft(null);
    if (!measured || measured <= 0) return;
    setPendingDimension({ targetA: dimensionDraft.firstTarget, targetB: target });
    setPendingDimensionValue(trimDimensionValue(measured));
  }

  function commitPendingDimension() {
    if (!pendingDimension) return;
    const valueM = Number(pendingDimensionValue);
    if (!Number.isFinite(valueM) || valueM <= 0) return;
    const nextDimension: SizeDimension = {
      id: `dimension-${crypto.randomUUID()}`,
      label: `D${(sizing.dimensions ?? []).length + 1}`,
      targetA: pendingDimension.targetA,
      targetB: pendingDimension.targetB,
      valueM,
    };
    setPendingDimension(null);
    setPendingDimensionValue("");
    setDimensionToolActive(false);
    update(
      {
        dimensions: [...(sizing.dimensions ?? []), nextDimension],
        shapes: enforceDimensions(sizing.shapes, [...(sizing.dimensions ?? []), nextDimension]),
        analysis: undefined,
      },
      true,
    );
  }

  function cancelPendingDimension() {
    setPendingDimension(null);
    setPendingDimensionValue("");
  }

  function updateSelected(patch: Partial<SizeShape>) {
    if (!selected) return;
    if (patch.partType === "rotor") setJoinSourcePoint(null);
    updateShapes(sizing.shapes.map((shape) => (shape.id === selected.id ? { ...shape, ...patch } : shape)));
  }

  function addDraftPoint(point: SizePoint) {
    if (activeRole === "part") {
      const nextPoint = cleanPartDraftPoint(point);
      if (!draftPoints.length) {
        setDraftPoints([nextPoint]);
        return;
      }
      finishPartShape([draftPoints[0], nextPoint]);
      return;
    }
    const axisLockedPoint =
      referenceRoles.includes(activeRole) && draftPoints.length === 1 ? axisAlignedPoint(draftPoints[0], point) : point;
    const nextPoint = { ...axisLockedPoint, xM: Math.abs(axisLockedPoint.xM), curveMode: axisLockedPoint.curveMode ?? "spline" };
    setDraftPoints((points) => {
      const nextPoints = [...points, nextPoint];
      if (referenceRoles.includes(activeRole) && nextPoints.length >= 2) {
        window.setTimeout(() => finishReferenceShape(nextPoints.slice(0, 2)), 0);
      }
      return nextPoints;
    });
  }

  function finishReferenceShape(points: SizePoint[]) {
    const lockedPoints = points.length >= 2 ? [points[0], axisAlignedPoint(points[0], points[1])] : points;
    const count = sizing.shapes.filter((shape) => shape.role === activeRole).length + 1;
    const shape: SizeShape = {
      id: `${activeRole}-${crypto.randomUUID()}`,
      role: activeRole,
      label: `${roleLabels[activeRole]} ${count}`,
      drawMode: "line",
      points: lockedPoints.map((point) => ({
        ...point,
        xM: Math.abs(point.xM),
        curveMode: "corner",
        segmentInMode: "corner",
        segmentOutMode: "corner",
        tangentIn: undefined,
        tangentOut: undefined,
      })),
    };
    setDraftPoints([]);
    setDraftPreviewPoint(null);
    setDrawActive(false);
    updateShapes([...sizing.shapes, shape], shape.id);
  }

  function finishShape() {
    if (draftPoints.length < 2) {
      setDrawActive(false);
      return;
    }
    if (activeRole === "part") {
      finishPartShape(draftPoints);
      return;
    }
    const newLiftingSurfaceKind: LiftingSurfaceKind = "wing";
    const count = sizing.shapes.filter(
      (shape) =>
        shape.role === activeRole &&
        (activeRole !== "liftingSurface" || (shape.liftingSurfaceKind ?? "wing") === newLiftingSurfaceKind),
    ).length + 1;
    const labelBase = activeRole === "liftingSurface" ? liftingSurfaceKindLabels[newLiftingSurfaceKind] : roleLabels[activeRole];
    const shape: SizeShape = {
      id: `${activeRole}-${crypto.randomUUID()}`,
      role: activeRole,
      label: `${labelBase} ${count}`,
      drawMode: "spline",
      points: closeIfNearCenterline(draftPoints),
      airfoil: activeRole === "liftingSurface" ? "NACA 0012" : undefined,
      liftingSurfaceKind: activeRole === "liftingSurface" ? newLiftingSurfaceKind : undefined,
      airfoilStations: activeRole === "liftingSurface" ? { root10: "NACA 0012", tip90: "NACA 0012" } : undefined,
      incidenceDeg: activeRole === "liftingSurface" ? 0 : undefined,
      incidenceStationsDeg: activeRole === "liftingSurface" ? { root10: 0, tip90: 0 } : undefined,
      massKg: activeRole === "body" ? 0.5 : activeRole === "liftingSurface" ? 0.15 : 0,
      bodyMaterial: activeRole === "body" || activeRole === "liftingSurface" ? "carbonFibre" : undefined,
      bodyThicknessMm: activeRole === "body" || activeRole === "liftingSurface" ? 1.2 : undefined,
      partType: undefined,
      rotorBladeCount: undefined,
    };
    setDraftPoints([]);
    setDraftPreviewPoint(null);
    setDrawActive(false);
    updateShapes([...sizing.shapes, shape], shape.id);
  }

  function finishPartShape(points: SizePoint[]) {
    const partPoints = partShapePointsFromDraft(activePartType, points);
    if (partPoints.length < 2) {
      setDrawActive(false);
      return;
    }
    const count = sizing.shapes.filter((shape) => shape.role === "part" && (shape.partType ?? "payload") === activePartType).length + 1;
    const shape: SizeShape = {
      id: `part-${crypto.randomUUID()}`,
      role: "part",
      label: `${partTypeLabels[activePartType]} ${count}`,
      drawMode: "line",
      points: partPoints,
      massKg: 0,
      partType: activePartType,
      rotorBladeCount: activePartType === "rotor" ? 2 : undefined,
    };
    setDraftPoints([]);
    setDraftPreviewPoint(null);
    setDrawActive(false);
    updateShapes([...sizing.shapes, shape], shape.id);
  }

  function cancelDraft() {
    setDraftPoints([]);
    setDraftPreviewPoint(null);
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

  function insertShapePoint(shapeId: string, point: SizePoint) {
    const target = sizing.shapes.find((shape) => shape.id === shapeId);
    if (target?.partType === "rotor") return;
    const inserted = target ? insertPointOnNearestSegment(target.points, point) : undefined;
    updateShapes(
      sizing.shapes.map((shape) =>
        shape.id === shapeId && inserted ? { ...shape, points: inserted.points } : shape,
      ),
      shapeId,
    );
    if (inserted) setJoinSourcePoint({ shapeId, pointIndex: inserted.index });
  }

  function deleteShapePoint(shapeId: string, index: number) {
    const target = sizing.shapes.find((shape) => shape.id === shapeId);
    if (!target) return;
    if (target.partType === "rotor") return;
    if (joinSourcePoint?.shapeId === shapeId && joinSourcePoint.pointIndex === index) {
      setJoinSourcePoint(null);
    }
    if (target.points.length <= 2) {
      const shapes = sizing.shapes.filter((shape) => shape.id !== shapeId);
      updateShapes(shapes, shapes[0]?.id ?? "");
      return;
    }
    updateShapes(
      sizing.shapes.map((shape) =>
        shape.id === shapeId ? { ...shape, points: shape.points.filter((_, pointIndex) => pointIndex !== index) } : shape,
      ),
      shapeId,
    );
  }

  function moveDraftPoint(index: number, point: SizePoint) {
    setDraftPoints((points) =>
      points.map((entry, pointIndex) => {
        if (pointIndex !== index) return entry;
        if (activeRole === "part") return cleanPartDraftPoint(point);
        if (referenceRoles.includes(activeRole) && points.length >= 2) {
          const anchor = points[index === 0 ? 1 : 0];
          return referenceEndpointPoint(points, anchor, point);
        }
        return { ...entry, xM: Math.abs(point.xM), yM: point.yM };
      }),
    );
  }

  function moveShapePoint(shapeId: string, index: number, point: SizePoint) {
    const target = sizing.shapes.find((shape) => shape.id === shapeId);
    if (target?.partType === "rotor") {
      updateShapes(
        sizing.shapes.map((shape) =>
          shape.id === shapeId ? { ...shape, points: moveRotorEndpoint(shape.points, index, point) } : shape,
        ),
        shapeId,
        false,
      );
      return;
    }
    updateShapes(
      sizing.shapes.map((shape) =>
        shape.id === shapeId
          ? {
              ...shape,
              points: shape.points.map((entry, pointIndex) =>
                pointIndex === index ? moveShapePointWithConstraints(shape, index, entry, point, sizing.shapes) : entry,
              ),
            }
          : shape,
      ),
      shapeId,
      false,
    );
  }

  function moveShapeLine(shapeId: string, points: SizePoint[]) {
    updateShapes(
      sizing.shapes.map((shape) =>
        shape.id === shapeId && referenceRoles.includes(shape.role)
          ? {
              ...shape,
              points,
            }
          : shape,
      ),
      shapeId,
      false,
    );
  }

  function moveShapePoints(shapeId: string, points: SizePoint[]) {
    updateShapes(
      sizing.shapes.map((shape) =>
        shape.id === shapeId && !referenceRoles.includes(shape.role)
          ? {
              ...shape,
              points,
            }
          : shape,
      ),
      shapeId,
      false,
    );
  }

  function joinSelectedPointToNode(masterShapeId: string, masterPointIndex: number) {
    if (!joinSourcePoint) return;
    if (joinSourcePoint.shapeId === masterShapeId && joinSourcePoint.pointIndex === masterPointIndex) return;
    const masterShape = sizing.shapes.find((shape) => shape.id === masterShapeId);
    const masterPoint = masterShape?.points[masterPointIndex];
    if (!masterShape || !masterPoint) return;
    updateJoinedSourcePoint(joinSourcePoint, {
      ...masterPoint,
      xM: Math.abs(masterPoint.xM),
      snapAttachment: { kind: "node", shapeId: masterShapeId, pointIndex: masterPointIndex },
    });
  }

  function joinSelectedPointToSegment(masterShapeId: string, point: SizePoint) {
    if (!joinSourcePoint || joinSourcePoint.shapeId === masterShapeId) return;
    const masterShape = sizing.shapes.find((shape) => shape.id === masterShapeId);
    if (!masterShape || masterShape.points.length < 2) return;
    let best = { segmentIndex: 0, t: 0, point: masterShape.points[0], distanceM: Number.POSITIVE_INFINITY };
    for (let segmentIndex = 0; segmentIndex < masterShape.points.length - 1; segmentIndex += 1) {
      const projection = projectPointToShapeSegment(point, masterShape.points, segmentIndex);
      const distanceM = distanceBetweenPoints(point, projection.point);
      if (distanceM < best.distanceM) {
        best = { segmentIndex, t: projection.t, point: projection.point, distanceM };
      }
    }
    updateJoinedSourcePoint(joinSourcePoint, {
      ...best.point,
      xM: Math.abs(best.point.xM),
      snapAttachment: { kind: "segment", shapeId: masterShapeId, segmentIndex: best.segmentIndex, t: best.t },
    });
  }

  function updateJoinedSourcePoint(source: JoinPointSelection, joinedPoint: SizePoint) {
    updateShapes(
      sizing.shapes.map((shape) =>
        shape.id === source.shapeId
          ? updateShapePointForJoin(shape, source.pointIndex, joinedPoint)
          : shape,
      ),
      source.shapeId,
    );
  }

  function setDraftSegmentMode(index: number, side: "in" | "out", mode: "corner" | "spline") {
    setDraftPoints((points) => setSegmentMode(points, index, side, mode));
  }

  function setShapeSegmentMode(shapeId: string, index: number, side: "in" | "out", mode: "corner" | "spline") {
    const target = sizing.shapes.find((shape) => shape.id === shapeId);
    if (target?.partType === "rotor") return;
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
    const target = sizing.shapes.find((shape) => shape.id === shapeId);
    if (target?.partType === "rotor") return;
    updateShapes(
      sizing.shapes.map((shape) =>
        shape.id === shapeId ? { ...shape, points: setTangentVector(shape.points, index, side, point) } : shape,
      ),
      shapeId,
      false,
    );
  }

  function removeSelected() {
    if (!selected) return;
    const shapes = sizing.shapes.filter((shape) => shape.id !== selected.id);
    updateShapes(shapes, shapes[0]?.id ?? "");
  }

  function deleteAircraft() {
    setDraftPoints([]);
    setDraftPreviewPoint(null);
    setDrawActive(false);
    update({ shapes: [], selectedShapeId: "", analysis: undefined });
  }

  function compute() {
    update({ analysis: computeSizingAnalysis(sizing) }, false);
  }

  return (
    <main className="size-workspace sizing-sketch-workspace">
      <section className="size-canvas-panel sizing-canvas-panel">
        <SizingCanvas
          analysis={liveAnalysis}
          draftPoints={draftPoints}
          draftPreviewPoint={draftPreviewPoint}
          draftRole={activeRole}
          drawActive={drawActive}
          dimensionDraft={dimensionDraft}
          dimensions={sizing.dimensions ?? []}
          dimensionToolActive={dimensionToolActive}
          selectedDimensionId={selectedDimensionId}
          pendingDimension={pendingDimension}
          pendingDimensionValue={pendingDimensionValue}
          activePartType={activePartType}
          onActiveRoleChange={(activeRole) => update({ activeRole }, false)}
          onActivePartTypeChange={setActivePartType}
          onCancel={cancelDraft}
          onAddPoint={addDraftPoint}
          onDone={finishShape}
          onSelect={(selectedShapeId) => update({ selectedShapeId }, false)}
          onSelectDimension={selectDimension}
          onSetPreviewPoint={setDraftPreviewPoint}
          onSetDrawActive={(active) => {
            if (active) setDraftPreviewPoint(null);
            setDrawActive(active);
            if (active) {
              setDimensionToolActive(false);
              setDimensionDraft(null);
            }
          }}
          onSetDimensionToolActive={(active) => {
            setDimensionToolActive(active);
            setDimensionDraft(null);
            if (active) setDrawActive(false);
          }}
          onSetPendingDimensionValue={setPendingDimensionValue}
          onCommitPendingDimension={commitPendingDimension}
          onCancelPendingDimension={cancelPendingDimension}
          onMoveDraftPoint={moveDraftPoint}
          onMoveShapePoint={moveShapePoint}
          onMoveShapeLine={moveShapeLine}
          onMoveShapePoints={moveShapePoints}
          onBeginUndoableEdit={pushUndoCheckpoint}
          onSelectPoint={selectJoinPoint}
          onSelectDimensionTarget={selectDimensionTarget}
          onJoinToPoint={joinSelectedPointToNode}
          onJoinToSegment={joinSelectedPointToSegment}
          onMoveDraftTangent={moveDraftTangent}
          onMoveShapeTangent={moveShapeTangent}
          onSetDraftSegmentMode={setDraftSegmentMode}
          onSetShapeSegmentMode={setShapeSegmentMode}
          activeAirfoilStation={activeAirfoilStation}
          onActiveAirfoilStationChange={setActiveAirfoilStation}
          onToggleDraftPoint={toggleDraftPoint}
          onInsertShapePoint={insertShapePoint}
          onDeleteShapePoint={deleteShapePoint}
          selectedShapeId={sizing.selectedShapeId}
          joinSourcePoint={joinSourcePoint}
          shapes={sizing.shapes}
        />
      </section>

      <aside className="size-panel sizing-right-panel">
        <div className="sizing-pane-tabs" aria-label="Sizing panel tabs">
          <button className={rightPaneTab === "aircraft" ? "active" : ""} onClick={() => setRightPaneTab("aircraft")}>
            <Sparkles size={15} />
            Aircraft
          </button>
          <button className={rightPaneTab === "shape" ? "active" : ""} onClick={() => setRightPaneTab("shape")}>
            <Ruler size={15} />
            Shape
          </button>
        </div>
        {rightPaneTab === "aircraft" ? (
          <AircraftPanel analysis={liveAnalysis} shapes={sizing.shapes} onDeleteAircraft={deleteAircraft} />
        ) : (
          <>
            <ShapeSelector
              selectedShapeId={sizing.selectedShapeId}
              shapes={sizing.shapes}
              onSelect={(selectedShapeId) => update({ selectedShapeId }, false)}
            />
            {selected ? (
              <ShapeEditor
                activeAirfoilStation={activeAirfoilStation}
                mirrorPlanes={mirrorPlanes}
                shape={selected}
                onActiveAirfoilStationChange={setActiveAirfoilStation}
                onChange={updateSelected}
                onDelete={removeSelected}
              />
            ) : (
              <p className="empty-text">Draw a body, lifting surface, or part to edit it.</p>
            )}
          </>
        )}
      </aside>
    </main>
  );
}

export function SizingSummaryFooter({ analysis }: { analysis?: SizingAnalysis }) {
  if (!analysis) {
    return (
      <>
        <span>Run Compute</span>
        <span>CoM, CoP, inertia, geometry</span>
      </>
    );
  }
  return (
    <>
      <span>MTOW {analysis.totalMassKg.toFixed(1)} kg</span>
      <span>Static margin {analysis.staticMarginPct.toFixed(1)}%</span>
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

function AircraftPanel({
  analysis,
  shapes,
  onDeleteAircraft,
}: {
  analysis?: SizingAnalysis;
  shapes: SizeShape[];
  onDeleteAircraft: () => void;
}) {
  const shapeCount = shapes.filter((shape) => !referenceRoles.includes(shape.role)).length;
  const partCounts = countParts(shapes);
  const tailplaneSize = computeTailplaneSize(shapes);
  const [analysisVisible, setAnalysisVisible] = useState(false);
  const [deleteConfirming, setDeleteConfirming] = useState(false);
  const diagnostics = analysis ? analyseAircraftSizing(shapes, analysis, partCounts, tailplaneSize) : [];
  function handleDeleteAircraft() {
    if (!deleteConfirming) {
      setDeleteConfirming(true);
      return;
    }
    setDeleteConfirming(false);
    onDeleteAircraft();
  }
  function cancelDeleteAircraft() {
    setDeleteConfirming(false);
  }
  if (!analysis) {
    return (
      <div className="aircraft-panel">
        <p className="empty-text">Draw an aircraft shape to see mass and parameters.</p>
        <DeleteAircraftControl
          confirming={deleteConfirming}
          disabled={!shapeCount}
          onCancel={cancelDeleteAircraft}
          onDelete={handleDeleteAircraft}
        />
      </div>
    );
  }
  return (
    <div className="aircraft-panel">
      <div className="aircraft-mass-readout">
        <span>Mass</span>
        <strong>{analysis.totalMassKg.toFixed(2)} kg</strong>
      </div>
      <div className="aircraft-parameter-title">Parameters</div>
      <Metric label="Elements" value={`${shapeCount}`} />
      <Metric label="Motors" value={`${partCounts.motor}`} />
      {partCounts.rotor ? <Metric label="Rotors" value={`${partCounts.rotor}`} /> : null}
      {partCounts.payload ? <Metric label="Payloads" value={`${partCounts.payload}`} /> : null}
      {partCounts.battery ? <Metric label="Batteries" value={`${partCounts.battery}`} /> : null}
      {partCounts.electronics ? <Metric label="Electronics" value={`${partCounts.electronics}`} /> : null}
      <Metric label="Wing area" value={`${analysis.wingAreaM2.toFixed(3)} m2`} />
      {tailplaneSize.count ? <Metric label="Tailplane area" value={`${tailplaneSize.areaM2.toFixed(3)} m2`} /> : null}
      {tailplaneSize.count ? <Metric label="Tailplane span" value={`${tailplaneSize.spanM.toFixed(2)} m`} /> : null}
      <Metric label="Mean chord" value={`${analysis.meanChordM.toFixed(3)} m`} />
      <button className="analyse-aircraft-button" disabled={!shapeCount} onClick={() => setAnalysisVisible((visible) => !visible)}>
        Analyse
      </button>
      {analysisVisible ? <AircraftDiagnostics diagnostics={diagnostics} /> : null}
      <DeleteAircraftControl
        confirming={deleteConfirming}
        disabled={!shapeCount}
        onCancel={cancelDeleteAircraft}
        onDelete={handleDeleteAircraft}
      />
    </div>
  );
}

function DeleteAircraftControl({
  confirming,
  disabled,
  onCancel,
  onDelete,
}: {
  confirming: boolean;
  disabled: boolean;
  onCancel: () => void;
  onDelete: () => void;
}) {
  return (
    <div className={`delete-aircraft-confirm ${confirming ? "confirming" : ""}`}>
      <button className="delete-component-button" disabled={disabled} onClick={onDelete}>
        <Trash2 size={15} />
        {confirming ? "Confirm delete" : "Delete aircraft"}
      </button>
      {confirming ? (
        <button className="delete-cancel-button" onClick={onCancel} type="button">
          Cancel
        </button>
      ) : null}
    </div>
  );
}

type AircraftDiagnostic = {
  level: "ok" | "warn" | "bad";
  label: string;
  value: string;
  message: string;
};

function AircraftDiagnostics({ diagnostics }: { diagnostics: AircraftDiagnostic[] }) {
  if (!diagnostics.length) {
    return <p className="empty-text">No aircraft geometry to analyse yet.</p>;
  }
  return (
    <div className="aircraft-diagnostics">
      {diagnostics.map((diagnostic) => (
        <div className={`aircraft-diagnostic ${diagnostic.level}`} key={diagnostic.label}>
          <div>
            <span>{diagnostic.label}</span>
            <strong>{diagnostic.value}</strong>
          </div>
          <p>{diagnostic.message}</p>
        </div>
      ))}
    </div>
  );
}

function analyseAircraftSizing(
  shapes: SizeShape[],
  analysis: SizingAnalysis,
  partCounts: Record<PartType, number>,
  tailplaneSize: ReturnType<typeof computeTailplaneSize>,
): AircraftDiagnostic[] {
  const wingShapes = shapes.filter((shape) => shape.role === "liftingSurface" && (shape.liftingSurfaceKind ?? "wing") === "wing");
  const tailShapes = shapes.filter((shape) => shape.role === "liftingSurface" && shape.liftingSurfaceKind === "tailplane");
  const wingSpanM = Math.max(...wingShapes.map((shape) => effectiveMirroredSpan(shape, shapes)), 0);
  const wingAreaM2 = analysis.wingAreaM2;
  const meanChordM = analysis.meanChordM;
  const wingLoadingKgM2 = analysis.totalMassKg / Math.max(wingAreaM2, 0.001);
  const tailAreaRatio = tailplaneSize.areaM2 / Math.max(wingAreaM2, 0.001);
  const wingAcYM = weightedPlanformY(wingShapes, shapes, 0.25);
  const tailAcYM = weightedPlanformY(tailShapes, shapes, 0.25);
  const tailArmM = wingAcYM !== undefined && tailAcYM !== undefined ? wingAcYM - tailAcYM : 0;
  const tailVolume = tailArmM > 0 ? (tailplaneSize.areaM2 * tailArmM) / Math.max(wingAreaM2 * meanChordM, 0.001) : 0;
  const diagnostics: AircraftDiagnostic[] = [];

  diagnostics.push({
    level: wingAreaM2 <= 0.001 ? "bad" : wingLoadingKgM2 > 22 ? "bad" : wingLoadingKgM2 > 16 ? "warn" : "ok",
    label: "Wing loading",
    value: `${wingLoadingKgM2.toFixed(1)} kg/m2`,
    message:
      wingLoadingKgM2 > 22
        ? "High for a small electric aircraft. Expect faster stall and takeoff; add wing area or reduce mass."
        : wingLoadingKgM2 > 16
          ? "Moderate-high. This can work for cruise, but check stall speed and launch margin."
          : "Looks reasonable for an early electric aircraft sizing sketch.",
  });

  diagnostics.push({
    level: analysis.staticMarginPct < 5 ? "bad" : analysis.staticMarginPct > 20 ? "warn" : "ok",
    label: "Static margin",
    value: `${analysis.staticMarginPct.toFixed(1)}%`,
    message:
      analysis.staticMarginPct < 5
        ? "CoM is too close to or behind CoP. Move mass forward, move the wing back, or increase aft tail authority."
        : analysis.staticMarginPct > 20
          ? "Likely very stable but pitch-heavy. You may be carrying more tail authority or nose mass than needed."
          : "CoM and CoP separation is in a normal first-pass range.",
  });

  diagnostics.push({
    level: tailAreaRatio < 0.1 ? "warn" : tailAreaRatio > 0.28 ? "warn" : "ok",
    label: "Tailplane area",
    value: `${(tailAreaRatio * 100).toFixed(1)}% of wing`,
    message:
      tailAreaRatio < 0.1
        ? "Small tailplane area. It may still work with a long tail arm, but pitch authority could be tight."
        : tailAreaRatio > 0.28
          ? "Large tailplane area. This may add drag and mass unless you need strong pitch authority."
          : "Tailplane area is in a plausible range for a conventional layout.",
  });

  diagnostics.push({
    level: !tailplaneSize.count ? "bad" : tailVolume < 0.35 ? "warn" : tailVolume > 0.9 ? "warn" : "ok",
    label: "Tail volume",
    value: tailplaneSize.count ? tailVolume.toFixed(2) : "missing",
    message:
      !tailplaneSize.count
        ? "No tailplane is marked, so pitch stability cannot be judged properly."
        : tailVolume < 0.35
          ? "Low tail volume. Increase tail area, tail span, or tail arm."
          : tailVolume > 0.9
            ? "High tail volume. Stable, but possibly oversized for a cruise aircraft."
            : "Tail volume is in a useful first-pass range.",
  });

  diagnostics.push({
    level: partCounts.rotor && partCounts.motor && partCounts.rotor !== partCounts.motor ? "warn" : "ok",
    label: "Propulsors",
    value: `${partCounts.motor} motors / ${partCounts.rotor} rotors`,
    message:
      partCounts.rotor && partCounts.motor && partCounts.rotor !== partCounts.motor
        ? "Rotor and motor counts do not match. Check mirrored motors/rotors and local mirror planes."
        : "Motor and rotor counts are consistent.",
  });

  if (!wingShapes.length) {
    diagnostics.unshift({
      level: "bad",
      label: "Wing",
      value: "missing",
      message: "Mark at least one lifting surface as Wing so reference area and stability use the right surface.",
    });
  } else if (wingSpanM > 0) {
    diagnostics.push({
      level: wingSpanM / Math.max(meanChordM, 0.001) < 5 ? "warn" : "ok",
      label: "Aspect ratio",
      value: (wingSpanM / Math.max(meanChordM, 0.001)).toFixed(1),
      message:
        wingSpanM / Math.max(meanChordM, 0.001) < 5
          ? "Low aspect ratio for cruise efficiency. A longer span or smaller chord may improve endurance."
          : "Aspect ratio is reasonable for a quick cruise-oriented sketch.",
    });
  }

  return diagnostics;
}

function weightedPlanformY(shapes: SizeShape[], allShapes: SizeShape[], fractionFromLeadingEdge: number) {
  let areaSum = 0;
  let momentSum = 0;
  for (const shape of shapes) {
    const bounds = shapeBounds(shape);
    const area = liftingSurfaceSkinAreaEstimate(shape, allShapes);
    if (area <= 0) continue;
    const chord = Math.max(bounds.maxY - bounds.minY, 0);
    const y = bounds.maxY - chord * fractionFromLeadingEdge;
    areaSum += area;
    momentSum += y * area;
  }
  return areaSum > 0 ? momentSum / areaSum : undefined;
}

function computeTailplaneSize(shapes: SizeShape[]) {
  return shapes.reduce(
    (totals, shape) => {
      if (shape.role !== "liftingSurface" || shape.liftingSurfaceKind !== "tailplane") return totals;
      return {
        count: totals.count + 1,
        areaM2: totals.areaM2 + liftingSurfaceSkinAreaEstimate(shape, shapes),
        spanM: Math.max(totals.spanM, effectiveMirroredSpan(shape, shapes)),
      };
    },
    { count: 0, areaM2: 0, spanM: 0 },
  );
}

function effectiveMirroredSpan(shape: SizeShape, shapes: SizeShape[]) {
  const localMirrorPlane = shapes.find((candidate) => candidate.role === "mirrorPlane" && shapeTouchesMirrorPlane(shape, candidate));
  const points = localMirrorPlane ? [...shape.points, ...mirrorPointsAcrossPlane(shape.points, localMirrorPlane)] : shape.points;
  return shapeBounds({ ...shape, points }).maxX * 2;
}

function countParts(shapes: SizeShape[]): Record<PartType, number> {
  return shapes.reduce<Record<PartType, number>>(
    (counts, shape) => {
      if (shape.role === "part") {
        counts[shape.partType ?? "payload"] += mirroredInstanceCount(shape);
      }
      return counts;
    },
    { payload: 0, battery: 0, motor: 0, rotor: 0, electronics: 0 },
  );
}

function mirroredInstanceCount(shape: SizeShape) {
  return partTouchesMirrorAxis(shape) ? 1 : 2;
}

function partTouchesMirrorAxis(shape: SizeShape) {
  return shape.points.some((point) => Math.abs(point.xM) <= mirrorAxisTouchToleranceM);
}

function ShapeSelector({
  selectedShapeId,
  shapes,
  onSelect,
}: {
  selectedShapeId: string;
  shapes: SizeShape[];
  onSelect: (shapeId: string) => void;
}) {
  return (
    <label className="sizing-field shape-selector">
      <span>Shape</span>
      <select value={selectedShapeId} onChange={(event) => onSelect(event.target.value)}>
        <option value="">Select shape</option>
        {shapes.map((shape) => (
          <option key={shape.id} value={shape.id}>
            {shape.label}
          </option>
        ))}
      </select>
    </label>
  );
}

function ShapeEditor({
  activeAirfoilStation,
  mirrorPlanes,
  shape,
  onActiveAirfoilStationChange,
  onChange,
  onDelete,
}: {
  activeAirfoilStation: AirfoilStation;
  mirrorPlanes: SizeShape[];
  shape: SizeShape;
  onActiveAirfoilStationChange: (station: AirfoilStation) => void;
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
        <button
          className={shape.role === "body" ? "active" : ""}
          onClick={() => onChange({ role: "body", airfoil: undefined, liftingSurfaceKind: undefined, airfoilStations: undefined, partType: undefined })}
        >
          Body
        </button>
        <button
          className={shape.role === "liftingSurface" ? "active" : ""}
          onClick={() =>
            onChange({
              role: "liftingSurface",
              airfoil: shape.airfoil ?? "NACA 0012",
              liftingSurfaceKind: shape.liftingSurfaceKind ?? "wing",
              airfoilStations: shape.airfoilStations ?? { root10: shape.airfoil ?? "NACA 0012", tip90: shape.airfoil ?? "NACA 0012" },
              incidenceDeg: shape.incidenceDeg ?? 0,
              incidenceStationsDeg: shape.incidenceStationsDeg ?? {
                root10: shape.incidenceDeg ?? 0,
                tip90: shape.incidenceDeg ?? 0,
              },
              bodyMaterial: shape.bodyMaterial ?? "carbonFibre",
              bodyThicknessMm: shape.bodyThicknessMm ?? 1.2,
              partType: undefined,
            })
          }
        >
          Lifting surface
        </button>
        <button
          className={`part-role-button ${shape.role === "part" ? "active" : ""}`}
          onClick={() =>
            onChange({
              role: "part",
              airfoil: undefined,
              liftingSurfaceKind: undefined,
              airfoilStations: undefined,
              incidenceDeg: undefined,
              incidenceStationsDeg: undefined,
              partType: shape.partType ?? "payload",
              massKg: shape.massKg ?? 0,
            })
          }
        >
          Part
        </button>
      </div>
      {shape.role === "liftingSurface" ? (
        <>
          <div className="segmented-control sizing-role-control" aria-label="Lifting surface role">
            {Object.entries(liftingSurfaceKindLabels).map(([kind, label]) => (
              <button
                className={(shape.liftingSurfaceKind ?? "wing") === kind ? "active" : ""}
                key={kind}
                onClick={() => onChange({ liftingSurfaceKind: kind as LiftingSurfaceKind })}
              >
                {label}
              </button>
            ))}
          </div>
          <div className="airfoil-panel">
            <div className="segmented-control sizing-role-control" aria-label="Aerofoil station">
              <button className={activeAirfoilStation === "root10" ? "active" : ""} onClick={() => onActiveAirfoilStationChange("root10")}>
                10%
              </button>
              <button className={activeAirfoilStation === "tip90" ? "active" : ""} onClick={() => onActiveAirfoilStationChange("tip90")}>
                90%
              </button>
            </div>
            <label className="sizing-field">
              <span>Aerofoil</span>
              <select
                value={shape.airfoilStations?.[activeAirfoilStation] ?? shape.airfoil ?? "NACA 0012"}
                onChange={(event) =>
                  onChange({
                    airfoil: event.target.value,
                    airfoilStations: {
                      root10: shape.airfoilStations?.root10 ?? shape.airfoil ?? "NACA 0012",
                      tip90: shape.airfoilStations?.tip90 ?? shape.airfoil ?? "NACA 0012",
                      [activeAirfoilStation]: event.target.value,
                    },
                  })
                }
              >
                {airfoilOptions.map((option) => (
                  <option key={option} value={option}>
                    {option}
                  </option>
                ))}
              </select>
            </label>
          </div>
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
            label={`${activeAirfoilStation === "root10" ? "10%" : "90%"} incidence`}
            suffix="deg"
            value={shape.incidenceStationsDeg?.[activeAirfoilStation] ?? shape.incidenceDeg ?? 0}
            step={0.1}
            onChange={(incidenceDeg) =>
              onChange({
                incidenceDeg: ((activeAirfoilStation === "root10" ? incidenceDeg : shape.incidenceStationsDeg?.root10 ?? shape.incidenceDeg ?? 0) +
                  (activeAirfoilStation === "tip90" ? incidenceDeg : shape.incidenceStationsDeg?.tip90 ?? shape.incidenceDeg ?? 0)) / 2,
                incidenceStationsDeg: {
                  root10: shape.incidenceStationsDeg?.root10 ?? shape.incidenceDeg ?? 0,
                  tip90: shape.incidenceStationsDeg?.tip90 ?? shape.incidenceDeg ?? 0,
                  [activeAirfoilStation]: incidenceDeg,
                },
              })
            }
          />
          <div className="shape-readout">
            <span>
              Twist {((shape.incidenceStationsDeg?.tip90 ?? shape.incidenceDeg ?? 0) - (shape.incidenceStationsDeg?.root10 ?? shape.incidenceDeg ?? 0)).toFixed(1)} deg
            </span>
          </div>
          <NumberField
            label="Thickness"
            suffix="mm"
            value={shape.bodyThicknessMm ?? 1.2}
            step={0.1}
            onChange={(bodyThicknessMm) => onChange({ bodyThicknessMm })}
          />
          <div className="shape-readout">
            <span>Planform skin area {liftingSurfaceSkinAreaEstimate(shape).toFixed(3)} m2</span>
            <span>Surface mass {liftingSurfaceMassEstimate(shape).toFixed(3)} kg</span>
          </div>
        </>
      ) : shape.role === "body" ? (
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
            <span>Planform skin area {bodySurfaceAreaEstimate(shape).toFixed(3)} m2</span>
            <span>Body mass {bodyMassEstimate(shape).toFixed(3)} kg</span>
          </div>
        </>
      ) : referenceRoles.includes(shape.role) ? (
        <div className="shape-readout">
          <span>{shape.role === "mirrorPlane" ? "Mirrors touching geometry before origin mirror" : "Reference snap line"}</span>
        </div>
      ) : (
        <>
          <label className="sizing-field">
            <span>Part</span>
            <select value={shape.partType ?? "payload"} onChange={(event) => onChange({ partType: event.target.value as PartType })}>
              {Object.entries(partTypeLabels).map(([value, label]) => (
                <option key={value} value={value}>
                  {label}
                </option>
              ))}
            </select>
          </label>
          {shape.partType === "battery" ? (
            <div className="shape-readout">
              <span>{partTouchesMirrorAxis(shape) ? "1 centerline battery, mirrored from Y axis" : "2 mirrored batteries"}</span>
              <span>Plan area {batteryPlanformAreaEstimate(shape).toFixed(4)} m2</span>
              <span>Inferred thickness {(inferredBatteryThicknessM(shape) * 1000).toFixed(0)} mm</span>
              <span>Volume {(batteryVolumeEstimate(shape) * 1000).toFixed(2)} L</span>
              <span>Battery mass {batteryMassEstimate(shape).toFixed(3)} kg</span>
              <span>LiPo density 1.70 kg/L</span>
            </div>
          ) : shape.partType === "motor" ? (
            <div className="shape-readout">
              <span>Plan area {motorPlanformAreaEstimate(shape).toFixed(4)} m2</span>
              <span>Inferred depth {(inferredMotorDepthM(shape) * 1000).toFixed(0)} mm</span>
              <span>Volume {(motorVolumeEstimate(shape) * 1000).toFixed(2)} L</span>
              <span>Motor mass {motorMassEstimate(shape).toFixed(3)} kg</span>
              <span>Motor density 3.20 kg/L</span>
            </div>
          ) : shape.partType === "rotor" ? (
            <>
              <div className="shape-readout">
                <span>Diameter {rotorDiameterEstimate(shape, mirrorPlanes).toFixed(3)} m</span>
                <span>{rotorInstanceCount(shape, mirrorPlanes)} physical rotors after mirrors</span>
              </div>
              <NumberField
                label="Blade count"
                suffix=""
                value={shape.rotorBladeCount ?? 2}
                step={1}
                onChange={(rotorBladeCount) => onChange({ rotorBladeCount: Math.max(1, Math.round(rotorBladeCount)) })}
              />
              <div className="shape-readout">
                <span>Carbon fibre volume {(rotorVolumePerRotorEstimate(shape, mirrorPlanes) * 1000).toFixed(3)} L / rotor</span>
                <span>Mass / rotor {rotorMassPerRotorEstimate(shape, mirrorPlanes).toFixed(3)} kg</span>
                <span>Carbon fibre density 1.60 kg/L</span>
                <span>Total rotor mass {rotorTotalMassEstimate(shape, mirrorPlanes).toFixed(3)} kg</span>
              </div>
            </>
          ) : (
            <NumberField label="Mass" suffix="kg" value={shape.massKg ?? 0} onChange={(massKg) => onChange({ massKg })} />
          )}
        </>
      )}
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
  joinSourcePoint,
  draftPoints,
  draftPreviewPoint,
  draftRole,
  drawActive,
  dimensionDraft,
  dimensions,
  dimensionToolActive,
  selectedDimensionId,
  pendingDimension,
  pendingDimensionValue,
  activePartType,
  analysis,
  onAddPoint,
  onActiveRoleChange,
  onActivePartTypeChange,
  onCancel,
  onDone,
  onSelect,
  onSelectDimension,
  onSetDrawActive,
  onSetDimensionToolActive,
  onSetPendingDimensionValue,
  onCommitPendingDimension,
  onCancelPendingDimension,
  onSetPreviewPoint,
  onMoveDraftPoint,
  onMoveShapePoint,
  onMoveShapeLine,
  onMoveShapePoints,
  onBeginUndoableEdit,
  onSelectPoint,
  onSelectDimensionTarget,
  onJoinToPoint,
  onJoinToSegment,
  onMoveDraftTangent,
  onMoveShapeTangent,
  onSetDraftSegmentMode,
  onSetShapeSegmentMode,
  activeAirfoilStation,
  onActiveAirfoilStationChange,
  onToggleDraftPoint,
  onInsertShapePoint,
  onDeleteShapePoint,
}: {
  shapes: SizeShape[];
  selectedShapeId: string;
  joinSourcePoint: JoinPointSelection | null;
  draftPoints: SizePoint[];
  draftPreviewPoint: SizePoint | null;
  draftRole: SizeShapeRole;
  drawActive: boolean;
  dimensionDraft: DimensionDraft;
  dimensions: SizeDimension[];
  dimensionToolActive: boolean;
  selectedDimensionId: string | null;
  pendingDimension: PendingDimension;
  pendingDimensionValue: string;
  activePartType: PartType;
  analysis?: SizingAnalysis;
  onAddPoint: (point: SizePoint) => void;
  onActiveRoleChange: (role: SizeShapeRole) => void;
  onActivePartTypeChange: (partType: PartType) => void;
  onCancel: () => void;
  onDone: () => void;
  onSelect: (id: string) => void;
  onSelectDimension: (id: string) => void;
  onSetDrawActive: (active: boolean) => void;
  onSetDimensionToolActive: (active: boolean) => void;
  onSetPendingDimensionValue: (value: string) => void;
  onCommitPendingDimension: () => void;
  onCancelPendingDimension: () => void;
  onSetPreviewPoint: (point: SizePoint | null) => void;
	  onMoveDraftPoint: (index: number, point: SizePoint) => void;
	  onMoveShapePoint: (shapeId: string, index: number, point: SizePoint) => void;
  onMoveShapeLine: (shapeId: string, points: SizePoint[]) => void;
  onMoveShapePoints: (shapeId: string, points: SizePoint[]) => void;
  onBeginUndoableEdit: () => void;
  onSelectPoint: (shapeId: string, pointIndex: number) => void;
  onSelectDimensionTarget: (target: SizeDimensionTarget) => void;
  onJoinToPoint: (shapeId: string, pointIndex: number) => void;
  onJoinToSegment: (shapeId: string, point: SizePoint) => void;
	  onMoveDraftTangent: (index: number, side: "in" | "out", point: SizePoint) => void;
	  onMoveShapeTangent: (shapeId: string, index: number, side: "in" | "out", point: SizePoint) => void;
  onSetDraftSegmentMode: (index: number, side: "in" | "out", mode: "corner" | "spline") => void;
  onSetShapeSegmentMode: (shapeId: string, index: number, side: "in" | "out", mode: "corner" | "spline") => void;
  activeAirfoilStation: AirfoilStation;
  onActiveAirfoilStationChange: (station: AirfoilStation) => void;
	  onToggleDraftPoint: (index: number) => void;
  onInsertShapePoint: (shapeId: string, point: SizePoint) => void;
  onDeleteShapePoint: (shapeId: string, index: number) => void;
}) {
  const [dragTarget, setDragTarget] = useState<
	    | { kind: "draft"; index: number; pointerId: number }
	    | { kind: "shape"; shapeId: string; index: number; pointerId: number }
      | { kind: "shapeBody"; shapeId: string; pointerId: number; startPoint: SizePoint; originalPoints: SizePoint[] }
      | { kind: "shapeLine"; shapeId: string; pointerId: number; startPoint: SizePoint; originalPoints: SizePoint[] }
	    | { kind: "draftTangent"; index: number; side: "in" | "out"; pointerId: number }
	    | { kind: "shapeTangent"; shapeId: string; index: number; side: "in" | "out"; pointerId: number }
	    | null
	  >(null);
  const [canvasView, setCanvasView] = useState<CanvasView>(() => fitCanvasView(shapes));
  const [scaleUnit, setScaleUnit] = useState<ScaleUnit>("cm");
  const [viewMode, setViewMode] = useState<CanvasViewMode>("top");
  const [projectionProgress, setProjectionProgress] = useState(0);
  const [canvasCursorPoint, setCanvasCursorPoint] = useState<SizePoint | null>(null);
  const [referenceMenuOpen, setReferenceMenuOpen] = useState(false);
  const [showGuides, setShowGuides] = useState(true);
  const ignoreNextCanvasClick = useRef(false);
  const pointPlacedOnPress = useRef(false);
  const mirrorPlanes = shapes.filter((shape) => shape.role === "mirrorPlane" && shape.points.length >= 2);
  const visibleShapes = showGuides ? shapes : shapes.filter((shape) => !referenceRoles.includes(shape.role));
  const displayView = {
    ...canvasView,
    originY: viewMode === "front" ? lerp(canvasView.originY, canvasView.height / 2, projectionProgress) : canvasView.originY,
  };
  const displayShapes = projectionProgress > 0 ? visibleShapes.map((shape) => projectedShape(shape, projectionProgress, shapes, viewMode)) : visibleShapes;
  const renderedShapes = [...displayShapes].sort((a, b) => Number(referenceRoles.includes(b.role)) - Number(referenceRoles.includes(a.role)));
  const topDraftPoints = draftRole === "part" ? partShapePointsFromDraft(activePartType, draftPreviewPoint ? [...draftPoints, draftPreviewPoint] : draftPoints) : draftPoints;
  const displayDraftPoints = projectionProgress > 0 ? topDraftPoints.map((point) => flattenPointForFrontView(point, projectionProgress)) : topDraftPoints;
  const displayDraftPreviewPoint =
    draftRole === "part"
      ? null
      : projectionProgress > 0 && draftPreviewPoint
        ? flattenPointForFrontView(draftPreviewPoint, projectionProgress)
        : draftPreviewPoint;
  const canEditCanvas = viewMode === "top" && projectionProgress <= 0.001;
  const drawIsSplineTool = drawActive && !referenceRoles.includes(draftRole);
  const dimensionPrompt = dimensionToolActive && !pendingDimension
    ? dimensionDraft
      ? "Click second element"
      : "Click first element"
    : null;

  useEffect(() => {
    const start = performance.now();
    const from = projectionProgress;
    const to = viewMode === "top" ? 0 : 1;
    const durationMs = 180;
    let frame = 0;
    function tick(now: number) {
      const t = Math.min(1, (now - start) / durationMs);
      const eased = 1 - Math.pow(1 - t, 3);
      setProjectionProgress(from + (to - from) * eased);
      if (t < 1) frame = requestAnimationFrame(tick);
    }
    frame = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(frame);
  }, [viewMode]);

  function pointFromEvent(event: MouseEvent<SVGSVGElement> | PointerEvent<SVGSVGElement>, snap = true) {
    const cursorPoint = svgPointFromEvent(event, displayView);
    return pointFromCanvasCursor(cursorPoint, snap);
  }

  function pointFromClientEvent(event: PointerEvent<SVGPathElement>, snap = true) {
    const svg = event.currentTarget.ownerSVGElement;
    if (!svg) return { xM: 0, yM: 0, curveMode: "spline" as const };
    const cursorPoint = svgPointFromClient(svg, event.clientX, event.clientY, displayView);
    return pointFromCanvasCursor(cursorPoint, snap);
  }

  function pointFromCanvasCursor(cursorPoint: { x: number; y: number }, snap = true) {
    const point = fromCanvas(cursorPoint.x, cursorPoint.y, displayView);
    const snapped = snap ? snapPoint(point, canvasView, shapes, draftPoints) : point;
    const axisLockedPoint =
      referenceRoles.includes(draftRole) && draftPoints.length === 1 ? axisAlignedPoint(draftPoints[0], snapped) : snapped;
    return { ...axisLockedPoint, xM: Math.abs(axisLockedPoint.xM), curveMode: "spline" as const };
  }

  function handleCanvasClick(event: MouseEvent<SVGSVGElement>) {
    if (pointPlacedOnPress.current) {
      pointPlacedOnPress.current = false;
      return;
    }
    if (ignoreNextCanvasClick.current) {
      ignoreNextCanvasClick.current = false;
      return;
    }
    if ((event.target as Element).closest(".shape-node") && !drawActive) return;
    if ((event.target as Element).closest(".curve-toggle")) return;
    if ((event.target as Element).closest(".tangent-handle")) return;
    if (!canEditCanvas) {
      if (!drawActive) onSelect("");
      return;
    }
    if (!drawActive) {
      onSelect("");
      return;
    }
    onAddPoint(pointFromEvent(event));
  }

  function handleCanvasPointerDown(event: PointerEvent<SVGSVGElement>) {
    if (!canEditCanvas) return;
    if (!drawActive || event.button !== 0) return;
    if ((event.target as Element).closest(".curve-toggle, .tangent-handle, .axis-unit-option")) return;
    pointPlacedOnPress.current = true;
    onAddPoint(pointFromEvent(event));
  }

  function handleCanvasMouseDown(event: MouseEvent<SVGSVGElement>) {
    if (!canEditCanvas) return;
    if (!drawActive || event.button !== 0 || pointPlacedOnPress.current) return;
    if ((event.target as Element).closest(".curve-toggle, .tangent-handle, .axis-unit-option")) return;
    pointPlacedOnPress.current = true;
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
	    const point = pointFromEvent(event, false);
    setCanvasCursorPoint(point);
    if (dragTarget.kind === "draft") {
	      onMoveDraftPoint(dragTarget.index, point);
	    } else if (dragTarget.kind === "shape") {
	      onMoveShapePoint(dragTarget.shapeId, dragTarget.index, point);
    } else if (dragTarget.kind === "shapeBody") {
      onMoveShapePoints(
        dragTarget.shapeId,
        translateShapePointsForDrag(dragTarget.originalPoints, dragTarget.startPoint, point),
      );
    } else if (dragTarget.kind === "shapeLine") {
      onMoveShapeLine(
        dragTarget.shapeId,
        translateReferenceLinePoints(dragTarget.originalPoints, dragTarget.startPoint, point),
      );
	    } else if (dragTarget.kind === "draftTangent") {
	      onMoveDraftTangent(dragTarget.index, dragTarget.side, point);
	    } else {
	      onMoveShapeTangent(dragTarget.shapeId, dragTarget.index, dragTarget.side, point);
	    }
	  }

  function handlePointerUp(event: PointerEvent<SVGSVGElement>) {
    if (!dragTarget || dragTarget.pointerId !== event.pointerId) return;
    if (
      dragTarget.kind === "shape" ||
      dragTarget.kind === "shapeBody" ||
      dragTarget.kind === "shapeLine" ||
      dragTarget.kind === "shapeTangent"
    ) {
      ignoreNextCanvasClick.current = true;
    }
    event.currentTarget.releasePointerCapture(event.pointerId);
    setDragTarget(null);
  }

  function handleWheel(event: WheelEvent<SVGSVGElement>) {
    event.preventDefault();
    if (!event.ctrlKey && !event.metaKey) {
      setCanvasView((current) => ({
        ...current,
        originX: current.originX - event.deltaX,
        originY: current.originY - event.deltaY,
      }));
      return;
    }
    const zoomFactor = Math.exp(-event.deltaY * 0.0025);
    const cursor = svgPointFromEvent(event, displayView);
    const cursorWorld = fromCanvas(cursor.x, cursor.y, displayView);
    setCanvasView((current) => {
      const nextScale = Math.min(baseCanvasView.scale * 80, Math.max(baseCanvasView.scale * 0.25, current.scale * zoomFactor));
      return {
        ...current,
        originX: cursor.x - cursorWorld.xM * nextScale,
        originY: cursor.y + cursorWorld.yM * nextScale,
        scale: nextScale,
      };
    });
  }

  return (
    <div className="sizing-canvas-wrap">
      {viewMode === "front" ? (
        <button className="canvas-view-button canvas-view-button-bottom" onClick={() => setViewMode("top")} type="button">
          Top
        </button>
      ) : (
        <button className="canvas-view-button canvas-view-button-top" onClick={() => setViewMode("front")} type="button">
          Front
        </button>
      )}
      {viewMode === "side" ? (
        <button className="canvas-view-button canvas-view-button-left" onClick={() => setViewMode("top")} type="button">
          Top
        </button>
      ) : (
        <button className="canvas-view-button canvas-view-button-right" onClick={() => setViewMode("side")} type="button">
          Side
        </button>
      )}
      <div className={`canvas-reference-menu ${referenceMenuOpen ? "open" : ""}`}>
        <button
          className={referenceRoles.includes(draftRole) || dimensionToolActive ? "active" : ""}
          onClick={() => setReferenceMenuOpen((open) => !open)}
          type="button"
        >
          +
        </button>
        <div className="canvas-reference-options">
          <button
            className={draftRole === "referenceLine" ? "active" : ""}
            onClick={() => {
              onActiveRoleChange("referenceLine");
              onSetDimensionToolActive(false);
              onSetDrawActive(true);
              setReferenceMenuOpen(false);
            }}
            type="button"
          >
            Line
          </button>
          <button
            className={draftRole === "mirrorPlane" ? "active" : ""}
            onClick={() => {
              onActiveRoleChange("mirrorPlane");
              onSetDimensionToolActive(false);
              onSetDrawActive(true);
              setReferenceMenuOpen(false);
            }}
            type="button"
          >
            Plane
          </button>
          <button
            className={dimensionToolActive ? "active" : ""}
            onClick={() => {
              onSetDimensionToolActive(true);
              setReferenceMenuOpen(false);
            }}
            type="button"
          >
            Dimension
          </button>
        </div>
      </div>
      {dimensionPrompt ? <div className="canvas-dimension-prompt">{dimensionPrompt}</div> : null}
      {pendingDimension ? (
        <div className="canvas-dimension-entry">
          <label>
            <span>Dimension</span>
            <input
              autoFocus
              type="number"
              step="0.001"
              value={pendingDimensionValue}
              onChange={(event) => onSetPendingDimensionValue(event.target.value)}
              onKeyDown={(event) => {
                if (event.key === "Enter") onCommitPendingDimension();
                if (event.key === "Escape") onCancelPendingDimension();
              }}
            />
          </label>
          <button onClick={onCommitPendingDimension} type="button">Lock</button>
          <button onClick={onCancelPendingDimension} type="button">Cancel</button>
        </div>
      ) : null}
      <div className={`canvas-sketch-toolbar ${drawActive ? "drawing" : ""}`}>
        <button
          className={drawIsSplineTool ? "active" : ""}
          onClick={() => {
            if (referenceRoles.includes(draftRole)) onActiveRoleChange("body");
            onSetDimensionToolActive(false);
            onSetDrawActive(!drawIsSplineTool);
            setReferenceMenuOpen(false);
          }}
        >
          Draw
        </button>
        <button className="done-button" disabled={draftPoints.length < 2} onClick={onDone}>
          Done
        </button>
        <button className="cancel-button" disabled={!draftPoints.length && !drawActive} onClick={onCancel}>
          Cancel
        </button>
        {drawIsSplineTool ? (
          <div className="canvas-role-toggle" aria-label="Shape type">
            <button
              className={draftRole === "body" ? "active" : ""}
              onClick={() => {
                onActiveRoleChange("body");
                setReferenceMenuOpen(false);
              }}
            >
              Body
            </button>
            <button
              className={draftRole === "liftingSurface" ? "active" : ""}
              onClick={() => {
                onActiveRoleChange("liftingSurface");
                setReferenceMenuOpen(false);
              }}
            >
              Lifting surface
            </button>
            <button
              className={`part-role-button ${draftRole === "part" ? "active" : ""}`}
              onClick={() => {
                onActiveRoleChange("part");
                setReferenceMenuOpen(false);
              }}
            >
              Part
            </button>
            {draftRole === "part" ? (
              <select
                aria-label="Part type"
                className="canvas-part-type-select"
                value={activePartType}
                onChange={(event) => onActivePartTypeChange(event.target.value as PartType)}
              >
                {drawablePartTypes.map((partType) => (
                  <option key={partType} value={partType}>
                    {partTypeLabels[partType]}
                  </option>
                ))}
              </select>
            ) : null}
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
        onMouseDown={handleCanvasMouseDown}
        onMouseMove={handleMouseMove}
        onPointerCancel={handlePointerUp}
        onPointerDown={handleCanvasPointerDown}
        onPointerMove={handlePointerMove}
        onPointerUp={handlePointerUp}
        onWheel={handleWheel}
        role="img"
        viewBox={`0 0 ${displayView.width} ${displayView.height}`}
        aria-label={viewMode === "top" ? "Top down half aircraft sizing sketch" : `${viewMode} projected aircraft sizing reference`}
      >
      <SizingGrid onSetUnit={setScaleUnit} unit={scaleUnit} view={displayView} />
      <line className="sizing-centerline" x1={displayView.originX} y1="20" x2={displayView.originX} y2={displayView.height - 28} />
      <circle className="sizing-origin" cx={displayView.originX} cy={displayView.originY} r="5" />
      <text className="view-label" x="28" y="42">{viewMode === "top" ? "Top down half sketch" : `${viewMode[0].toUpperCase() + viewMode.slice(1)} projected reference`}</text>
      {isPointVisible(displayView.originX, displayView.originY, displayView) ? (
        <text className="view-label subtle" x={displayView.originX + 10} y={displayView.originY - 12}>origin</text>
      ) : null}
      <g>
        {renderedShapes.map((shape, index) => (
          <SketchShape
            drawActive={drawActive}
            dimensionToolActive={dimensionToolActive}
            key={shape.id}
            labelYOffset={viewMode !== "top" ? -14 - (index % 8) * 13 : 0}
            onSelect={() => onSelect(shape.id)}
            readOnly={viewMode !== "top"}
            selected={shape.id === selectedShapeId}
            shape={shape}
            showOriginMirror={viewMode !== "side"}
            mirrorPlanes={viewMode !== "top" ? [] : mirrorPlanes}
            onBeginShapeDrag={(event) => {
              onBeginUndoableEdit();
              event.currentTarget.ownerSVGElement?.setPointerCapture(event.pointerId);
              setDragTarget({
                kind: "shapeBody",
                shapeId: shape.id,
                pointerId: event.pointerId,
                startPoint: pointFromClientEvent(event, false),
                originalPoints: cloneSizePoints(shape.points),
              });
            }}
            onBeginDrag={(index, event) => {
                onBeginUndoableEdit();
	              event.currentTarget.ownerSVGElement?.setPointerCapture(event.pointerId);
	              setDragTarget({ kind: "shape", shapeId: shape.id, index, pointerId: event.pointerId });
	            }}
            onBeginLineDrag={(event) => {
              if (event.shiftKey) {
                event.stopPropagation();
                onJoinToSegment(shape.id, pointFromClientEvent(event, false));
                return;
              }
              onBeginUndoableEdit();
              event.currentTarget.ownerSVGElement?.setPointerCapture(event.pointerId);
              setDragTarget({
                kind: "shapeLine",
                shapeId: shape.id,
                pointerId: event.pointerId,
                startPoint: pointFromClientEvent(event, false),
                originalPoints: cloneSizePoints(shape.points),
              });
            }}
            onBeginTangentDrag={(index, side, event) => {
                onBeginUndoableEdit();
	              event.currentTarget.ownerSVGElement?.setPointerCapture(event.pointerId);
	              setDragTarget({ kind: "shapeTangent", shapeId: shape.id, index, side, pointerId: event.pointerId });
	            }}
            onSelectPoint={(index) => onSelectPoint(shape.id, index)}
            onSelectDimensionTarget={onSelectDimensionTarget}
            onJoinToPoint={(index) => onJoinToPoint(shape.id, index)}
            onJoinToSegment={(point) => onJoinToSegment(shape.id, point)}
            onSetSegmentMode={(index, side, mode) => onSetShapeSegmentMode(shape.id, index, side, mode)}
            activeAirfoilStation={activeAirfoilStation}
            onActiveAirfoilStationChange={onActiveAirfoilStationChange}
            onInsertPoint={(point) => onInsertShapePoint(shape.id, point)}
            onDeletePoint={(index) => onDeleteShapePoint(shape.id, index)}
            joinSourcePoint={joinSourcePoint?.shapeId === shape.id ? joinSourcePoint : null}
	            view={displayView}
	          />
        ))}
      </g>
      {displayDraftPoints.length ? (
        <DraftShape
          onTogglePoint={onToggleDraftPoint}
          partType={draftRole === "part" ? activePartType : undefined}
	          onBeginDrag={(index, event) => {
	            event.currentTarget.ownerSVGElement?.setPointerCapture(event.pointerId);
	            setDragTarget({ kind: "draft", index, pointerId: event.pointerId });
	          }}
	          onBeginTangentDrag={(index, side, event) => {
	            event.currentTarget.ownerSVGElement?.setPointerCapture(event.pointerId);
	            setDragTarget({ kind: "draftTangent", index, side, pointerId: event.pointerId });
	          }}
	          onSetSegmentMode={onSetDraftSegmentMode}
	          points={displayDraftPoints}
          previewPoint={displayDraftPreviewPoint}
          role={draftRole}
          view={displayView}
        />
      ) : null}
      {viewMode === "top" ? (
        <DimensionLayer
          dimensionDraft={dimensionDraft}
          dimensions={dimensions}
          onSelectDimension={onSelectDimension}
          selectedDimensionId={selectedDimensionId}
          shapes={shapes}
          view={displayView}
        />
      ) : null}
      {analysis && showGuides && viewMode === "top" ? <AnalysisMarkers analysis={analysis} view={displayView} /> : null}
      {drawActive && canvasCursorPoint && viewMode === "top" ? <CanvasCursorPoint point={canvasCursorPoint} view={displayView} /> : null}
      </svg>
      <button
        className={`canvas-guide-toggle ${showGuides ? "active" : ""}`}
        onClick={(event) => {
          event.stopPropagation();
          setShowGuides((visible) => !visible);
        }}
        title={showGuides ? "Hide reference lines, planes, CoM, and CoP" : "Show reference lines, planes, CoM, and CoP"}
        type="button"
      >
        {showGuides ? <EyeOff size={15} /> : <Eye size={15} />}
        <span>Guides</span>
      </button>
    </div>
  );
}

function SizingGrid({ view, unit, onSetUnit }: { view: CanvasView; unit: ScaleUnit; onSetUnit: (unit: ScaleUnit) => void }) {
  const majorTickM = chooseMajorTickMeters(view.scale);
  const minorTickM = chooseMinorTickMeters(majorTickM);
  const gridLines = [];
  const axisTicks = [];
  const stickyAxisX = clamp(view.originX, 28, view.width - 28);
  const stickyAxisY = clamp(view.originY, 30, view.height - 30);
  const firstX = Math.floor(fromCanvas(0, stickyAxisY, view).xM / minorTickM) * minorTickM;
  const lastX = Math.ceil(fromCanvas(view.width, stickyAxisY, view).xM / minorTickM) * minorTickM;
  const firstY = Math.floor(fromCanvas(stickyAxisX, view.height, view).yM / minorTickM) * minorTickM;
  const lastY = Math.ceil(fromCanvas(stickyAxisX, 0, view).yM / minorTickM) * minorTickM;

  for (let xM = firstX; xM <= lastX; xM += minorTickM) {
    const normalized = snapNumber(xM, minorTickM);
    const isMajor = isMultipleOf(normalized, majorTickM);
    const x = toCanvas({ xM, yM: 0 }, view).x;
    gridLines.push(<line className={isMajor ? "major" : "minor"} key={`v-${normalized}`} x1={x} y1="0" x2={x} y2={view.height} />);
    if (isMajor && Math.abs(normalized) > 0.0001) {
      axisTicks.push(
        <g key={`xt-${normalized}`}>
          <line x1={x} y1={stickyAxisY - 5} x2={x} y2={stickyAxisY + 5} />
          <text x={x + 4} y={stickyAxisY + 18}>{formatScaleValue(normalized, unit)}</text>
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
          <line x1={stickyAxisX - 5} y1={y} x2={stickyAxisX + 5} y2={y} />
          <text x={stickyAxisX + 10} y={y - 5}>{formatScaleValue(normalized, unit)}</text>
        </g>,
      );
    }
  }

  return (
    <>
      <g className="sizing-grid">{gridLines}</g>
      <g className="sizing-axes">
        <line x1="20" y1={stickyAxisY} x2={view.width - 24} y2={stickyAxisY} />
        <line x1={stickyAxisX} y1="20" x2={stickyAxisX} y2={view.height - 24} />
        {axisTicks}
        <text className="axis-name" x={view.width - 46} y={stickyAxisY - 10}>X</text>
        <text className="axis-name" x={stickyAxisX + 12} y="32">Y</text>
        <g className="axis-unit-options">
          <title>Canvas units</title>
          {scaleUnits.map((option, index) => (
            <text
              className={`axis-unit-option ${unit === option ? "active" : ""}`}
              key={option}
              onClick={() => onSetUnit(option)}
              x={stickyAxisX + 34 + index * 28}
              y="32"
            >
              {option}
            </text>
          ))}
        </g>
      </g>
    </>
  );
}

type CanvasView = { width: number; height: number; originX: number; originY: number; scale: number };
type SideProjectionFrame = { baselineY: number; longitudinalSign: 1 | -1 };

function fitCanvasView(shapes: SizeShape[], viewMode: CanvasViewMode = "top") {
  const points = shapes.flatMap((shape) => shape.points);
  if (!points.length) return baseCanvasView;

  if (viewMode === "side") {
    const maxAbsX = Math.max(0.05, ...points.map((point) => Math.abs(point.xM)));
    const maxY = Math.max(0.05, ...points.map((point) => point.yM));
    const minY = Math.min(0, ...points.map((point) => point.yM));
    const originY = baseCanvasView.height * 0.1;
    const paddingPx = 42;
    const scale = Math.min(
      (baseCanvasView.width - paddingPx * 2) / Math.max(maxAbsX * 2, 0.2),
      (originY - paddingPx) / Math.max(maxY, 0.05),
      (baseCanvasView.height - originY - 18) / Math.max(Math.abs(minY), 0.02),
      baseCanvasView.scale * 24,
    );
    return {
      ...baseCanvasView,
      originX: baseCanvasView.width / 2,
      originY,
      scale,
    };
  }

  const maxAbsX = Math.max(0.05, ...points.map((point) => Math.abs(point.xM)));
  const minX = -maxAbsX;
  const maxX = maxAbsX;
  const minY = Math.min(0, ...points.map((point) => point.yM));
  const maxY = Math.max(0, ...points.map((point) => point.yM));
  const paddingPx = 86;
  const widthM = Math.max(maxX - minX, 0.2);
  const heightM = Math.max(maxY - minY, 0.2);
  const scale = Math.min(
    (baseCanvasView.width - paddingPx * 2) / widthM,
    (baseCanvasView.height - paddingPx * 2) / heightM,
    baseCanvasView.scale * 24,
  );
  const centerX = (minX + maxX) / 2;
  const centerY = (minY + maxY) / 2;

  const fitted = {
    ...baseCanvasView,
    originX: baseCanvasView.width / 2 - centerX * scale,
    originY: baseCanvasView.height / 2 + centerY * scale,
    scale,
  };
  return fitted;
}

function chooseMajorTickMeters(scale: number) {
  const targetPixels = 72;
  const rawMeters = targetPixels / scale;
  const magnitude = 10 ** Math.floor(Math.log10(rawMeters));
  const normalized = rawMeters / magnitude;
  const step = normalized <= 1 ? 1 : normalized <= 2 ? 2 : normalized <= 5 ? 5 : 10;
  return step * magnitude;
}

function chooseMinorTickMeters(majorTickM: number) {
  const defaultMinor = majorTickM / 5;
  const magnitude = 10 ** Math.floor(Math.log10(defaultMinor));
  const normalized = defaultMinor / magnitude;
  return Math.abs(normalized - 2) < 0.001 ? magnitude : defaultMinor;
}

function formatScaleValue(valueM: number, unit: ScaleUnit) {
  const multiplier = unit === "m" ? 1 : unit === "cm" ? 100 : 1000;
  const value = valueM * multiplier;
  if (Math.abs(value) >= 100 || Number.isInteger(value)) return value.toFixed(0);
  if (Math.abs(value) >= 10) return value.toFixed(1);
  return value.toFixed(2);
}

function snapPoint(point: SizePoint, view: CanvasView, shapes: SizeShape[], draftPoints: SizePoint[] = []) {
  const geometrySnap = snapPointToGeometry(point, view, shapes);
  const draftSnap = snapPointToDraft(point, view, draftPoints);
  return geometrySnap ?? draftSnap ?? snapPointToGrid(point, view);
}

function snapPointToGeometry(point: SizePoint, view: CanvasView, shapes: SizeShape[]) {
  const nodeThresholdM = 18 / view.scale;
  const segmentThresholdM = 16 / view.scale;
  let bestNode: { point: SizePoint; distanceM: number } | undefined;
  let bestSegment: { point: SizePoint; distanceM: number } | undefined;

  for (const shape of shapes) {
    for (let pointIndex = 0; pointIndex < shape.points.length; pointIndex += 1) {
      const shapePoint = shape.points[pointIndex];
      const candidate = {
        ...shapePoint,
        xM: Math.abs(shapePoint.xM),
        snapAttachment: { kind: "node", shapeId: shape.id, pointIndex } as SizeSnapAttachment,
      };
      const distanceM = distanceBetweenPoints(point, candidate);
      if (distanceM <= nodeThresholdM && (!bestNode || distanceM < bestNode.distanceM)) {
        bestNode = { point: candidate, distanceM };
      }
    }

    for (let index = 0; index < shape.points.length - 1; index += 1) {
      const projection = projectPointToShapeSegment(point, shape.points, index);
      const candidate = {
        ...projection.point,
        snapAttachment: { kind: "segment", shapeId: shape.id, segmentIndex: index, t: projection.t } as SizeSnapAttachment,
      };
      const distanceM = distanceBetweenPoints(point, candidate);
      if (distanceM <= segmentThresholdM && (!bestSegment || distanceM < bestSegment.distanceM)) {
        bestSegment = { point: candidate, distanceM };
      }
    }
  }

  return bestNode?.point ?? bestSegment?.point;
}

function snapPointToDraft(point: SizePoint, view: CanvasView, draftPoints: SizePoint[]) {
  if (!draftPoints.length) return undefined;
  const nodeThresholdM = 18 / view.scale;
  const segmentThresholdM = 16 / view.scale;
  let bestNode: { point: SizePoint; distanceM: number } | undefined;
  let bestSegment: { point: SizePoint; distanceM: number } | undefined;

  for (const draftPoint of draftPoints) {
    const candidate = { ...draftPoint, xM: Math.abs(draftPoint.xM), snapAttachment: undefined };
    const distanceM = distanceBetweenPoints(point, candidate);
    if (distanceM <= nodeThresholdM && (!bestNode || distanceM < bestNode.distanceM)) {
      bestNode = { point: candidate, distanceM };
    }
  }

  for (let index = 0; index < draftPoints.length - 1; index += 1) {
    const projection = projectPointToShapeSegment(point, draftPoints, index);
    const candidate = { ...projection.point, snapAttachment: undefined };
    const distanceM = distanceBetweenPoints(point, candidate);
    if (distanceM <= segmentThresholdM && (!bestSegment || distanceM < bestSegment.distanceM)) {
      bestSegment = { point: candidate, distanceM };
    }
  }

  return bestNode?.point ?? bestSegment?.point;
}

function snapPointToGrid(point: SizePoint, view: CanvasView) {
  const tickM = chooseMinorTickMeters(chooseMajorTickMeters(view.scale));
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

function isPointVisible(x: number, y: number, view: CanvasView) {
  return x >= 0 && x <= view.width && y >= 0 && y <= view.height;
}

function clamp(value: number, min: number, max: number) {
  return Math.min(max, Math.max(min, value));
}

function distanceBetweenPoints(a: SizePoint, b: SizePoint) {
  return Math.hypot(a.xM - b.xM, a.yM - b.yM);
}

function axisAlignedPoint(anchor: SizePoint, point: SizePoint) {
  const dx = point.xM - anchor.xM;
  const dy = point.yM - anchor.yM;
  return Math.abs(dx) >= Math.abs(dy) ? { ...point, yM: anchor.yM } : { ...point, xM: anchor.xM };
}

function projectPointToSegment(point: SizePoint, start: SizePoint, end: SizePoint) {
  const dx = end.xM - start.xM;
  const dy = end.yM - start.yM;
  const lengthSquared = dx * dx + dy * dy;
  if (lengthSquared <= 1e-9) return { point: start, t: 0 };
  const rawT = ((point.xM - start.xM) * dx + (point.yM - start.yM) * dy) / lengthSquared;
  const t = Math.min(1, Math.max(0, rawT));
  return {
    point: {
      xM: start.xM + dx * t,
      yM: start.yM + dy * t,
    },
    t,
  };
}

function projectPointToShapeSegment(point: SizePoint, points: SizePoint[], segmentIndex: number) {
  const start = points[segmentIndex];
  const end = points[segmentIndex + 1];
  if (!start || !end) return { point, t: 0 };
  const segmentMode = start.segmentOutMode ?? end.segmentInMode ?? "corner";
  if (segmentMode !== "spline") {
    return projectPointToSegment(point, start, end);
  }

  let best = { point: start, t: 0, distanceM: Number.POSITIVE_INFINITY };
  let previous = pointAtShapeSegmentT(points, segmentIndex, 0);
  const samples = 32;
  for (let sample = 1; sample <= samples; sample += 1) {
    const nextT = sample / samples;
    const next = pointAtShapeSegmentT(points, segmentIndex, nextT);
    const projection = projectPointToSegment(point, previous, next);
    const segmentStartT = (sample - 1) / samples;
    const t = segmentStartT + (nextT - segmentStartT) * projection.t;
    const distanceM = distanceBetweenPoints(point, projection.point);
    if (distanceM < best.distanceM) {
      best = { point: projection.point, t, distanceM };
    }
    previous = next;
  }
  return { point: best.point, t: best.t };
}

function pointAtShapeSegmentT(points: SizePoint[], segmentIndex: number, t: number): SizePoint {
  const start = points[segmentIndex];
  const end = points[segmentIndex + 1];
  if (!start || !end) return { xM: 0, yM: 0 };
  const segmentMode = start.segmentOutMode ?? end.segmentInMode ?? "corner";
  if (segmentMode !== "spline") {
    return {
      xM: start.xM + (end.xM - start.xM) * t,
      yM: start.yM + (end.yM - start.yM) * t,
    };
  }

  const c1 = tangentWorldPoint(start, "out", points, segmentIndex);
  const c2 = tangentWorldPoint(end, "in", points, segmentIndex + 1);
  return cubicPoint(start, c1, c2, end, t);
}

function tangentWorldPoint(point: SizePoint, side: "in" | "out", points: SizePoint[], index: number): SizePoint {
  const vector = side === "in" ? point.tangentIn : point.tangentOut;
  if (vector) {
    return {
      xM: point.xM + vector.xM,
      yM: point.yM + vector.yM,
    };
  }
  const neighbor = side === "in" ? points[index - 1] : points[index + 1];
  if (!neighbor) return point;
  return {
    xM: point.xM + (neighbor.xM - point.xM) / 3,
    yM: point.yM + (neighbor.yM - point.yM) / 3,
  };
}

function cubicPoint(p0: SizePoint, p1: SizePoint, p2: SizePoint, p3: SizePoint, t: number): SizePoint {
  const mt = 1 - t;
  const a = mt * mt * mt;
  const b = 3 * mt * mt * t;
  const c = 3 * mt * t * t;
  const d = t * t * t;
  return {
    xM: p0.xM * a + p1.xM * b + p2.xM * c + p3.xM * d,
    yM: p0.yM * a + p1.yM * b + p2.yM * c + p3.yM * d,
  };
}

function svgPointFromEvent(event: MouseEvent<SVGSVGElement> | PointerEvent<SVGSVGElement>, view: CanvasView) {
  const svg = event.currentTarget;
  return svgPointFromClient(svg, event.clientX, event.clientY, view);
}

function pointFromShapeEvent(event: MouseEvent<SVGGElement>, view: CanvasView): SizePoint {
  const svg = event.currentTarget.ownerSVGElement;
  if (!svg) return { xM: 0, yM: 0 };
  const point = svgPointFromClient(svg, event.clientX, event.clientY, view);
  return { ...fromCanvas(point.x, point.y, view), xM: Math.abs(fromCanvas(point.x, point.y, view).xM), curveMode: "spline" };
}

function pointFromShapePointerEvent(event: PointerEvent<SVGPathElement>, view: CanvasView): SizePoint {
  const svg = event.currentTarget.ownerSVGElement;
  if (!svg) return { xM: 0, yM: 0, curveMode: "spline" };
  const point = svgPointFromClient(svg, event.clientX, event.clientY, view);
  const worldPoint = fromCanvas(point.x, point.y, view);
  return { ...worldPoint, xM: Math.abs(worldPoint.xM), curveMode: "spline" };
}

function svgPointFromClient(svg: SVGSVGElement, clientX: number, clientY: number, view: CanvasView) {
  const matrix = svg.getScreenCTM();
  if (matrix && typeof svg.createSVGPoint === "function") {
    const point = svg.createSVGPoint();
    point.x = clientX;
    point.y = clientY;
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
    x: (clientX - rect.left - offsetX) / scale,
    y: (clientY - rect.top - offsetY) / scale,
  };
}

function SketchShape({
  activeAirfoilStation,
  drawActive,
  dimensionToolActive,
  labelYOffset = 0,
  mirrorPlanes,
  readOnly = false,
  shape,
  showOriginMirror = true,
  selected,
  view,
  joinSourcePoint,
  onSelect,
  onBeginShapeDrag,
  onBeginDrag,
  onBeginLineDrag,
  onBeginTangentDrag,
  onSelectPoint,
  onSelectDimensionTarget,
  onJoinToPoint,
  onJoinToSegment,
  onActiveAirfoilStationChange,
  onSetSegmentMode,
  onInsertPoint,
  onDeletePoint,
}: {
  activeAirfoilStation: AirfoilStation;
  drawActive: boolean;
  dimensionToolActive: boolean;
  labelYOffset?: number;
  mirrorPlanes: SizeShape[];
  readOnly?: boolean;
  shape: SizeShape;
  showOriginMirror?: boolean;
  selected: boolean;
  view: CanvasView;
  joinSourcePoint: JoinPointSelection | null;
  onSelect: () => void;
  onBeginShapeDrag: (event: PointerEvent<SVGPathElement>) => void;
  onBeginDrag: (index: number, event: PointerEvent<SVGCircleElement>) => void;
  onBeginLineDrag: (event: PointerEvent<SVGPathElement>) => void;
  onBeginTangentDrag: (index: number, side: "in" | "out", event: PointerEvent<SVGCircleElement>) => void;
  onSelectPoint: (index: number) => void;
  onSelectDimensionTarget: (target: SizeDimensionTarget) => void;
  onJoinToPoint: (index: number) => void;
  onJoinToSegment: (point: SizePoint) => void;
  onActiveAirfoilStationChange: (station: AirfoilStation) => void;
  onSetSegmentMode: (index: number, side: "in" | "out", mode: "corner" | "spline") => void;
  onInsertPoint: (point: SizePoint) => void;
  onDeletePoint: (index: number) => void;
}) {
  const lastNodeTapRef = useRef<{ index: number; time: number; x: number; y: number } | null>(null);
  const suppressClickAfterDeleteRef = useRef(false);
  const renderPoints = shape.partType === "rotor" ? rotorFlarePointsFromSpan(shape.points) : shape.points;
  const mirrored = mirrorPoints(renderPoints);
  const nodePoints = shape.partType === "rotor" ? rotorSpanPoints(shape.points) : shape.points;
  const localMirrorPlanes = shouldUseLocalMirror(shape)
    ? mirrorPlanes.filter((plane) => plane.id !== shape.id && shapeTouchesMirrorPlane(shape, plane))
    : [];
  const localMirrorSets = localMirrorPlanes.map((plane) => mirrorPointsAcrossPlane(renderPoints, plane));
  const partClass = shape.role === "part" ? `part-${shape.partType ?? "payload"}` : "";
  const className = `sizing-shape ${shape.role} ${partClass} ${selected ? "selected" : ""}`;
  const labelPoint = toCanvas(nodePoints[Math.max(0, Math.floor(nodePoints.length / 2))] ?? renderPoints[0], view);
  const shouldFill = isFillablePartShape({ ...shape, points: renderPoints });
  const showsCurveControls = shape.partType !== "rotor";
  const livePath = shouldFill ? closedPathForPoints(renderPoints, view) : pathForPoints(renderPoints, view);
  const mirrorPath = showOriginMirror ? (shouldFill ? closedPathForPoints(mirrored, view) : pathForPoints(mirrored, view)) : "";
  return (
    <g
      className={`${className} ${shouldFill ? "part-filled" : ""}`}
      onClick={(event) => {
        if (drawActive) return;
        event.stopPropagation();
        if (event.shiftKey) return;
        if (suppressClickAfterDeleteRef.current) {
          suppressClickAfterDeleteRef.current = false;
          return;
        }
        if (shape.partType !== "rotor" && !readOnly && selected && (event.target as Element).closest(".shape-hit")) {
          onInsertPoint(pointFromShapeEvent(event, view));
          return;
        }
        onSelect();
      }}
    >
      <path
        className={`shape-hit shape-hit-live ${shouldFill ? "shape-hit-filled" : ""}`}
        d={livePath}
        onPointerDown={(event) => {
          if (drawActive || readOnly) return;
          event.stopPropagation();
          if (event.shiftKey) {
            onJoinToSegment(pointFromShapePointerEvent(event, view));
            return;
          }
          if (dimensionToolActive) {
            onSelectDimensionTarget(nearestSegmentTarget(shape, pointFromShapePointerEvent(event, view)));
            return;
          }
          if (!referenceRoles.includes(shape.role)) {
            if (!selected) onSelect();
            if (selected && shape.role === "part") {
              suppressClickAfterDeleteRef.current = true;
              window.setTimeout(() => {
                suppressClickAfterDeleteRef.current = false;
              }, 300);
              onBeginShapeDrag(event);
            }
            return;
          }
          if (!referenceRoles.includes(shape.role)) return;
          onBeginLineDrag(event);
        }}
      />
      {showOriginMirror ? <path className="shape-hit shape-hit-mirror" d={mirrorPath} /> : null}
      <path className="shape-live" d={livePath} />
      {localMirrorSets.map((points, index) => (
        <path className="shape-local-mirror" d={shouldFill ? closedPathForPoints(points, view) : pathForPoints(points, view)} key={`local-${index}`} />
      ))}
      {showOriginMirror ? <path className="shape-mirror" d={mirrorPath} /> : null}
      {localMirrorSets.map((points, index) => {
        const globalPoints = mirrorPoints(points);
        return (
          showOriginMirror ? (
            <path
              className="shape-local-global-mirror"
              d={shouldFill ? closedPathForPoints(globalPoints, view) : pathForPoints(globalPoints, view)}
              key={`local-global-${index}`}
            />
          ) : null
        );
      })}
      {showsCurveControls && selected && !readOnly && !referenceRoles.includes(shape.role) ? <TangencyHandles onBeginDrag={onBeginTangentDrag} points={shape.points} view={view} /> : null}
      {showsCurveControls && showOriginMirror && selected && !readOnly && !referenceRoles.includes(shape.role) ? <TangencyHandles mirrored points={mirrorPoints(shape.points)} view={view} /> : null}
      {selected && !readOnly && shape.role === "liftingSurface" ? (
        <AirfoilStations
          activeStation={activeAirfoilStation}
          onSelectStation={onActiveAirfoilStationChange}
          shape={shape}
          view={view}
        />
      ) : null}
      {!readOnly ? nodePoints.map((point, index) => {
        const canvasPoint = toCanvas(point, view);
        const isSelectedNode = joinSourcePoint?.pointIndex === index;
        const isSelectedLockedNode = isSelectedNode && Boolean(point.snapAttachment);
        return (
          <g key={`${shape.id}-${index}`}>
            {showsCurveControls && selected && !readOnly && !referenceRoles.includes(shape.role) ? (
              <NodeCurveControls index={index} onSetSegmentMode={onSetSegmentMode} point={point} points={shape.points} view={view} />
            ) : null}
            {isSelectedNode ? (
              <circle className={`shape-node-selection-ring ${isSelectedLockedNode ? "locked" : ""}`} cx={canvasPoint.x} cy={canvasPoint.y} r="8" />
            ) : null}
            <circle
              className={`shape-node ${point.curveMode === "corner" ? "corner" : "spline"} ${
                isSelectedNode ? "join-source" : ""
              } ${point.snapAttachment ? "joined" : ""} ${isSelectedLockedNode ? "locked-selected" : ""}`}
              cx={canvasPoint.x}
              cy={canvasPoint.y}
              onClick={(event) => {
                event.stopPropagation();
                if (event.shiftKey) return;
                if (shape.partType !== "rotor" && !readOnly && event.detail >= 2) {
                  onDeletePoint(index);
                  return;
                }
                onSelectPoint(index);
              }}
              onPointerDown={(event) => {
                if (drawActive || readOnly) return;
                event.stopPropagation();
                if (event.shiftKey) {
                  onJoinToPoint(index);
                  return;
                }
                if (dimensionToolActive) {
                  onSelectDimensionTarget({ kind: "node", shapeId: shape.id, pointIndex: index });
                  return;
                }
                const now = Date.now();
                const lastTap = lastNodeTapRef.current;
                const isTrackpadDoubleTap =
                  lastTap?.index === index &&
                  now - lastTap.time < 520 &&
                  Math.hypot(event.clientX - lastTap.x, event.clientY - lastTap.y) < 14;
                lastNodeTapRef.current = { index, time: now, x: event.clientX, y: event.clientY };
                if (shape.partType !== "rotor" && (event.detail >= 2 || isTrackpadDoubleTap)) {
                  lastNodeTapRef.current = null;
                  suppressClickAfterDeleteRef.current = true;
                  window.setTimeout(() => {
                    suppressClickAfterDeleteRef.current = false;
                  }, 300);
                  onDeletePoint(index);
                  return;
                }
                onSelectPoint(index);
                onBeginDrag(index, event);
              }}
              onDoubleClick={(event) => {
                event.stopPropagation();
                if (shape.partType !== "rotor") onDeletePoint(index);
              }}
              r="4"
            />
          </g>
        );
      }) : null}
      <text x={labelPoint.x + 8} y={labelPoint.y - 8 + labelYOffset}>{shape.label}</text>
    </g>
  );
}

function DraftShape({
  partType,
  points,
  role,
  previewPoint,
  view,
  onBeginDrag,
  onBeginTangentDrag,
  onSetSegmentMode,
  onTogglePoint,
}: {
  partType?: PartType;
  points: SizePoint[];
  role: SizeShapeRole;
  previewPoint: SizePoint | null;
  view: CanvasView;
  onBeginDrag: (index: number, event: PointerEvent<SVGCircleElement>) => void;
  onBeginTangentDrag: (index: number, side: "in" | "out", event: PointerEvent<SVGCircleElement>) => void;
  onSetSegmentMode: (index: number, side: "in" | "out", mode: "corner" | "spline") => void;
  onTogglePoint: (index: number) => void;
}) {
  const className = `sizing-shape draft ${role} ${role === "part" ? `part-${partType ?? "payload"}` : ""}`;
  const displayPoints = previewPoint ? [...points, { ...previewPoint, preview: true } as SizePoint & { preview: true }] : points;
  const showSplineControls = !referenceRoles.includes(role) && role !== "part";
  const showNodes = role !== "part";
  const renderPoints = role === "part" && partType === "rotor" ? rotorFlarePointsFromSpan(displayPoints) : displayPoints;
  const renderPath = role === "part" && renderPoints.length >= 3 ? closedPathForPoints(renderPoints, view) : pathForPoints(renderPoints, view);
  const mirrorPath = role === "part" && renderPoints.length >= 3 ? closedPathForPoints(mirrorPoints(renderPoints), view) : pathForPoints(mirrorPoints(renderPoints), view);
  return (
    <g className={className}>
      <path className="shape-live" d={renderPath} />
      <path className="shape-mirror" d={mirrorPath} />
      {showSplineControls ? <TangencyHandles onBeginDrag={onBeginTangentDrag} points={displayPoints} view={view} /> : null}
      {showSplineControls ? <TangencyHandles mirrored points={mirrorPoints(displayPoints)} view={view} /> : null}
      {showNodes ? points.map((point, index) => {
        const canvasPoint = toCanvas(point, view);
        return (
          <g key={`draft-${index}`}>
            {showSplineControls ? (
              <NodeCurveControls index={index} onSetSegmentMode={onSetSegmentMode} point={point} points={points} view={view} />
            ) : null}
            <circle
              className={`shape-node ${point.curveMode === "corner" ? "corner" : "spline"}`}
              cx={canvasPoint.x}
              cy={canvasPoint.y}
              onClick={(event) => {
                event.stopPropagation();
              }}
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
      }) : null}
      {previewPoint ? <circle className="shape-node preview" cx={toCanvas(previewPoint, view).x} cy={toCanvas(previewPoint, view).y} r="3" /> : null}
    </g>
  );
}

function AirfoilStations({
  activeStation,
  shape,
  view,
  onSelectStation,
}: {
  activeStation: AirfoilStation;
  shape: SizeShape;
  view: CanvasView;
  onSelectStation: (station: AirfoilStation) => void;
}) {
  const bounds = shapeBounds(shape);
  const stations: { id: AirfoilStation; pct: number; label: string }[] = [
    { id: "root10", pct: 0.1, label: "10%" },
    { id: "tip90", pct: 0.9, label: "90%" },
  ];
  const y1 = toCanvas({ xM: 0, yM: bounds.minY }, view).y;
  const y2 = toCanvas({ xM: 0, yM: bounds.maxY }, view).y;
  const centerY = (y1 + y2) / 2;
  return (
    <g className="airfoil-stations">
      {stations.map((station) => {
        const xM = bounds.minX + (bounds.maxX - bounds.minX) * station.pct;
        const x = toCanvas({ xM, yM: 0 }, view).x;
        return (
          <g className={activeStation === station.id ? "active" : ""} key={station.id}>
            <line x1={x} y1={y1} x2={x} y2={y2} />
            <circle
              cx={x}
              cy={centerY}
              onClick={(event) => {
                event.stopPropagation();
                onSelectStation(station.id);
              }}
              r="5"
            />
            <text x={x + 8} y={centerY - 8}>{station.label}</text>
          </g>
        );
      })}
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
  const offset = 26;
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
      <g className="com-reference">
        <line className="reference-line" x1="24" y1={com.y} x2={view.width - 24} y2={com.y} />
        <text x={view.width - 118} y={com.y - 8}>CoM y {analysis.com.yM.toFixed(2)} m</text>
      </g>
      <g className="cop-reference">
        <line className="reference-line" x1="24" y1={cop.y} x2={view.width - 24} y2={cop.y} />
        <text x={view.width - 118} y={cop.y + 18}>CoP y {analysis.cop.yM.toFixed(2)} m</text>
      </g>
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

function DimensionLayer({
  dimensionDraft,
  dimensions,
  onSelectDimension,
  selectedDimensionId,
  shapes,
  view,
}: {
  dimensionDraft: DimensionDraft;
  dimensions: SizeDimension[];
  onSelectDimension: (id: string) => void;
  selectedDimensionId: string | null;
  shapes: SizeShape[];
  view: CanvasView;
}) {
  const draftPoint = dimensionDraft ? dimensionTargetPoint(dimensionDraft.firstTarget, shapes) : undefined;
  return (
    <g className="dimension-layer">
      {dimensions.map((dimension) => {
        const start = dimensionTargetPoint(dimension.targetA, shapes);
        const end = dimensionTargetPoint(dimension.targetB, shapes);
        if (!start || !end) return null;
        const startCanvas = toCanvas(start, view);
        const endCanvas = toCanvas(end, view);
        const midX = (startCanvas.x + endCanvas.x) / 2;
        const midY = (startCanvas.y + endCanvas.y) / 2;
        const selected = dimension.id === selectedDimensionId;
        return (
          <g
            className={`dimension-lock ${selected ? "selected" : ""}`}
            key={dimension.id}
            onClick={(event) => {
              event.stopPropagation();
              onSelectDimension(dimension.id);
            }}
          >
            <line className="dimension-hit" x1={startCanvas.x} y1={startCanvas.y} x2={endCanvas.x} y2={endCanvas.y} />
            <line x1={startCanvas.x} y1={startCanvas.y} x2={endCanvas.x} y2={endCanvas.y} />
            <circle cx={startCanvas.x} cy={startCanvas.y} r="3" />
            <circle cx={endCanvas.x} cy={endCanvas.y} r="3" />
            <text x={midX + 8} y={midY - 8}>{`${dimension.label} ${trimDimensionValue(dimension.valueM)} m`}</text>
          </g>
        );
      })}
      {draftPoint ? (
        <circle className="dimension-draft-target" cx={toCanvas(draftPoint, view).x} cy={toCanvas(draftPoint, view).y} r="9" />
      ) : null}
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

function closedPathForPoints(points: SizePoint[], view: CanvasView) {
  const path = pathForPoints(points, view);
  return path ? `${path} Z` : "";
}

function isClosedShape(points: SizePoint[]) {
  if (points.length < 3) return false;
  const first = points[0];
  const last = points[points.length - 1];
  return distanceBetweenPoints(first, last) <= 0.005 || (Math.abs(first.xM) <= 1e-6 && Math.abs(last.xM) <= 1e-6);
}

function isFillablePartShape(shape: SizeShape) {
  return shape.role === "part" && shape.points.length >= 3;
}

function cleanPartDraftPoint(point: SizePoint): SizePoint {
  return {
    xM: Math.abs(point.xM),
    yM: point.yM,
    curveMode: "corner",
    segmentInMode: "corner",
    segmentOutMode: "corner",
    tangentIn: undefined,
    tangentOut: undefined,
    snapAttachment: point.snapAttachment,
  };
}

function partShapePointsFromDraft(partType: PartType, points: SizePoint[]) {
  if (points.length < 2) return points.map(cleanPartDraftPoint);
  const start = cleanPartDraftPoint(points[0]);
  const end = cleanPartDraftPoint(points[points.length - 1]);
  if (partType === "rotor") return rotorSpanFromDraft(start, end);
  return rectanglePointsFromDraft(start, end);
}

function rectanglePointsFromDraft(start: SizePoint, end: SizePoint) {
  if (Math.abs(end.xM - start.xM) < 0.001 || Math.abs(end.yM - start.yM) < 0.001) return [start, end];
  return [
    cleanPartDraftPoint(start),
    cleanPartDraftPoint({ xM: end.xM, yM: start.yM }),
    cleanPartDraftPoint(end),
    cleanPartDraftPoint({ xM: start.xM, yM: end.yM }),
  ];
}

function rotorSpanFromDraft(start: SizePoint, end: SizePoint) {
  const span = Math.max(Math.abs(end.xM - start.xM), 0.01);
  const endX = end.xM >= start.xM ? start.xM + span : Math.max(0, start.xM - span);
  return [
    cleanPartDraftPoint(start),
    cleanPartDraftPoint({ xM: endX, yM: start.yM }),
  ];
}

function rotorSpanPoints(points: SizePoint[]) {
  if (points.length < 2) return points.map(cleanPartDraftPoint);
  if (points.length > 2) {
    const xs = points.map((point) => Math.abs(point.xM));
    const ys = points.map((point) => point.yM);
    const minX = Math.min(...xs);
    const maxX = Math.max(...xs);
    const centerY = (Math.min(...ys) + Math.max(...ys)) / 2;
    return [
      cleanPartDraftPoint({ xM: minX, yM: centerY }),
      cleanPartDraftPoint({ xM: maxX, yM: centerY }),
    ];
  }
  return rotorSpanFromDraft(points[0], points[1]);
}

function rotorFlarePointsFromSpan(points: SizePoint[]) {
  const span = rotorSpanPoints(points);
  if (span.length < 2) return span;
  return rotorFlarePointsFromDraft(span[0], span[1]);
}

function rotorFlarePointsFromDraft(start: SizePoint, end: SizePoint) {
  const dx = end.xM - start.xM;
  const dy = 0;
  const length = Math.hypot(dx, dy);
  if (length < 0.001) return [start, end];
  const ux = dx / length;
  const uy = dy / length;
  const px = -uy;
  const py = ux;
  const rootHalfWidth = Math.max(length * 0.09, 0.012);
  const midHalfWidth = Math.max(length * 0.05, 0.008);
  const tipHalfWidth = Math.max(length * 0.025, 0.004);
  const rootInset = length * 0.08;
  const mid = { xM: start.xM + dx * 0.58, yM: start.yM + dy * 0.58 };
  const rootCenter = { xM: start.xM + ux * rootInset, yM: start.yM + uy * rootInset };
  const addOffset = (point: SizePoint | { xM: number; yM: number }, halfWidth: number, side: 1 | -1) =>
    cleanPartDraftPoint({ xM: point.xM + px * halfWidth * side, yM: point.yM + py * halfWidth * side });
  return [
    addOffset(rootCenter, rootHalfWidth, 1),
    addOffset(mid, midHalfWidth, 1),
    addOffset(end, tipHalfWidth, 1),
    addOffset(end, tipHalfWidth, -1),
    addOffset(mid, midHalfWidth, -1),
    addOffset(rootCenter, rootHalfWidth, -1),
  ];
}

function moveRotorEndpoint(points: SizePoint[], index: number, target: SizePoint) {
  const span = rotorSpanPoints(points);
  if (span.length < 2) return span;
  const start = span[0];
  const end = span[1];
  if (index === 0) {
    const nextStart = cleanPartDraftPoint(target);
    const dx = nextStart.xM - start.xM;
    return [
      nextStart,
      cleanPartDraftPoint({ ...end, xM: Math.max(0, end.xM + dx), yM: nextStart.yM }),
    ];
  }
  return [
    start,
    cleanPartDraftPoint({ ...target, yM: start.yM }),
  ];
}

function updateShapePointForJoin(shape: SizeShape, pointIndex: number, joinedPoint: SizePoint): SizeShape {
  if (shape.partType === "rotor") {
    const points = moveRotorEndpoint(shape.points, pointIndex, joinedPoint).map((point, index) =>
      index === pointIndex ? { ...point, snapAttachment: joinedPoint.snapAttachment } : point,
    );
    return { ...shape, points };
  }
  return {
    ...shape,
    points: shape.points.map((point, index) => (index === pointIndex ? { ...point, ...joinedPoint } : point)),
  };
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

function flattenPointForFrontView(point: SizePoint, progress = 1): SizePoint {
  return {
    ...point,
    yM: lerp(point.yM, 0, progress),
    tangentIn: point.tangentIn ? { ...point.tangentIn, yM: lerp(point.tangentIn.yM, 0, progress) } : undefined,
    tangentOut: point.tangentOut ? { ...point.tangentOut, yM: lerp(point.tangentOut.yM, 0, progress) } : undefined,
  };
}

function flattenShapeForFrontView(shape: SizeShape, progress = 1): SizeShape {
  return {
    ...shape,
    points: shape.points.map((point) => flattenPointForFrontView(point, progress)),
  };
}

function projectedShape(shape: SizeShape, progress: number, shapes: SizeShape[], viewMode: CanvasViewMode): SizeShape {
  if (viewMode === "side") return sideProjectionShape(shape, progress, shapes);
  return frontProjectionShape(shape, progress, shapes);
}

function frontProjectionShape(shape: SizeShape, progress: number, shapes: SizeShape[]): SizeShape {
  if (shape.role === "body") return { ...shape, points: circularFrontSection(shape, progress, undefined, frontSectionCenterX(shape, shapes)) };
  if (shape.role === "liftingSurface") return { ...shape, points: liftingSurfaceFrontSection(shape, progress, shapes) };
  if (shape.role === "part") {
    if (shape.partType === "battery") return { ...shape, points: squareFrontSection(shape, progress) };
    if (shape.partType === "motor" || shape.partType === "rotor") return { ...shape, points: circularFrontSection(shape, progress, rotorOrPartRadius(shape, shapes), frontSectionCenterX(shape, shapes)) };
  }
  return flattenShapeForFrontView(shape, progress);
}

function sideProjectionShape(shape: SizeShape, progress: number, shapes: SizeShape[]): SizeShape {
  const frame = sideProjectionFrame(shapes);
  if (progress < sideCollapseProgress) return collapseShapeToSideAxis(shape, progress / sideCollapseProgress, frame);

  const sectionProgress = (progress - sideCollapseProgress) / (1 - sideCollapseProgress);
  if (shape.role === "body") return { ...shape, points: bodySideSection(shape, sectionProgress, shapes, frame) };
  if (shape.role === "liftingSurface") return { ...shape, points: liftingSurfaceSideSection(shape, sectionProgress, frame) };
  if (shape.role === "part") {
    if (shape.partType === "rotor") return { ...shape, points: rotorSideSection(shape, sectionProgress, shapes, frame) };
    if (shape.partType === "motor") return { ...shape, points: motorSideSection(shape, sectionProgress, frame) };
    return { ...shape, points: rectangularSideSection(shape, sectionProgress, sidePartHalfHeight(shape), undefined, frame) };
  }
  return flattenShapeForSideView(shape, sectionProgress, frame);
}

function sideProjectionFrame(shapes: SizeShape[]): SideProjectionFrame {
  const aircraftPoints = shapes
    .filter((shape) => !referenceRoles.includes(shape.role))
    .flatMap((shape) => shape.points);
  const ys = aircraftPoints.length ? aircraftPoints.map((point) => point.yM) : shapes.flatMap((shape) => shape.points.map((point) => point.yM));
  const minY = Math.min(0, ...ys);
  const maxY = Math.max(0, ...ys);
  return {
    baselineY: 0,
    longitudinalSign: Math.abs(minY) > Math.abs(maxY) ? 1 : -1,
  };
}

function flattenPointForSideView(point: SizePoint, progress = 1, frame: SideProjectionFrame): SizePoint {
  return {
    ...point,
    xM: lerp(point.xM, 0, progress),
    yM: (point.yM - frame.baselineY) * frame.longitudinalSign,
    tangentIn: undefined,
    tangentOut: undefined,
  };
}

function flattenShapeForSideView(shape: SizeShape, progress = 1, frame: SideProjectionFrame): SizeShape {
  return {
    ...shape,
    points: shape.points.map((point) => flattenPointForSideView(point, progress, frame)),
  };
}

function collapseShapeToSideAxis(shape: SizeShape, progress: number, frame: SideProjectionFrame): SizeShape {
  const t = clamp(progress, 0, 1);
  return {
    ...shape,
    points: shape.points.map((point) => ({
      ...point,
      xM: lerp(point.xM, 0, t),
      yM: lerp(point.yM, (point.yM - frame.baselineY) * frame.longitudinalSign, t),
      tangentIn: undefined,
      tangentOut: undefined,
    })),
  };
}

function bodySideSection(shape: SizeShape, progress: number, shapes: SizeShape[], frame: SideProjectionFrame) {
  const pointSets = frontPointSetsForShape(shape, shapes);
  const bounds = pointSetBounds(pointSets);
  const lengthM = Math.max(bounds.maxY - bounds.minY, 0.01);
  const right: SizePoint[] = [];
  const left: SizePoint[] = [];
  for (let index = 0; index <= 24; index += 1) {
    const stationT = index / 24;
    const sourceY = bounds.minY + lengthM * stationT;
    const halfHeightM = Math.max(widthAtYForSets(pointSets, sourceY) / 2, 0.006);
    right.push(sideProjectedPoint(sourceY, halfHeightM, progress, frame));
    left.unshift(sideProjectedPoint(sourceY, -halfHeightM, progress, frame));
  }
  return [...right, ...left, right[0]];
}

function liftingSurfaceSideSection(shape: SizeShape, progress: number, frame: SideProjectionFrame) {
  const bounds = shapeBounds(shape);
  const leadingY = Math.abs(bounds.minY) <= Math.abs(bounds.maxY) ? bounds.minY : bounds.maxY;
  const trailingY = leadingY === bounds.minY ? bounds.maxY : bounds.minY;
  const chordM = trailingY - leadingY;
  const thicknessRatio = airfoilThicknessRatioAtStation(shape, 0);
  return airfoilSideSection(leadingY, chordM, thicknessRatio, progress, frame);
}

function motorSideSection(shape: SizeShape, progress: number, frame: SideProjectionFrame) {
  return rectangularSideSection(shape, progress, Math.max(frontSectionRadius(shape) * 2, 0.01), inferredMotorDepthM(shape), frame);
}

function rotorSideSection(shape: SizeShape, progress: number, shapes: SizeShape[], frame: SideProjectionFrame) {
  const center = nearestMotorCenterY(shape, shapes) ?? topDownShapeCenter(shape).yM;
  const diameterM = Math.max(rotorDiameterEstimate(shape, shapes), 0.01);
  const halfDepthM = 0.006;
  return [
    sideProjectedPoint(center - halfDepthM, -diameterM / 2, progress, frame),
    sideProjectedPoint(center + halfDepthM, -diameterM / 2, progress, frame),
    sideProjectedPoint(center + halfDepthM, diameterM / 2, progress, frame),
    sideProjectedPoint(center - halfDepthM, diameterM / 2, progress, frame),
    sideProjectedPoint(center - halfDepthM, -diameterM / 2, progress, frame),
  ];
}

function rectangularSideSection(shape: SizeShape, progress: number, heightM: number, overrideLengthM?: number, frame: SideProjectionFrame = { baselineY: 0, longitudinalSign: 1 }) {
  const bounds = shapeBounds(shape);
  const centerY = (bounds.minY + bounds.maxY) / 2;
  const halfLengthM = Math.max((overrideLengthM ?? Math.max(bounds.maxY - bounds.minY, 0.02)) / 2, 0.005);
  const halfHeight = Math.max(heightM, 0.006) / 2;
  return [
    sideProjectedPoint(centerY - halfLengthM, -halfHeight, progress, frame),
    sideProjectedPoint(centerY + halfLengthM, -halfHeight, progress, frame),
    sideProjectedPoint(centerY + halfLengthM, halfHeight, progress, frame),
    sideProjectedPoint(centerY - halfLengthM, halfHeight, progress, frame),
    sideProjectedPoint(centerY - halfLengthM, -halfHeight, progress, frame),
  ];
}

function sidePartHalfHeight(shape: SizeShape) {
  if (shape.partType === "battery") {
    const bounds = shapeBounds(shape);
    return Math.max(bounds.maxX * 2, bounds.maxY - bounds.minY, 0.01);
  }
  if (shape.partType === "electronics") return Math.max(inferredBatteryThicknessM(shape) * 0.67, 0.008);
  return Math.max(frontSectionRadius(shape) * 2, 0.01);
}

function sideProjectedPoint(lengthM: number, heightM: number, progress: number, frame: SideProjectionFrame): SizePoint {
  return {
    xM: heightM * progress,
    yM: (lengthM - frame.baselineY) * frame.longitudinalSign,
    curveMode: "corner",
    segmentInMode: "corner",
    segmentOutMode: "corner",
  };
}

function airfoilSideSection(leadingY: number, chordM: number, thicknessRatio: number, progress: number, frame: SideProjectionFrame) {
  const upper: SizePoint[] = [];
  const lower: SizePoint[] = [];
  const safeChordM = Math.max(Math.abs(chordM), 0.01);
  const direction = chordM < 0 ? -1 : 1;
  const safeThicknessRatio = Math.max(thicknessRatio, 0.04);
  for (let index = 0; index <= 28; index += 1) {
    const x = index / 28;
    const yM = leadingY + safeChordM * x * direction;
    const halfThicknessM = nacaSymmetricHalfThickness(x, safeThicknessRatio, safeChordM);
    upper.push(sideProjectedPoint(yM, halfThicknessM, progress, frame));
    lower.unshift(sideProjectedPoint(yM, -halfThicknessM, progress, frame));
  }
  return [...upper, ...lower, upper[0]];
}

function nacaSymmetricHalfThickness(stationT: number, thicknessRatio: number, chordM: number) {
  const x = clamp(stationT, 0, 1);
  const normalizedHalfThickness =
    5 *
    thicknessRatio *
    (0.2969 * Math.sqrt(x) - 0.126 * x - 0.3516 * x * x + 0.2843 * x ** 3 - 0.1015 * x ** 4);
  return Math.max(normalizedHalfThickness * chordM, 0);
}

function circularFrontSection(shape: SizeShape, progress: number, overrideRadiusM?: number, overrideCenterX?: number) {
  const centerX = overrideCenterX ?? frontSectionCenterX(shape);
  const radiusM = Math.max(overrideRadiusM ?? frontSectionRadius(shape), 0.01);
  const isCenterlineSection = Math.abs(centerX) <= mirrorAxisTouchToleranceM;
  const points: SizePoint[] = [];
  const samples = isCenterlineSection ? 18 : 36;
  const startTheta = isCenterlineSection ? Math.PI / 2 : Math.PI;
  const endTheta = isCenterlineSection ? -Math.PI / 2 : -Math.PI;
  for (let index = 0; index <= samples; index += 1) {
    const theta = startTheta + ((endTheta - startTheta) * index) / samples;
    points.push({
      xM: Math.max(0, centerX + Math.cos(theta) * radiusM),
      yM: Math.sin(theta) * radiusM * progress,
      curveMode: "corner",
      segmentInMode: "corner",
      segmentOutMode: "corner",
    });
  }
  return points;
}

function squareFrontSection(shape: SizeShape, progress: number) {
  const centerX = frontSectionCenterX(shape);
  const halfSideM = Math.max(frontSectionRadius(shape), inferredBatteryThicknessM(shape) / 2, 0.01);
  const minX = Math.max(0, centerX - halfSideM);
  const maxX = centerX + halfSideM;
  return [
    { xM: minX, yM: halfSideM * progress, curveMode: "corner" as const },
    { xM: maxX, yM: halfSideM * progress, curveMode: "corner" as const },
    { xM: maxX, yM: -halfSideM * progress, curveMode: "corner" as const },
    { xM: minX, yM: -halfSideM * progress, curveMode: "corner" as const },
    { xM: minX, yM: halfSideM * progress, curveMode: "corner" as const },
  ];
}

function liftingSurfaceFrontSection(shape: SizeShape, progress: number, shapes: SizeShape[] = []) {
  const pointSets = frontPointSetsForShape(shape, shapes);
  const bounds = pointSetBounds(pointSets);
  const rawRootX = shapeTouchesMirrorAxis(shape) ? 0 : bounds.minX;
  const rawTipX = Math.max(bounds.maxX, rawRootX + 0.01);
  const spanM = Math.max(rawTipX - rawRootX, 0.01);
  const sampleInsetM = spanM * 0.015;
  const rootHalfHeightM = liftingSurfaceHalfHeightAtSpanEnd(shape, pointSets, rawRootX, sampleInsetM, "root");
  const tipHalfHeightM = liftingSurfaceHalfHeightAtSpanEnd(shape, pointSets, rawTipX, sampleInsetM, "tip");
  const top: SizePoint[] = [];
  const bottom: SizePoint[] = [];
  for (let index = 0; index <= 18; index += 1) {
    const stationT = index / 18;
    const xM = rawRootX + spanM * stationT;
    const halfHeightM = lerp(rootHalfHeightM, tipHalfHeightM, stationT);
    top.push({ xM, yM: halfHeightM * progress, curveMode: "corner", segmentInMode: "corner", segmentOutMode: "corner" });
    bottom.unshift({ xM, yM: -halfHeightM * progress, curveMode: "corner", segmentInMode: "corner", segmentOutMode: "corner" });
  }
  return [...top, ...bottom, top[0]];
}

function liftingSurfaceHalfHeightAtSpanEnd(
  shape: SizeShape,
  pointSets: SizePoint[][],
  xM: number,
  sampleInsetM: number,
  end: "root" | "tip",
) {
  const bounds = pointSetBounds(pointSets);
  const sampleX = end === "root" ? Math.min(xM + sampleInsetM, bounds.maxX) : Math.max(xM - sampleInsetM, bounds.minX);
  const chordM = Math.max(chordLengthAtXForSets(pointSets, xM) || chordLengthAtXForSets(pointSets, sampleX), 0.01);
  const thicknessRatio = airfoilThicknessRatioAtStation(shape, end === "root" ? 0 : 1);
  return Math.max(chordM * thicknessRatio, 0.006) / 2;
}

function frontPointSetsForShape(shape: SizeShape, shapes: SizeShape[]) {
  const localMirrorPlanes = shouldUseLocalMirror(shape)
    ? shapes.filter((plane) => plane.role === "mirrorPlane" && plane.id !== shape.id && shapeTouchesMirrorPlane(shape, plane))
    : [];
  return [shape.points, ...localMirrorPlanes.map((plane) => mirrorPointsAcrossPlane(shape.points, plane))];
}

function rotorOrPartRadius(shape: SizeShape, shapes: SizeShape[]) {
  if (shape.partType === "rotor") return Math.max(rotorDiameterEstimate(shape, shapes) / 2, 0.01);
  return Math.max(frontSectionRadius(shape, shapes), frontSectionDepth(shape) / 2, 0.01);
}

function frontSectionCenterX(shape: SizeShape, shapes: SizeShape[] = []) {
  const referenceCenter = referenceCenterXForShape(shape, shapes);
  if (referenceCenter !== undefined) return referenceCenter;
  if (shape.partType === "rotor") return nearestMotorCenterX(shape, shapes) ?? rotorHubCenterX(shape);
  const bounds = shapeBounds(shape);
  return shapeTouchesMirrorAxis(shape) ? 0 : (bounds.minX + bounds.maxX) / 2;
}

function nearestMotorCenterX(shape: SizeShape, shapes: SizeShape[]) {
  const rotorCenter = topDownShapeCenter(shape);
  let nearest: { centerX: number; distance: number } | undefined;
  for (const candidate of shapes) {
    if (candidate.role !== "part" || candidate.partType !== "motor") continue;
    const motorCenter = topDownShapeCenter(candidate);
    const distance = distanceBetweenPoints(rotorCenter, motorCenter);
    if (!nearest || distance < nearest.distance) nearest = { centerX: frontSectionCenterX(candidate), distance };
  }
  return nearest?.centerX;
}

function nearestMotorCenterY(shape: SizeShape, shapes: SizeShape[]) {
  const rotorCenter = topDownShapeCenter(shape);
  let nearest: { centerY: number; distance: number } | undefined;
  for (const candidate of shapes) {
    if (candidate.role !== "part" || candidate.partType !== "motor") continue;
    const motorCenter = topDownShapeCenter(candidate);
    const distance = distanceBetweenPoints(rotorCenter, motorCenter);
    if (!nearest || distance < nearest.distance) nearest = { centerY: motorCenter.yM, distance };
  }
  return nearest?.centerY;
}

function topDownShapeCenter(shape: SizeShape): SizePoint {
  const bounds = shapeBounds(shape);
  return {
    xM: shapeTouchesMirrorAxis(shape) ? 0 : (bounds.minX + bounds.maxX) / 2,
    yM: (bounds.minY + bounds.maxY) / 2,
  };
}

function rotorHubCenterX(shape: SizeShape) {
  const bounds = shapeBounds(shape);
  if (shapeTouchesMirrorAxis(shape)) return 0;
  const sorted = shape.points.map((point) => Math.abs(point.xM)).sort((a, b) => a - b);
  return sorted[0] ?? (bounds.minX + bounds.maxX) / 2;
}

function referenceCenterXForShape(shape: SizeShape, shapes: SizeShape[]) {
  const references = shapes.filter((candidate) => referenceRoles.includes(candidate.role) && candidate.points.length >= 2);
  if (!references.length) return undefined;

  for (const point of shape.points) {
    const attachment = point.snapAttachment;
    if (!attachment) continue;
    const reference = references.find((candidate) => candidate.id === attachment.shapeId);
    const referenceX = reference ? verticalReferenceX(reference) : undefined;
    if (referenceX !== undefined) return referenceX;
  }

  const bounds = shapeBounds(shape);
  const center = topDownShapeCenter(shape);
  const crossingReferences = references
    .map((reference) => ({ reference, xM: verticalReferenceX(reference) }))
    .filter((entry): entry is { reference: SizeShape; xM: number } => entry.xM !== undefined)
    .filter(({ reference, xM }) => xM >= bounds.minX - 0.02 && xM <= bounds.maxX + 0.02 && referenceOverlapsShapeY(reference, bounds))
    .sort((a, b) => Math.abs(a.xM - center.xM) - Math.abs(b.xM - center.xM));

  if (crossingReferences[0]) return crossingReferences[0].xM;

  const nearestReferences = references
    .map((reference) => ({ xM: verticalReferenceX(reference) }))
    .filter((entry): entry is { xM: number } => entry.xM !== undefined)
    .map((entry) => ({ ...entry, distance: Math.abs(entry.xM - center.xM) }))
    .filter((entry) => entry.distance <= 0.25)
    .sort((a, b) => a.distance - b.distance);

  return nearestReferences[0]?.xM;
}

function verticalReferenceX(shape: SizeShape) {
  const [start, end] = shape.points;
  if (!start || !end) return undefined;
  if (Math.abs(start.xM - end.xM) > Math.abs(start.yM - end.yM)) return undefined;
  return (start.xM + end.xM) / 2;
}

function referenceOverlapsShapeY(reference: SizeShape, bounds: ReturnType<typeof shapeBounds>) {
  const [start, end] = reference.points;
  if (!start || !end) return false;
  const minY = Math.min(start.yM, end.yM);
  const maxY = Math.max(start.yM, end.yM);
  return maxY >= bounds.minY - 0.02 && minY <= bounds.maxY + 0.02;
}

function frontSectionHalfWidth(shape: SizeShape) {
  const bounds = shapeBounds(shape);
  return shapeTouchesMirrorAxis(shape) ? bounds.maxX : Math.max((bounds.maxX - bounds.minX) / 2, 0);
}

function frontSectionRadius(shape: SizeShape, shapes: SizeShape[] = []) {
  return mirroredDiameterForPointSets(frontPointSetsForShape(shape, shapes)) / 2;
}

function frontSectionDepth(shape: SizeShape) {
  const bounds = shapeBounds(shape);
  return Math.max(bounds.maxY - bounds.minY, 0);
}

function shapeTouchesMirrorAxis(shape: SizeShape) {
  return shape.points.some((point) => Math.abs(point.xM) <= mirrorAxisTouchToleranceM);
}

function chordLengthAtX(points: SizePoint[], xM: number) {
  const intersections: number[] = [];
  const epsilon = 1e-6;
  for (let index = 0; index < points.length; index += 1) {
    const a = points[index];
    const b = points[(index + 1) % points.length];
    const minX = Math.min(a.xM, b.xM);
    const maxX = Math.max(a.xM, b.xM);
    if (xM < minX - epsilon || xM > maxX + epsilon) continue;
    if (Math.abs(a.xM - b.xM) < epsilon) {
      if (Math.abs(xM - a.xM) < epsilon) {
        intersections.push(a.yM, b.yM);
      }
      continue;
    }
    const t = (xM - a.xM) / (b.xM - a.xM);
    intersections.push(a.yM + (b.yM - a.yM) * t);
  }
  if (intersections.length < 2) return 0;
  return Math.max(...intersections) - Math.min(...intersections);
}

function chordLengthAtXForSets(pointSets: SizePoint[][], xM: number) {
  return Math.max(...pointSets.map((points) => chordLengthAtX(points, xM)), 0);
}

function widthAtYForSets(pointSets: SizePoint[][], yM: number) {
  return Math.max(...pointSets.map((points) => widthAtY(points, yM)), 0);
}

function widthAtY(points: SizePoint[], yM: number) {
  const intersections: number[] = [];
  const epsilon = 1e-6;
  for (let index = 0; index < points.length; index += 1) {
    const a = points[index];
    const b = points[(index + 1) % points.length];
    const minY = Math.min(a.yM, b.yM);
    const maxY = Math.max(a.yM, b.yM);
    if (yM < minY - epsilon || yM > maxY + epsilon) continue;
    if (Math.abs(a.yM - b.yM) < epsilon) {
      if (Math.abs(yM - a.yM) < epsilon) {
        intersections.push(Math.abs(a.xM), Math.abs(b.xM));
      }
      continue;
    }
    const t = (yM - a.yM) / (b.yM - a.yM);
    intersections.push(Math.abs(a.xM + (b.xM - a.xM) * t));
  }
  if (intersections.length < 2) return 0;
  return Math.max(...intersections) * 2;
}

function maxChordLengthForSets(pointSets: SizePoint[][]) {
  const bounds = pointSetBounds(pointSets);
  const spanM = Math.max(bounds.maxX - bounds.minX, 0.01);
  let chordM = 0;
  for (let index = 0; index <= 20; index += 1) {
    const xM = bounds.minX + (spanM * index) / 20;
    chordM = Math.max(chordM, chordLengthAtXForSets(pointSets, xM));
  }
  return chordM || Math.max(bounds.maxY - bounds.minY, 0);
}

function mirroredDiameterForPointSets(pointSets: SizePoint[][]) {
  const bounds = pointSetBounds(pointSets);
  if (bounds.minX <= mirrorAxisTouchToleranceM) return Math.max(bounds.maxX * 2, 0);
  return Math.max(bounds.maxX - bounds.minX, 0);
}

function pointSetBounds(pointSets: SizePoint[][]) {
  const points = pointSets.flat();
  if (!points.length) return { minX: 0, maxX: 0, minY: 0, maxY: 0 };
  const xs = points.map((point) => Math.abs(point.xM));
  const ys = points.map((point) => point.yM);
  return {
    minX: Math.min(...xs),
    maxX: Math.max(...xs),
    minY: Math.min(...ys),
    maxY: Math.max(...ys),
  };
}

function airfoilThicknessRatioAtStation(shape: SizeShape, stationT: number) {
  const root = airfoilThicknessRatio(shape.airfoilStations?.root10 ?? shape.airfoil ?? "NACA 0012");
  const tip = airfoilThicknessRatio(shape.airfoilStations?.tip90 ?? shape.airfoil ?? "NACA 0012");
  return lerp(root, tip, clamp(stationT, 0, 1));
}

function airfoilThicknessRatio(name: string) {
  const match = name.match(/(\d{4})/);
  if (match) return Math.max(Number(match[1].slice(2)) / 100, 0.04);
  const normalized = name.toLowerCase().replace(/\s+/g, "");
  if (normalized.includes("clarky")) return 0.117;
  if (normalized.includes("mh32")) return 0.087;
  if (normalized.includes("s1223")) return 0.121;
  return 0.12;
}

function incidenceAtStation(shape: SizeShape, stationT: number) {
  const root = shape.incidenceStationsDeg?.root10 ?? shape.incidenceDeg ?? 0;
  const tip = shape.incidenceStationsDeg?.tip90 ?? shape.incidenceDeg ?? 0;
  return lerp(root, tip, clamp(stationT, 0, 1));
}

function lerp(from: number, to: number, progress: number) {
  return from + (to - from) * progress;
}

function shouldUseLocalMirror(shape: SizeShape) {
  return shape.role !== "referenceLine" && shape.role !== "mirrorPlane";
}

function shapeTouchesMirrorPlane(shape: SizeShape, plane: SizeShape) {
  const [start, end] = plane.points;
  if (!start || !end) return false;
  const thresholdM = 0.015;
  return shape.points.some((point) => distancePointToLine(point, start, end) <= thresholdM);
}

function mirrorPointsAcrossPlane(points: SizePoint[], plane: SizeShape) {
  const [start, end] = plane.points;
  if (!start || !end) return points;
  return points.map((point) => mirrorPointAcrossLine(point, start, end));
}

function mirrorPointAcrossLine(point: SizePoint, start: SizePoint, end: SizePoint): SizePoint {
  const dx = end.xM - start.xM;
  const dy = end.yM - start.yM;
  const lengthSquared = dx * dx + dy * dy;
  if (lengthSquared <= 1e-9) return point;
  const t = ((point.xM - start.xM) * dx + (point.yM - start.yM) * dy) / lengthSquared;
  const projection = {
    xM: start.xM + dx * t,
    yM: start.yM + dy * t,
  };
  return {
    ...point,
    xM: projection.xM * 2 - point.xM,
    yM: projection.yM * 2 - point.yM,
  };
}

function distancePointToLine(point: SizePoint, start: SizePoint, end: SizePoint) {
  const dx = end.xM - start.xM;
  const dy = end.yM - start.yM;
  const length = Math.hypot(dx, dy);
  if (length <= 1e-9) return distanceBetweenPoints(point, start);
  return Math.abs(dy * point.xM - dx * point.yM + end.xM * start.yM - end.yM * start.xM) / length;
}

function closeIfNearCenterline(points: SizePoint[]) {
  return points.map((point): SizePoint => ({ ...point, xM: Math.max(0, point.xM) }));
}

function moveAttachedOrFreePoint(current: SizePoint, target: SizePoint, shapes: SizeShape[]): SizePoint {
  if (current.snapAttachment?.kind === "segment") {
    const sourceShape = shapes.find((shape) => shape.id === current.snapAttachment?.shapeId);
    if (sourceShape?.points[current.snapAttachment.segmentIndex] && sourceShape.points[current.snapAttachment.segmentIndex + 1]) {
      const projection = projectPointToShapeSegment(target, sourceShape.points, current.snapAttachment.segmentIndex);
      return {
        ...current,
        ...projection.point,
        xM: Math.abs(projection.point.xM),
        snapAttachment: { ...current.snapAttachment, t: projection.t },
      };
    }
  }
  return { ...current, xM: Math.abs(target.xM), yM: target.yM, snapAttachment: undefined };
}

function moveShapePointWithConstraints(shape: SizeShape, index: number, current: SizePoint, target: SizePoint, shapes: SizeShape[]) {
  const moved = moveAttachedOrFreePoint(current, target, shapes);
  if (!referenceRoles.includes(shape.role) || shape.points.length < 2) return moved;
  const anchor = shape.points[index === 0 ? 1 : 0];
  return referenceEndpointPoint(shape.points, anchor, moved);
}

function nearestSegmentTarget(shape: SizeShape, point: SizePoint): SizeDimensionTarget {
  let best = { segmentIndex: 0, t: 0, distanceM: Number.POSITIVE_INFINITY };
  for (let segmentIndex = 0; segmentIndex < shape.points.length - 1; segmentIndex += 1) {
    const projection = projectPointToShapeSegment(point, shape.points, segmentIndex);
    const distanceM = distanceBetweenPoints(point, projection.point);
    if (distanceM < best.distanceM) {
      best = { segmentIndex, t: projection.t, distanceM };
    }
  }
  return { kind: "segment", shapeId: shape.id, segmentIndex: best.segmentIndex, t: best.t };
}

function sameDimensionTarget(a: SizeDimensionTarget, b: SizeDimensionTarget) {
  if (a.kind !== b.kind || a.shapeId !== b.shapeId) return false;
  if (a.kind === "node" && b.kind === "node") return a.pointIndex === b.pointIndex;
  if (a.kind === "segment" && b.kind === "segment") return a.segmentIndex === b.segmentIndex && Math.abs(a.t - b.t) < 0.001;
  return false;
}

function measureDimension(targetA: SizeDimensionTarget, targetB: SizeDimensionTarget, shapes: SizeShape[]) {
  const a = dimensionTargetPoint(targetA, shapes);
  const b = dimensionTargetPoint(targetB, shapes);
  return a && b ? distanceBetweenPoints(a, b) : undefined;
}

function dimensionTargetPoint(target: SizeDimensionTarget, shapes: SizeShape[]): SizePoint | undefined {
  const shape = shapes.find((candidate) => candidate.id === target.shapeId);
  if (!shape) return undefined;
  if (target.kind === "node") return shape.points[target.pointIndex];
  return pointAtShapeSegmentT(shape.points, target.segmentIndex, target.t);
}

function enforceDimensions(shapes: SizeShape[], dimensions: SizeDimension[]) {
  let next = cloneSizeShapes(shapes);
  for (const dimension of dimensions) {
    next = enforceDimension(next, dimension);
  }
  return resolveAttachedShapes(next);
}

function enforceDimension(shapes: SizeShape[], dimension: SizeDimension): SizeShape[] {
  const a = dimensionTargetPoint(dimension.targetA, shapes);
  const b = dimensionTargetPoint(dimension.targetB, shapes);
  if (!a || !b) return shapes;

  const movableB = movableNodeTarget(dimension.targetB, shapes);
  const movableA = movableNodeTarget(dimension.targetA, shapes);
  if (dimension.targetA.kind === "segment" && movableB) {
    return moveNodeToDimension(shapes, movableB, b, a, dimension.valueM, dimension.targetA);
  }
  if (dimension.targetB.kind === "segment" && movableA) {
    return moveNodeToDimension(shapes, movableA, a, b, dimension.valueM, dimension.targetB);
  }
  if (movableB) return moveNodeToDimension(shapes, movableB, b, a, dimension.valueM);
  if (movableA) return moveNodeToDimension(shapes, movableA, a, b, dimension.valueM);
  return shapes;
}

function movableNodeTarget(target: SizeDimensionTarget, shapes: SizeShape[]): SizeDimensionTarget | undefined {
  if (target.kind !== "node") return undefined;
  const shape = shapes.find((candidate) => candidate.id === target.shapeId);
  const point = shape?.points[target.pointIndex];
  return point && !point.snapAttachment ? target : undefined;
}

function moveNodeToDimension(
  shapes: SizeShape[],
  target: SizeDimensionTarget,
  current: SizePoint,
  anchor: SizePoint,
  valueM: number,
  segmentTarget?: SizeDimensionTarget,
) {
  if (target.kind !== "node") return shapes;
  const direction = dimensionDirection(current, anchor, shapes, segmentTarget);
  const moved = {
    ...current,
    xM: Math.abs(anchor.xM + direction.xM * valueM),
    yM: anchor.yM + direction.yM * valueM,
  };
  return shapes.map((shape) =>
    shape.id === target.shapeId
      ? {
          ...shape,
          points: shape.points.map((point, pointIndex) => (pointIndex === target.pointIndex ? moved : point)),
        }
      : shape,
  );
}

function dimensionDirection(current: SizePoint, anchor: SizePoint, shapes: SizeShape[], segmentTarget?: SizeDimensionTarget): SizePoint {
  const dx = current.xM - anchor.xM;
  const dy = current.yM - anchor.yM;
  const length = Math.hypot(dx, dy);
  if (length > 1e-6) return { xM: dx / length, yM: dy / length };
  if (segmentTarget?.kind === "segment") {
    const shape = shapes.find((candidate) => candidate.id === segmentTarget.shapeId);
    const start = shape?.points[segmentTarget.segmentIndex];
    const end = shape?.points[segmentTarget.segmentIndex + 1];
    if (start && end) {
      const sx = end.xM - start.xM;
      const sy = end.yM - start.yM;
      const segmentLength = Math.hypot(sx, sy);
      if (segmentLength > 1e-6) return { xM: -sy / segmentLength, yM: sx / segmentLength };
    }
  }
  return { xM: 1, yM: 0 };
}

function trimDimensionValue(value: number) {
  return Number(value.toFixed(4)).toString();
}

function referenceEndpointPoint(points: SizePoint[], anchor: SizePoint, target: SizePoint): SizePoint {
  const [start, end] = points;
  if (!start || !end) return { ...target, xM: Math.abs(target.xM) };
  const vertical = Math.abs(end.yM - start.yM) >= Math.abs(end.xM - start.xM);
  return vertical
    ? { ...target, xM: Math.abs(anchor.xM), yM: target.yM, snapAttachment: undefined }
    : { ...target, xM: Math.abs(target.xM), yM: anchor.yM, snapAttachment: undefined };
}

function translateReferenceLinePoints(points: SizePoint[], startPoint: SizePoint, targetPoint: SizePoint): SizePoint[] {
  const [start, end] = points;
  if (!start || !end) return points;
  const vertical = Math.abs(end.yM - start.yM) >= Math.abs(end.xM - start.xM);
  const deltaX = targetPoint.xM - startPoint.xM;
  const deltaY = targetPoint.yM - startPoint.yM;
  return points.map((point) =>
    vertical
      ? { ...point, xM: Math.abs(point.xM + deltaX), snapAttachment: undefined }
      : { ...point, yM: point.yM + deltaY, snapAttachment: undefined },
  );
}

function translateShapePointsForDrag(points: SizePoint[], startPoint: SizePoint, targetPoint: SizePoint): SizePoint[] {
  const deltaX = targetPoint.xM - startPoint.xM;
  const deltaY = targetPoint.yM - startPoint.yM;
  return points.map((point) =>
    point.snapAttachment
      ? point
      : {
          ...point,
          xM: Math.abs(point.xM + deltaX),
          yM: point.yM + deltaY,
        },
  );
}

function cloneSizePoints(points: SizePoint[]): SizePoint[] {
  return points.map((point) => ({
    ...point,
    tangentIn: point.tangentIn ? { ...point.tangentIn } : undefined,
    tangentOut: point.tangentOut ? { ...point.tangentOut } : undefined,
    snapAttachment: point.snapAttachment ? { ...point.snapAttachment } : undefined,
  }));
}

function cloneSizeShapes(shapes: SizeShape[]): SizeShape[] {
  return shapes.map((shape) => ({
    ...shape,
    points: cloneSizePoints(shape.points),
  }));
}

function insertPointOnNearestSegment(points: SizePoint[], target: SizePoint) {
  if (points.length < 2) {
    const nextPoint = { ...target, xM: Math.abs(target.xM), curveMode: "spline" as const };
    return { index: points.length, points: [...points, nextPoint] };
  }
  let best = { index: 0, distance: Number.POSITIVE_INFINITY, point: points[0], t: 0 };
  for (let index = 0; index < points.length - 1; index += 1) {
    const projection = projectPointToShapeSegment(target, points, index);
    const distance = distanceBetweenPoints(target, projection.point);
    if (distance < best.distance) {
      best = { index, distance, point: projection.point, t: projection.t };
    }
  }
  const previous = points[best.index];
  const next = points[best.index + 1];
  const segmentMode = previous.segmentOutMode ?? next.segmentInMode ?? "corner";
  const inserted: SizePoint = {
    ...best.point,
    xM: Math.abs(best.point.xM),
    curveMode: "spline",
    segmentInMode: segmentMode,
    segmentOutMode: segmentMode,
  };
  return {
    index: best.index + 1,
    points: [
      ...points.slice(0, best.index + 1),
      inserted,
      ...points.slice(best.index + 1),
    ],
  };
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

function cloneSizingProject(project: SizingProject): SizingProject {
  return JSON.parse(JSON.stringify(project)) as SizingProject;
}

function resolveAttachedShapes(shapes: SizeShape[]) {
  return shapes.map((shape) => ({
    ...shape,
    points:
      shape.partType === "rotor"
        ? rotorSpanPoints(shape.points.map((point) => resolveAttachedPoint(point, shapes)))
        : shape.points.map((point) => resolveAttachedPoint(point, shapes)),
  }));
}

function resolveAttachedPoint(point: SizePoint, shapes: SizeShape[]): SizePoint {
  const attachment = point.snapAttachment;
  if (!attachment) return point;
  const sourceShape = shapes.find((shape) => shape.id === attachment.shapeId);
  if (!sourceShape) return { ...point, snapAttachment: undefined };

  if (attachment.kind === "node") {
    const sourcePoint = sourceShape.points[attachment.pointIndex];
    if (!sourcePoint) return { ...point, snapAttachment: undefined };
    return { ...point, xM: Math.abs(sourcePoint.xM), yM: sourcePoint.yM };
  }

  const start = sourceShape.points[attachment.segmentIndex];
  const end = sourceShape.points[attachment.segmentIndex + 1];
  if (!start || !end) return { ...point, snapAttachment: undefined };
  const resolved = pointAtShapeSegmentT(sourceShape.points, attachment.segmentIndex, attachment.t);
  return {
    ...point,
    xM: Math.abs(resolved.xM),
    yM: resolved.yM,
  };
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
