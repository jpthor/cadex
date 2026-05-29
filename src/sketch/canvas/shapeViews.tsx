import { useRef } from "react";
import type { MouseEvent, PointerEvent } from "react";
import type {
  PartType,
  SizeDimension,
  SizeDimensionTarget,
  SizePoint,
  SizeShape,
  SizeShapeRole,
  SizingAnalysis,
} from "../../sizing";
import { shapeBounds } from "../../sizing/auditedSizingEngine";
import { referenceRoles } from "../constants";
import type { AirfoilStation, CanvasView, DimensionDraft, JoinPointSelection, PendingDimension } from "../types";
import {
  closedPathForPoints,
  canonicalPartPoints,
  dimensionTargetPoint,
  dimensionTargetPoints,
  halfMoonPath,
  isFillablePartShape,
  mirrorPoints,
  mirrorPointsAcrossPlane,
  motorFootprintPointsFromSpan,
  motorSpanPoints,
  nearestSegmentTarget,
  pathForPoints,
  pointFromShapeEvent,
  pointFromShapePointerEvent,
  pointsTouchMirrorAxis,
  rotorFlarePointsFromSpan,
  rotorSpanPoints,
  shapeTouchesMirrorPlane,
  shouldUseLocalMirror,
  tangentCanvasPoint,
  toCanvas,
  trimDimensionValue,
} from "../geometry";
export function ReferenceShape({
  projected = false,
  shape,
  showOriginMirror = true,
  view,
}: {
  projected?: boolean;
  shape: SizeShape;
  showOriginMirror?: boolean;
  view: CanvasView;
}) {
  const canonicalPoints = projected ? shape.points : canonicalPartPoints(shape);
  const renderPoints =
    projected
      ? canonicalPoints
      : shape.partType === "rotor"
        ? rotorFlarePointsFromSpan(canonicalPoints)
        : shape.partType === "motor"
          ? motorFootprintPointsFromSpan(canonicalPoints)
          : canonicalPoints;
  const shouldFill = isFillablePartShape({ ...shape, points: renderPoints });
  const path = shouldFill ? closedPathForPoints(renderPoints, view) : pathForPoints(renderPoints, view);
  const shouldRenderOriginMirror = showOriginMirror && !referenceRoles.includes(shape.role);
  const mirroredPath = shouldRenderOriginMirror ? (shouldFill ? closedPathForPoints(mirrorPoints(renderPoints), view) : pathForPoints(mirrorPoints(renderPoints), view)) : "";
  const labelPoint = renderPoints[Math.max(0, Math.floor(renderPoints.length / 2))];
  const labelCanvasPoint = labelPoint ? toCanvas(labelPoint, view) : { x: 0, y: 0 };
  return (
    <g className={`sizing-reference-shape ${shape.role} ${shape.partType ? `part-${shape.partType}` : ""}`}>
      <path d={path} />
      {shouldRenderOriginMirror ? <path d={mirroredPath} /> : null}
      <text x={labelCanvasPoint.x + 8} y={labelCanvasPoint.y - 8}>{shape.label}</text>
    </g>
  );
}

