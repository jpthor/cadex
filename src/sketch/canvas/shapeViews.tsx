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
import type { AirfoilStation, CanvasView, DimensionDraft, JoinPointSelection } from "../types";
import {
  closedPathForPoints,
  dimensionTargetPoint,
  halfMoonPath,
  isFillablePartShape,
  mirrorPoints,
  mirrorPointsAcrossPlane,
  motorSpanPoints,
  nearestSegmentTarget,
  pathForPoints,
  pointFromShapeEvent,
  pointFromShapePointerEvent,
  rotorFlarePointsFromSpan,
  rotorSpanPoints,
  shapeTouchesMirrorPlane,
  shouldUseLocalMirror,
  tangentCanvasPoint,
  toCanvas,
  trimDimensionValue,
} from "../geometry";
export function ReferenceShape({ shape, view }: { shape: SizeShape; view: CanvasView }) {
  const renderPoints =
    shape.partType === "rotor" ? rotorFlarePointsFromSpan(shape.points) : shape.partType === "motor" ? motorSpanPoints(shape.points) : shape.points;
  const shouldFill = isFillablePartShape({ ...shape, points: renderPoints });
  const path = shouldFill ? closedPathForPoints(renderPoints, view) : pathForPoints(renderPoints, view);
  const mirroredPath = shouldFill ? closedPathForPoints(mirrorPoints(renderPoints), view) : pathForPoints(mirrorPoints(renderPoints), view);
  const labelPoint = renderPoints[Math.max(0, Math.floor(renderPoints.length / 2))];
  const labelCanvasPoint = labelPoint ? toCanvas(labelPoint, view) : { x: 0, y: 0 };
  return (
    <g className={`sizing-reference-shape ${shape.role} ${shape.partType ? `part-${shape.partType}` : ""}`}>
      <path d={path} />
      <path d={mirroredPath} />
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
  const suppressClickAfterDeleteRef = useRef(false);
  const renderPoints =
    shape.partType === "rotor" ? rotorFlarePointsFromSpan(shape.points) : shape.partType === "motor" ? motorSpanPoints(shape.points) : shape.points;
  const mirrored = mirrorPoints(renderPoints);
  const nodePoints = shape.partType === "rotor" ? rotorSpanPoints(shape.points) : shape.partType === "motor" ? motorSpanPoints(shape.points) : shape.points;
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
        if (selectedMotorId && shape.id !== selectedMotorId && (event.target as Element).closest(".shape-hit, .shape-node")) {
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
                if (selectedMotorId && shape.id !== selectedMotorId) return;
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
                if (selectedMotorId && shape.id !== selectedMotorId) {
                  onJoinToPoint(index);
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
        ? motorSpanPoints(displayPoints)
        : displayPoints;
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

export function DimensionLayer({
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
