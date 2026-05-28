import { Eye, EyeOff } from "lucide-react";
import { useEffect, useMemo, useRef, useState } from "react";
import type { MouseEvent, PointerEvent, WheelEvent } from "react";
import type {
  PartType,
  SizeDimension,
  SizeDimensionTarget,
  SizePoint,
  SizeShape,
  SizeShapeRole,
  SizingAnalysis,
} from "../../sizing";
import type {
  AirfoilStation,
  CanvasView,
  CanvasViewMode,
  DimensionDraft,
  JoinPointSelection,
  PendingDimension,
  ScaleUnit,
} from "../types";
import { baseCanvasView, drawablePartTypes, referenceRoles } from "../constants";
import { partTypeLabels } from "../../sizing";
import {
  axisAlignedPoint,
  cloneSizePoints,
  fitCanvasView,
  flattenPointForFrontView,
  fromCanvas,
  isPointVisible,
  lerp,
  partShapePointsFromDraft,
  projectedShape,
  snapPoint,
  svgPointFromClient,
  svgPointFromEvent,
  translateReferenceLinePoints,
  translateShapePointsForDrag,
} from "../geometry";
import { SizingGrid } from "./SizingGrid";
import {
  AnalysisMarkers,
  CanvasCursorPoint,
  DimensionLayer,
  DraftShape,
  ReferenceShape,
  SketchShape,
} from "./shapeViews";
export function SketchCanvas({
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
  showSizingReference,
  sizingReferenceShapes,
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
  onToggleSizingReference,
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
  showSizingReference: boolean;
  sizingReferenceShapes: SizeShape[];
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
  onToggleSizingReference: () => void;
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
  const visibleReferenceShapes = showSizingReference ? sizingReferenceShapes : [];
  const displayReferenceShapes =
    projectionProgress > 0
      ? visibleReferenceShapes.map((shape) => projectedShape(shape, projectionProgress, shapes, viewMode))
      : visibleReferenceShapes;
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
  const selectedMotorId = shapes.find((shape) => shape.id === selectedShapeId && shape.role === "part" && shape.partType === "motor")?.id ?? "";
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
        aria-label={viewMode === "top" ? "Top down half aircraft sketch" : `${viewMode} projected aircraft sizing reference`}
      >
      <SizingGrid onSetUnit={setScaleUnit} unit={scaleUnit} view={displayView} />
      <line className="sizing-centerline" x1={displayView.originX} y1="20" x2={displayView.originX} y2={displayView.height - 28} />
      <circle className="sizing-origin" cx={displayView.originX} cy={displayView.originY} r="5" />
      <text className="view-label" x="28" y="42">{viewMode === "top" ? "Top down sketch" : `${viewMode[0].toUpperCase() + viewMode.slice(1)} projected reference`}</text>
      {isPointVisible(displayView.originX, displayView.originY, displayView) ? (
        <text className="view-label subtle" x={displayView.originX + 10} y={displayView.originY - 12}>origin</text>
      ) : null}
      {displayReferenceShapes.length ? (
        <g className="sizing-reference-layer">
          {displayReferenceShapes.map((shape) => (
            <ReferenceShape key={shape.id} shape={shape} view={displayView} />
          ))}
        </g>
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
            selectedMotorId={selectedMotorId}
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
      {sizingReferenceShapes.length ? (
        <button
          className={`canvas-sizing-reference-toggle ${showSizingReference ? "active" : ""}`}
          onClick={(event) => {
            event.stopPropagation();
            onToggleSizingReference();
          }}
          title={showSizingReference ? "Hide Sizing reference" : "Show Sizing reference"}
          type="button"
        >
          {showSizingReference ? <EyeOff size={15} /> : <Eye size={15} />}
          <span>Sizing ref</span>
        </button>
      ) : null}
    </div>
  );
}