export function SketchShape({
  activeAirfoilStation,
  drawActive,
  dimensionToolActive,
  labelYOffset = 0,
  mirrorPlanes,
  readOnly = false,
  shape,
  showOriginMirror = true,
  selected,
  selectedMotorId,
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
  selectedMotorId: string;
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
  const armedInsertShapeRef = useRef<string | null>(null);
  const suppressClickAfterDeleteRef = useRef(false);
  const projected = readOnly;
  const canonicalPoints = projected ? shape.points : canonicalPartPoints(shape);
  const renderPoints =
    projected
      ? canonicalPoints
      : shape.partType === "rotor"
        ? rotorFlarePointsFromSpan(canonicalPoints)
        : shape.partType === "motor"
          ? motorFootprintPointsFromSpan(canonicalPoints)
          : canonicalPoints;
  const nodePoints = projected
    ? canonicalPoints
    : shape.partType === "rotor"
      ? rotorSpanPoints(canonicalPoints)
      : shape.partType === "motor"
        ? motorSpanPoints(canonicalPoints)
        : canonicalPoints;
  const localMirrorPlanes = shouldUseLocalMirror(shape)
    ? mirrorPlanes.filter((plane) => plane.id !== shape.id && shapeTouchesMirrorPlane(shape, plane))
    : [];
  const localMirrorSets = localMirrorPlanes.map((plane) => mirrorPointsAcrossPlane(renderPoints, plane));
  const shouldRenderOriginMirror = showOriginMirror && !referenceRoles.includes(shape.role);
  const mirrored = mirrorPoints(renderPoints);
  const partClass = shape.role === "part" ? `part-${shape.partType ?? "payload"}` : "";
  const className = `sizing-shape ${shape.role} ${partClass} ${selected ? "selected" : ""}`;
  const labelPoint = toCanvas(nodePoints[Math.max(0, Math.floor(nodePoints.length / 2))] ?? renderPoints[0], view);
  const shouldFill = isFillablePartShape({ ...shape, points: renderPoints });
  const isTypedPart = shape.role === "part";
  const showsCurveControls = !isTypedPart;
  const livePath = shouldFill ? closedPathForPoints(renderPoints, view) : pathForPoints(renderPoints, view);
  const mirrorPath = shouldRenderOriginMirror ? (shouldFill ? closedPathForPoints(mirrored, view) : pathForPoints(mirrored, view)) : "";
  const motorAxisPoints = shape.partType === "motor" ? motorAxisLinePoints(projected, canonicalPoints, renderPoints) : [];
  const motorAxisPath = motorAxisPoints.length ? pathForPoints(motorAxisPoints, view) : "";
  const motorAxisMirrorPath = shouldRenderOriginMirror && motorAxisPoints.length ? pathForPoints(mirrorPoints(motorAxisPoints), view) : "";
  const collapsedReferencePoint = collapsedReferenceCanvasPoint(shape, renderPoints, view);
  const nodeEntries = nodePoints.map((point, pointIndex) => ({ point, pointIndex }));
  const visibleNodeEntries =
    shape.partType === "motor" && !projected && nodeEntries.length >= 2
      ? [
          { point: nodeEntries[0].point, pointIndex: 0 },
          { point: motorRightDragPoint(canonicalPoints), pointIndex: 1 },
        ]
      : nodeEntries;
  function handleShapeHitPointerDown(event: PointerEvent<SVGPathElement | SVGCircleElement>) {
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
    if (selectedMotorId && shape.id !== selectedMotorId) {
      onJoinToSegment(pointFromShapePointerEvent(event, view));
      return;
    }
    if (!referenceRoles.includes(shape.role)) {
      if (!selected) onSelect();
      if (selected && shape.role === "part") {
        suppressClickAfterDeleteRef.current = true;
        window.setTimeout(() => {
          suppressClickAfterDeleteRef.current = false;
        }, 300);
        onBeginShapeDrag(event as PointerEvent<SVGPathElement>);
      }
      return;
    }
    if (!selected) {
      onSelect();
      return;
    }
    onBeginLineDrag(event as PointerEvent<SVGPathElement>);
  }

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
        if (selectedMotorId && shape.id !== selectedMotorId && (event.target as Element).closest(".shape-hit, .shape-node")) {
          return;
        }
        if (!isTypedPart && !readOnly && selected && (event.target as Element).closest(".shape-hit")) {
          if (armedInsertShapeRef.current !== shape.id) {
            armedInsertShapeRef.current = shape.id;
            onSelect();
            return;
          }
          armedInsertShapeRef.current = null;
          onInsertPoint(pointFromShapeEvent(event, view));
          return;
        }
        armedInsertShapeRef.current = (event.target as Element).closest(".shape-hit") && !isTypedPart && !readOnly ? shape.id : null;
        onSelect();
      }}
    >
      <path
        className={`shape-hit shape-hit-live ${shouldFill ? "shape-hit-filled" : ""}`}
        d={livePath}
        onPointerDown={handleShapeHitPointerDown}
      />
      {collapsedReferencePoint ? (
        <circle className="shape-hit shape-hit-dot" cx={collapsedReferencePoint.x} cy={collapsedReferencePoint.y} r="10" onPointerDown={handleShapeHitPointerDown} />
      ) : null}
      {shouldRenderOriginMirror ? <path className="shape-hit shape-hit-mirror" d={mirrorPath} /> : null}
      <path className="shape-live" d={livePath} />
      {collapsedReferencePoint ? <circle className="shape-live-dot" cx={collapsedReferencePoint.x} cy={collapsedReferencePoint.y} r="4" /> : null}
      {motorAxisPath ? <path className="shape-axis" d={motorAxisPath} /> : null}
      {localMirrorSets.map((points, index) => (
        <path className="shape-local-mirror" d={shouldFill ? closedPathForPoints(points, view) : pathForPoints(points, view)} key={`local-${index}`} />
      ))}
      {shouldRenderOriginMirror ? <path className="shape-mirror" d={mirrorPath} /> : null}
      {motorAxisMirrorPath ? <path className="shape-axis shape-axis-mirror" d={motorAxisMirrorPath} /> : null}
      {localMirrorSets.map((points, index) => {
        const globalPoints = mirrorPoints(points);
        return (
          shouldRenderOriginMirror ? (
            <path
              className="shape-local-global-mirror"
              d={shouldFill ? closedPathForPoints(globalPoints, view) : pathForPoints(globalPoints, view)}
              key={`local-global-${index}`}
            />
          ) : null
        );
      })}
      {showsCurveControls && selected && !readOnly && !referenceRoles.includes(shape.role) ? <TangencyHandles onBeginDrag={onBeginTangentDrag} points={shape.points} view={view} /> : null}
      {showsCurveControls && shouldRenderOriginMirror && selected && !readOnly && !referenceRoles.includes(shape.role) ? <TangencyHandles mirrored points={mirrorPoints(shape.points)} view={view} /> : null}
      {selected && !readOnly && shape.role === "liftingSurface" ? (
        <AirfoilStations
          activeStation={activeAirfoilStation}
          onSelectStation={onActiveAirfoilStationChange}
          shape={shape}
          view={view}
        />
      ) : null}
      {!readOnly ? visibleNodeEntries.map(({ point, pointIndex }) => {
        const canvasPoint = toCanvas(point, view);
        const isSelectedNode = joinSourcePoint?.pointIndex === pointIndex;
        const isSelectedLockedNode = isSelectedNode && Boolean(point.snapAttachment);
        return (
          <g key={`${shape.id}-${pointIndex}`}>
            {showsCurveControls && selected && !readOnly && !referenceRoles.includes(shape.role) ? (
              <NodeCurveControls index={pointIndex} onSetSegmentMode={onSetSegmentMode} point={point} points={shape.points} view={view} />
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
                if (selectedMotorId && shape.id !== selectedMotorId) return;
                if (!isTypedPart && !readOnly && event.detail >= 2) {
                  onDeletePoint(pointIndex);
                  return;
                }
                onSelectPoint(pointIndex);
              }}
              onPointerDown={(event) => {
                if (drawActive || readOnly) return;
                event.stopPropagation();
                if (event.shiftKey) {
                  onJoinToPoint(pointIndex);
                  return;
                }
                if (dimensionToolActive) {
                  onSelectDimensionTarget({ kind: "node", shapeId: shape.id, pointIndex });
                  return;
                }
                if (selectedMotorId && shape.id !== selectedMotorId) {
                  onJoinToPoint(pointIndex);
                  return;
                }
                const now = Date.now();
                const lastTap = lastNodeTapRef.current;
                const isTrackpadDoubleTap =
                  lastTap?.index === pointIndex &&
                  now - lastTap.time < 520 &&
                  Math.hypot(event.clientX - lastTap.x, event.clientY - lastTap.y) < 14;
                lastNodeTapRef.current = { index: pointIndex, time: now, x: event.clientX, y: event.clientY };
                if (!isTypedPart && (event.detail >= 2 || isTrackpadDoubleTap)) {
                  lastNodeTapRef.current = null;
                  suppressClickAfterDeleteRef.current = true;
                  window.setTimeout(() => {
                    suppressClickAfterDeleteRef.current = false;
                  }, 300);
                  onDeletePoint(pointIndex);
                  return;
                }
                onSelectPoint(pointIndex);
                onBeginDrag(pointIndex, event);
              }}
              onDoubleClick={(event) => {
                event.stopPropagation();
                if (!isTypedPart) onDeletePoint(pointIndex);
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

function motorAxisLinePoints(projected: boolean, canonicalPoints: SizePoint[], renderPoints: SizePoint[]) {
  if (renderPoints.length < 2) return [];
  const xs = renderPoints.map((point) => point.xM);
  const ys = renderPoints.map((point) => point.yM);
  const minX = Math.min(...xs);
  const maxX = Math.max(...xs);
  const minY = Math.min(...ys);
  const maxY = Math.max(...ys);
  const origin = projected ? undefined : motorSpanPoints(canonicalPoints)[0];
  const centerX = origin?.xM ?? (minX + maxX) / 2;
  return [
    { xM: centerX, yM: minY, curveMode: "corner" as const },
    { xM: centerX, yM: maxY, curveMode: "corner" as const },
  ];
}

function collapsedReferenceCanvasPoint(shape: SizeShape, points: SizePoint[], view: CanvasView) {
  if (!referenceRoles.includes(shape.role) || points.length < 2) return null;
  const first = points[0];
  if (!first) return null;
  const collapsed = points.every((point) => Math.hypot(point.xM - first.xM, point.yM - first.yM) < 1e-6);
  return collapsed ? toCanvas(first, view) : null;
}

function motorRightDragPoint(points: SizePoint[]): SizePoint {
  return motorSpanPoints(points)[1] ?? {
    xM: 0,
    yM: 0,
    curveMode: "corner" as const,
  };
}

export function DraftShape({
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
  const renderPoints =
    role === "part" && partType === "rotor"
      ? rotorFlarePointsFromSpan(displayPoints)
      : role === "part" && partType === "motor"
        ? motorFootprintPointsFromSpan(displayPoints)
        : displayPoints;
  const renderPath = role === "part" && renderPoints.length >= 3 ? closedPathForPoints(renderPoints, view) : pathForPoints(renderPoints, view);
  const shouldRenderMirror = !referenceRoles.includes(role);
  const mirrorPath = shouldRenderMirror ? (role === "part" && renderPoints.length >= 3 ? closedPathForPoints(mirrorPoints(renderPoints), view) : pathForPoints(mirrorPoints(renderPoints), view)) : "";
  return (
    <g className={className}>
      <path className="shape-live" d={renderPath} />
      {shouldRenderMirror ? <path className="shape-mirror" d={mirrorPath} /> : null}
      {showSplineControls ? <TangencyHandles onBeginDrag={onBeginTangentDrag} points={displayPoints} view={view} /> : null}
      {showSplineControls && shouldRenderMirror ? <TangencyHandles mirrored points={mirrorPoints(displayPoints)} view={view} /> : null}
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

export function AirfoilStations({
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
    { id: "root", pct: 0, label: "Root" },
    { id: "tip", pct: 1, label: "Tip" },
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

export function NodeCurveControls({
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

export function curveControlForSegment(
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

export function TangencyHandles({
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

export function AnalysisMarkers({ analysis, view }: { analysis: SizingAnalysis; view: CanvasView }) {
  const com = toCanvas(analysis.com, view);
  const cop = toCanvas(analysis.cop, view);
  return (
    <g className="analysis-markers">
      <g className="com-reference">
        <line className="reference-line" x1="24" y1={com.y} x2={view.width - 24} y2={com.y} />
        <text x={view.width - 118} y={com.y - 8}>CoM X {analysis.com.yM.toFixed(2)} m</text>
      </g>
      <g className="cop-reference">
        <line className="reference-line" x1="24" y1={cop.y} x2={view.width - 24} y2={cop.y} />
        <text x={view.width - 118} y={cop.y + 18}>CoP X {analysis.cop.yM.toFixed(2)} m</text>
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

export function DimensionLayer({
  dimensionDraft,
  dimensions,
  onBeginDimensionDrag,
  onDeleteDimension,
  onSelectDimension,
  pendingDimension,
  pendingDimensionValue,
  selectedDimensionId,
  shapes,
  view,
}: {
  dimensionDraft: DimensionDraft;
  dimensions: SizeDimension[];
  onBeginDimensionDrag: (id: string, event: PointerEvent<SVGTextElement>) => void;
  onDeleteDimension: (id: string) => void;
  onSelectDimension: (id: string) => void;
  pendingDimension: PendingDimension;
  pendingDimensionValue: string;
  selectedDimensionId: string | null;
  shapes: SizeShape[];
  view: CanvasView;
}) {
  const draftPoint = dimensionDraft ? dimensionTargetPoint(dimensionDraft.firstTarget, shapes) : undefined;
  const pendingTargetPoints = pendingDimension ? dimensionTargetPoints(pendingDimension.targetA, pendingDimension.targetB, shapes) : undefined;
  const pendingStart = pendingTargetPoints?.start;
  const pendingEnd = pendingTargetPoints?.end;
  return (
    <g className="dimension-layer">
      <defs>
        <marker id="dimension-arrow-end" markerHeight="8" markerWidth="8" orient="auto" refX="6" refY="4">
          <path d="M 0 0 L 8 4 L 0 8 z" />
        </marker>
        <marker id="dimension-arrow-start" markerHeight="8" markerWidth="8" orient="auto-start-reverse" refX="2" refY="4">
          <path d="M 8 0 L 0 4 L 8 8 z" />
        </marker>
      </defs>
      {dimensions.map((dimension) => {
        const targetPoints = dimensionTargetPoints(dimension.targetA, dimension.targetB, shapes);
        const start = targetPoints?.start;
        const end = targetPoints?.end;
        if (!start || !end) return null;
        const geometry = dimensionGeometry(start, end, view, dimension.labelOffset);
        if (!geometry) return null;
        const selected = dimension.id === selectedDimensionId;
        return (
          <g
            className={`dimension-lock ${selected ? "selected" : ""}`}
            key={dimension.id}
            onClick={(event) => {
              event.stopPropagation();
              onSelectDimension(dimension.id);
            }}
            onPointerDown={(event) => {
              if ((event.target as Element).closest(".dimension-delete-control, .dimension-label")) return;
              event.stopPropagation();
              onSelectDimension(dimension.id);
            }}
          >
            <DimensionGraphics geometry={geometry} />
            <text
              className="dimension-label"
              onPointerDown={(event) => {
                event.stopPropagation();
                onSelectDimension(dimension.id);
                onBeginDimensionDrag(dimension.id, event);
              }}
              textAnchor="middle"
              x={geometry.label.x}
              y={geometry.label.y - 8}
            >
              {`${dimension.label} ${trimDimensionValue(dimension.valueM)} m`}
            </text>
            {selected ? (
              <g
                className="dimension-delete-control"
                onClick={(event) => {
                  event.stopPropagation();
                  onDeleteDimension(dimension.id);
                }}
                onPointerDown={(event) => event.stopPropagation()}
                transform={`translate(${geometry.label.x + 34} ${geometry.label.y - 13})`}
              >
                <circle r="9" />
                <text textAnchor="middle" x="0" y="4">x</text>
              </g>
            ) : null}
          </g>
        );
      })}
      {pendingDimension && pendingStart && pendingEnd ? (
        <PendingDimensionGraphic
          end={pendingEnd}
          label={pendingDimensionValue ? `${trimDimensionValue(Number(pendingDimensionValue))} m` : ""}
          start={pendingStart}
          view={view}
        />
      ) : null}
      {draftPoint ? (
        <circle className="dimension-draft-target" cx={toCanvas(draftPoint, view).x} cy={toCanvas(draftPoint, view).y} r="9" />
      ) : null}
    </g>
  );
}

function PendingDimensionGraphic({
  end,
  label,
  start,
  view,
}: {
  end: SizePoint;
  label: string;
  start: SizePoint;
  view: CanvasView;
}) {
  const geometry = dimensionGeometry(start, end, view);
  if (!geometry) return null;
  return (
    <g className="dimension-lock dimension-pending">
      <DimensionGraphics geometry={geometry} />
      {label ? <text className="dimension-label" textAnchor="middle" x={geometry.label.x} y={geometry.label.y - 8}>{label}</text> : null}
    </g>
  );
}

function DimensionGraphics({ geometry }: { geometry: DimensionGeometry }) {
  return (
    <>
      <line className="dimension-hit" x1={geometry.dimStart.x} y1={geometry.dimStart.y} x2={geometry.dimEnd.x} y2={geometry.dimEnd.y} />
      <line className="dimension-hit" x1={geometry.start.x} y1={geometry.start.y} x2={geometry.dimStart.x} y2={geometry.dimStart.y} />
      <line className="dimension-hit" x1={geometry.end.x} y1={geometry.end.y} x2={geometry.dimEnd.x} y2={geometry.dimEnd.y} />
      <line className="dimension-extension" x1={geometry.start.x} y1={geometry.start.y} x2={geometry.dimStart.x} y2={geometry.dimStart.y} />
      <line className="dimension-extension" x1={geometry.end.x} y1={geometry.end.y} x2={geometry.dimEnd.x} y2={geometry.dimEnd.y} />
      <line className="dimension-measure" markerEnd="url(#dimension-arrow-end)" markerStart="url(#dimension-arrow-start)" x1={geometry.dimStart.x} y1={geometry.dimStart.y} x2={geometry.dimEnd.x} y2={geometry.dimEnd.y} />
      <circle className="dimension-hit-point" cx={geometry.start.x} cy={geometry.start.y} r="9" />
      <circle className="dimension-hit-point" cx={geometry.end.x} cy={geometry.end.y} r="9" />
      <circle cx={geometry.start.x} cy={geometry.start.y} r="3" />
      <circle cx={geometry.end.x} cy={geometry.end.y} r="3" />
    </>
  );
}

type DimensionGeometry = {
  dimEnd: { x: number; y: number };
  dimStart: { x: number; y: number };
  end: { x: number; y: number };
  label: { x: number; y: number };
  start: { x: number; y: number };
};

function dimensionGeometry(start: SizePoint, end: SizePoint, view: CanvasView, labelOffset?: SizePoint): DimensionGeometry | null {
  const startCanvas = toCanvas(start, view);
  const endCanvas = toCanvas(end, view);
  const dx = endCanvas.x - startCanvas.x;
  const dy = endCanvas.y - startCanvas.y;
  const length = Math.hypot(dx, dy);
  if (length <= 1e-6) return null;
  const normal = { x: -dy / length, y: dx / length };
  const midCanvas = { x: (startCanvas.x + endCanvas.x) / 2, y: (startCanvas.y + endCanvas.y) / 2 };
  const label = labelOffset
    ? toCanvas({ xM: (start.xM + end.xM) / 2 + labelOffset.xM, yM: (start.yM + end.yM) / 2 + labelOffset.yM }, view)
    : { x: midCanvas.x + normal.x * 34, y: midCanvas.y + normal.y * 34 };
  const offset = (label.x - midCanvas.x) * normal.x + (label.y - midCanvas.y) * normal.y;
  const dimStart = { x: startCanvas.x + normal.x * offset, y: startCanvas.y + normal.y * offset };
  const dimEnd = { x: endCanvas.x + normal.x * offset, y: endCanvas.y + normal.y * offset };
  return { dimEnd, dimStart, end: endCanvas, label, start: startCanvas };
}

export function CanvasCursorPoint({ point, view }: { point: SizePoint; view: CanvasView }) {
  const cursor = toCanvas(point, view);
  return (
    <g className="canvas-cursor-point">
      <line x1={cursor.x - 8} y1={cursor.y} x2={cursor.x + 8} y2={cursor.y} />
      <line x1={cursor.x} y1={cursor.y - 8} x2={cursor.x} y2={cursor.y + 8} />
      <circle cx={cursor.x} cy={cursor.y} r="4" />
    </g>
  );
}
