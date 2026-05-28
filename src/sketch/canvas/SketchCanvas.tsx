import { Eye, EyeOff, Maximize2 } from "lucide-react";
import { useEffect, useMemo, useRef, useState } from "react";
import type { MouseEvent, PointerEvent, WheelEvent } from "react";
import type {
  LiftingSurfaceKind,
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
import { liftingSurfaceKindLabels, partTypeLabels } from "../../sizing";
import {
  axisAlignedPoint,
  cloneSizePoints,
  distanceBetweenPoints,
  dimensionTargetPoint,
  fitCanvasView,
  flattenPointForFrontView,
  fromCanvas,
  implicitMirrorShapeId,
  isPointVisible,
  partShapePointsFromDraft,
  projectedShape,
  snapPoint,
  svgPointFromClient,
  svgPointFromEvent,
  toCanvas,
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
  initialCanvasView,
  showSizingReference,
  sizingReferenceShapes,
  analysis,
  onAddPoint,
  onActiveRoleChange,
  activeLiftingSurfaceKind,
  onActiveLiftingSurfaceKindChange,
  onActivePartTypeChange,
  onCancel,
  onDone,
  onSelect,
  onSelectDimension,
  onSetDrawActive,
  onSetDimensionToolActive,
  onSetPreviewPoint,
  onCanvasViewChange,
  onToggleSizingReference,
  onMoveDraftPoint,
  onMoveShapePoint,
  onMoveShapeLine,
  onMoveShapePoints,
  onMoveDimensionLabel,
  onBeginUndoableEdit,
  onDeleteDimension,
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
  initialCanvasView?: CanvasView;
  showSizingReference: boolean;
  sizingReferenceShapes: SizeShape[];
  analysis?: SizingAnalysis;
  onAddPoint: (point: SizePoint) => void;
  onActiveRoleChange: (role: SizeShapeRole) => void;
  activeLiftingSurfaceKind: LiftingSurfaceKind;
  onActiveLiftingSurfaceKindChange: (kind: LiftingSurfaceKind) => void;
  onActivePartTypeChange: (partType: PartType) => void;
  onCancel: () => void;
  onDone: (viewMode: CanvasViewMode) => void;
  onSelect: (id: string) => void;
  onSelectDimension: (id: string) => void;
  onSetDrawActive: (active: boolean) => void;
  onSetDimensionToolActive: (active: boolean) => void;
  onSetPreviewPoint: (point: SizePoint | null) => void;
  onCanvasViewChange: (view: CanvasView) => void;
  onToggleSizingReference: () => void;
	  onMoveDraftPoint: (index: number, point: SizePoint) => void;
	  onMoveShapePoint: (shapeId: string, index: number, point: SizePoint) => void;
  onMoveShapeLine: (shapeId: string, points: SizePoint[]) => void;
  onMoveShapePoints: (shapeId: string, points: SizePoint[]) => void;
  onMoveDimensionLabel: (dimensionId: string, offset: SizePoint) => void;
  onBeginUndoableEdit: () => void;
  onDeleteDimension: (id: string) => void;
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
      | { kind: "dimensionLabel"; dimensionId: string; pointerId: number }
	    | { kind: "draftTangent"; index: number; side: "in" | "out"; pointerId: number }
	    | { kind: "shapeTangent"; shapeId: string; index: number; side: "in" | "out"; pointerId: number }
	    | null
	  >(null);
  const [canvasView, setCanvasView] = useState<CanvasView>(() => initialCanvasView ?? fitCanvasView(shapes));
  const [scaleUnit, setScaleUnit] = useState<ScaleUnit>("cm");
  const [viewMode, setViewMode] = useState<CanvasViewMode>("top");
  const [renderViewMode, setRenderViewMode] = useState<CanvasViewMode>("top");
  const [isViewTransitioning, setIsViewTransitioning] = useState(false);
  const [canvasCursorPoint, setCanvasCursorPoint] = useState<SizePoint | null>(null);
  const [referenceMenuOpen, setReferenceMenuOpen] = useState(false);
  const [showGuides, setShowGuides] = useState(true);
  const ignoreNextCanvasClick = useRef(false);
  const pointPlacedOnPress = useRef(false);
  const viewTransitionTimer = useRef<number | undefined>(undefined);
  const viewTransitionSerial = useRef(0);
  const mirrorPlanes = shapes.filter((shape) => shape.role === "mirrorPlane" && shape.points.length >= 2);
  const visibleShapes = showGuides ? shapes : shapes.filter((shape) => !referenceRoles.includes(shape.role));
  const displayView = {
    ...canvasView,
    originY: renderViewMode === "front" ? canvasView.height / 2 : canvasView.originY,
  };
  const displayShapes = renderViewMode === "top"
    ? visibleShapes
    : visibleShapes.map((shape) => (shape.sketchViewMode === renderViewMode ? shape : projectedShape(shape, 1, shapes, renderViewMode)));
  const visibleReferenceShapes = showSizingReference ? sizingReferenceShapes : [];
  const displayReferenceShapes =
    renderViewMode !== "top"
      ? visibleReferenceShapes.map((shape) => projectedShape(shape, 1, shapes, renderViewMode))
      : visibleReferenceShapes;
  const renderedShapes = [...displayShapes].sort((a, b) => Number(referenceRoles.includes(b.role)) - Number(referenceRoles.includes(a.role)));
  const topDraftPoints = draftRole === "part" ? partShapePointsFromDraft(activePartType, draftPreviewPoint ? [...draftPoints, draftPreviewPoint] : draftPoints) : draftPoints;
  const canDrawSideLiftingSurface = drawActive && draftRole === "liftingSurface" && viewMode === "side";
  const displayDraftPoints = renderViewMode !== "top" && !canDrawSideLiftingSurface ? topDraftPoints.map((point) => flattenPointForFrontView(point, 1)) : topDraftPoints;
  const displayDraftPreviewPoint =
    draftRole === "part"
      ? null
      : renderViewMode !== "top" && draftPreviewPoint && !canDrawSideLiftingSurface
        ? flattenPointForFrontView(draftPreviewPoint, 1)
        : draftPreviewPoint;
  const canEditCanvas = (viewMode === "top" || canDrawSideLiftingSurface) && !isViewTransitioning;
  const drawIsSplineTool = drawActive && !referenceRoles.includes(draftRole);
  const selectedMotorId = shapes.find((shape) => shape.id === selectedShapeId && shape.role === "part" && shape.partType === "motor")?.id ?? "";
  const dimensionPrompt = dimensionToolActive && !pendingDimension
    ? dimensionDraft
      ? "Click second element"
      : "Click first element"
    : null;

  useEffect(() => () => window.clearTimeout(viewTransitionTimer.current), []);

  useEffect(() => {
    if (!initialCanvasView) return;
    setCanvasView(initialCanvasView);
  }, [
    initialCanvasView?.height,
    initialCanvasView?.originX,
    initialCanvasView?.originY,
    initialCanvasView?.scale,
    initialCanvasView?.width,
  ]);

  useEffect(() => {
    if (drawActive && viewMode !== "top" && !(viewMode === "side" && draftRole === "liftingSurface")) transitionToView("top");
  }, [draftRole, drawActive, viewMode]);

  function updateCanvasView(next: CanvasView | ((current: CanvasView) => CanvasView)) {
    setCanvasView((current) => {
      const resolved = typeof next === "function" ? next(current) : next;
      onCanvasViewChange(resolved);
      return resolved;
    });
  }

  function transitionToView(nextViewMode: CanvasViewMode) {
    if (nextViewMode === viewMode && !isViewTransitioning) return;
    const serial = viewTransitionSerial.current + 1;
    viewTransitionSerial.current = serial;
    window.clearTimeout(viewTransitionTimer.current);
    setViewMode(nextViewMode);
    setIsViewTransitioning(true);
    window.setTimeout(() => {
      if (serial !== viewTransitionSerial.current) return;
      setRenderViewMode(nextViewMode);
      viewTransitionTimer.current = window.setTimeout(() => {
        if (serial !== viewTransitionSerial.current) return;
        setIsViewTransitioning(false);
      }, 160);
    }, 160);
  }

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
      if (event.shiftKey) {
        const point = pointFromEvent(event);
        if (point.snapAttachment?.shapeId === implicitMirrorShapeId) {
          event.stopPropagation();
          onJoinToSegment(implicitMirrorShapeId, point);
          return;
        }
      }
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
    } else if (dragTarget.kind === "dimensionLabel") {
      const midpoint = dimensionMidpoint(dragTarget.dimensionId);
      if (midpoint) {
        onMoveDimensionLabel(dragTarget.dimensionId, {
          xM: point.xM - midpoint.xM,
          yM: point.yM - midpoint.yM,
        });
      }
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
      dragTarget.kind === "dimensionLabel" ||
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
      updateCanvasView((current) => ({
        ...current,
        originX: current.originX - event.deltaX,
        originY: current.originY - event.deltaY,
      }));
      return;
    }
    const zoomFactor = Math.exp(-event.deltaY * 0.0025);
    const cursor = svgPointFromEvent(event, displayView);
    const cursorWorld = fromCanvas(cursor.x, cursor.y, displayView);
    updateCanvasView((current) => {
      const nextScale = Math.min(baseCanvasView.scale * 80, Math.max(baseCanvasView.scale * 0.25, current.scale * zoomFactor));
      return {
        ...current,
        originX: cursor.x - cursorWorld.xM * nextScale,
        originY: cursor.y + cursorWorld.yM * nextScale,
        scale: nextScale,
      };
    });
  }

  function zoomToFit() {
    const fitShapes = [...visibleShapes, ...visibleReferenceShapes];
    updateCanvasView(fitCanvasView(fitShapes, renderViewMode));
  }

  function dimensionMidpoint(dimensionId: string): SizePoint | undefined {
    const dimension = dimensions.find((candidate) => candidate.id === dimensionId);
    if (!dimension) return undefined;
    const start = dimensionTargetPoint(dimension.targetA, shapes);
    const end = dimensionTargetPoint(dimension.targetB, shapes);
    if (!start || !end) return undefined;
    return {
      xM: (start.xM + end.xM) / 2,
      yM: (start.yM + end.yM) / 2,
    };
  }

  return (
    <div className="sizing-canvas-wrap">
      {viewMode === "front" ? (
        <button className="canvas-view-button canvas-view-button-bottom" onClick={() => transitionToView("top")} type="button">
          Top
        </button>
      ) : (
        <button className="canvas-view-button canvas-view-button-top" onClick={() => transitionToView("front")} type="button">
          Front
        </button>
      )}
      {viewMode === "side" ? (
        <button className="canvas-view-button canvas-view-button-left" onClick={() => transitionToView("top")} type="button">
          Top
        </button>
      ) : (
        <button className="canvas-view-button canvas-view-button-right" onClick={() => transitionToView("side")} type="button">
          Side
        </button>
      )}
      <div
        className={`canvas-reference-menu ${referenceMenuOpen ? "open" : ""}`}
        onMouseEnter={() => setReferenceMenuOpen(true)}
        onMouseLeave={() => setReferenceMenuOpen(false)}
      >
        <button
          className={referenceRoles.includes(draftRole) || dimensionToolActive ? "active" : ""}
          onClick={() => setReferenceMenuOpen((open) => !open)}
          aria-expanded={referenceMenuOpen}
          aria-haspopup="menu"
          type="button"
        >
          +
        </button>
        <div className="canvas-reference-options" role="menu">
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
      <div className={`canvas-sketch-toolbar ${drawActive ? "drawing" : ""}`}>
        <button
          className={drawIsSplineTool ? "active" : ""}
          onClick={() => {
            if (viewMode === "side") {
              onActiveRoleChange("liftingSurface");
              onActiveLiftingSurfaceKindChange("fin");
            } else if (referenceRoles.includes(draftRole)) {
              onActiveRoleChange("body");
            }
            onSetDimensionToolActive(false);
            if (viewMode !== "top" && viewMode !== "side") transitionToView("top");
            onSetDrawActive(!drawIsSplineTool);
            setReferenceMenuOpen(false);
          }}
        >
          Draw
        </button>
        <button className="done-button" disabled={draftPoints.length < 2} onClick={() => onDone(viewMode)}>
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
                if (viewMode === "side") onActiveLiftingSurfaceKindChange("fin");
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
            {draftRole === "liftingSurface" ? (
              <select
                aria-label="Lifting surface type"
                className="canvas-part-type-select"
                value={activeLiftingSurfaceKind}
                onChange={(event) => onActiveLiftingSurfaceKindChange(event.target.value as LiftingSurfaceKind)}
              >
                {Object.entries(liftingSurfaceKindLabels).map(([kind, label]) => (
                  <option key={kind} value={kind}>
                    {label}
                  </option>
                ))}
              </select>
            ) : null}
          </div>
        ) : null}
      </div>
      <svg
        className={`sizing-canvas ${isViewTransitioning ? "view-transitioning" : ""}`}
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
        aria-label={renderViewMode === "top" ? "Top down half aircraft sketch" : `${renderViewMode} projected aircraft sizing reference`}
      >
      <SizingGrid onSetUnit={setScaleUnit} unit={scaleUnit} view={displayView} />
      <line className="sizing-centerline implicit-y-mirror" x1={displayView.originX} y1="20" x2={displayView.originX} y2={displayView.height - 28} />
      <circle className="sizing-origin" cx={displayView.originX} cy={displayView.originY} r="5" />
      <text className="view-label" x="28" y="42">{renderViewMode === "top" ? "Top down sketch" : `${renderViewMode[0].toUpperCase() + renderViewMode.slice(1)} projected reference`}</text>
      {isPointVisible(displayView.originX, displayView.originY, displayView) ? (
        <text className="view-label subtle" x={displayView.originX + 10} y={displayView.originY - 12}>origin</text>
      ) : null}
      {renderViewMode === "top" && isPointVisible(displayView.originX, 46, displayView) ? (
        <text className="implicit-y-mirror-label" x={displayView.originX + 10} y="58">Y mirror</text>
      ) : null}
      {displayReferenceShapes.length ? (
        <g className="sizing-reference-layer">
          {displayReferenceShapes.map((shape) => (
            <ReferenceShape
              key={shape.id}
              projected={renderViewMode !== "top"}
              shape={shape}
              showOriginMirror={renderViewMode !== "side"}
              view={displayView}
            />
          ))}
        </g>
      ) : null}
      <g>
        {renderedShapes.map((shape, index) => (
          <SketchShape
            drawActive={drawActive}
            dimensionToolActive={dimensionToolActive}
            key={shape.id}
            labelYOffset={renderViewMode !== "top" ? -14 - (index % 8) * 13 : 0}
            onSelect={() => onSelect(shape.id)}
            readOnly={!canEditCanvas}
            selected={shape.id === selectedShapeId}
            selectedMotorId={selectedMotorId}
            shape={shape}
            showOriginMirror={renderViewMode !== "side"}
            mirrorPlanes={renderViewMode !== "top" ? [] : mirrorPlanes}
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
      {drawActive && renderViewMode === "top" && !isViewTransitioning && displayDraftPoints.length ? (
        <LiveDraftDimensions
          partType={draftRole === "part" ? activePartType : undefined}
          points={displayDraftPoints}
          previewPoint={displayDraftPreviewPoint}
          role={draftRole}
          view={displayView}
        />
      ) : null}
      {renderViewMode === "top" && !isViewTransitioning ? (
        <DimensionLayer
          dimensionDraft={dimensionDraft}
          dimensions={dimensions}
          onBeginDimensionDrag={(dimensionId, event) => {
            event.currentTarget.ownerSVGElement?.setPointerCapture(event.pointerId);
            setDragTarget({ kind: "dimensionLabel", dimensionId, pointerId: event.pointerId });
          }}
          onDeleteDimension={onDeleteDimension}
          onSelectDimension={onSelectDimension}
          pendingDimension={pendingDimension}
          pendingDimensionValue={pendingDimensionValue}
          selectedDimensionId={selectedDimensionId}
          shapes={shapes}
          view={displayView}
        />
      ) : null}
      {analysis && showGuides && renderViewMode === "top" && !isViewTransitioning ? <AnalysisMarkers analysis={analysis} view={displayView} /> : null}
      {drawActive && canvasCursorPoint && canEditCanvas ? <CanvasCursorPoint point={canvasCursorPoint} view={displayView} /> : null}
      </svg>
      <button
        aria-label="Zoom to fit"
        className="canvas-zoom-fit-button"
        onClick={(event) => {
          event.stopPropagation();
          zoomToFit();
        }}
        title="Zoom to fit"
        type="button"
      >
        <Maximize2 size={16} />
      </button>
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

function LiveDraftDimensions({
  partType,
  points,
  previewPoint,
  role,
  view,
}: {
  partType?: PartType;
  points: SizePoint[];
  previewPoint: SizePoint | null;
  role: SizeShapeRole;
  view: CanvasView;
}) {
  const labels = liveDimensionLabels(role, partType, points, previewPoint);
  if (!labels.length) return null;
  const anchor = liveDimensionAnchor(points, previewPoint, view);
  return (
    <g className="live-dimension-layer">
      <rect x={anchor.x - 6} y={anchor.y - 16} width={liveDimensionWidth(labels)} height={labels.length * 18 + 10} rx="5" />
      {labels.map((label, index) => (
        <text key={label} x={anchor.x} y={anchor.y + index * 18}>{label}</text>
      ))}
    </g>
  );
}

function liveDimensionLabels(role: SizeShapeRole, partType: PartType | undefined, points: SizePoint[], previewPoint: SizePoint | null) {
  if (role === "part" && partType) return partDimensionLabels(partType, points);
  const segment = lastDraftSegment(points, previewPoint);
  if (!segment || referenceRoles.includes(role)) return [];
  return [`Last ${formatDraftDimension(distanceBetweenPoints(segment.start, segment.end))}`];
}

function partDimensionLabels(partType: PartType, points: SizePoint[]) {
  if (points.length < 2) return [];
  const bounds = draftBounds(points);
  if (partType === "motor") {
    return [
      `Diameter ${formatDraftDimension(bounds.maxX - bounds.minX)}`,
      `Length ${formatDraftDimension(bounds.maxY - bounds.minY)}`,
    ];
  }
  if (partType === "battery") {
    const lengthM = bounds.maxY - bounds.minY;
    const widthM = bounds.maxX - bounds.minX;
    return [
      `L ${formatDraftDimension(lengthM)}`,
      `W ${formatDraftDimension(widthM)}`,
      `H ${formatDraftDimension(inferredDraftBatteryHeight(lengthM, widthM))}`,
    ];
  }
  if (partType === "rotor") {
    return [`Diameter ${formatDraftDimension(distanceBetweenPoints(points[0], points[points.length - 1]) * 2)}`];
  }
  return [];
}

function lastDraftSegment(points: SizePoint[], previewPoint: SizePoint | null) {
  if (previewPoint && points.length) return { start: points[points.length - 1], end: previewPoint };
  if (points.length >= 2) return { start: points[points.length - 2], end: points[points.length - 1] };
  return null;
}

function draftBounds(points: SizePoint[]) {
  const xs = points.map((point) => point.xM);
  const ys = points.map((point) => point.yM);
  return {
    minX: Math.min(...xs),
    maxX: Math.max(...xs),
    minY: Math.min(...ys),
    maxY: Math.max(...ys),
  };
}

function inferredDraftBatteryHeight(lengthM: number, widthM: number) {
  const smaller = Math.min(Math.abs(lengthM), Math.abs(widthM));
  return Math.min(0.08, Math.max(0.012, smaller * 0.28));
}

function liveDimensionAnchor(points: SizePoint[], previewPoint: SizePoint | null, view: CanvasView) {
  const displayPoints = previewPoint ? [...points, previewPoint] : points;
  const bounds = draftBounds(displayPoints);
  return toCanvas({ xM: bounds.maxX, yM: bounds.minY }, view);
}

function liveDimensionWidth(labels: string[]) {
  return Math.max(...labels.map((label) => label.length), 8) * 7 + 14;
}

function formatDraftDimension(valueM: number) {
  const value = Math.abs(valueM);
  if (!Number.isFinite(value) || value <= 0) return "0 mm";
  return value >= 1 ? `${value.toFixed(2)} m` : `${(value * 1000).toFixed(0)} mm`;
}
