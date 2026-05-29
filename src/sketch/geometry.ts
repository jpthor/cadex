import type { MouseEvent, PointerEvent } from "react";
import type {
  PartType,
  SizeDimension,
  SizeDimensionTarget,
  SizePoint,
  SizeShape,
  SizeCadGeometry,
  SizeSnapAttachment,
  SizingProject,
} from "../sizing/index.ts";
import {
  inferredBatteryThicknessM,
  inferredMotorDepthM,
  rotorDiameterEstimate,
  shapeBounds,
} from "../sizing/auditedSizingEngine.ts";
import {
  airfoilOptions,
  baseCanvasView,
  mirrorAxisTouchToleranceM,
  referenceRoles,
  sideCollapseProgress,
} from "./constants.ts";
import type { CanvasView, CanvasViewMode, ScaleUnit, SideProjectionFrame } from "./types.ts";

export const implicitMirrorShapeId = "implicit-x-axis-mirror";
export const legacyImplicitMirrorShapeId = "implicit-y-axis-mirror";

export function isImplicitMirrorShapeId(shapeId: string | undefined) {
  return shapeId === implicitMirrorShapeId || shapeId === legacyImplicitMirrorShapeId;
}

function implicitMirrorShape(): SizeShape {
  return {
    id: implicitMirrorShapeId,
    role: "mirrorPlane",
    label: "X=0 mirror",
    drawMode: "line",
    points: [
      { xM: 0, yM: -1000, curveMode: "corner" },
      { xM: 0, yM: 1000, curveMode: "corner" },
    ],
  };
}

export function fitCanvasView(shapes: SizeShape[], viewMode: CanvasViewMode = "top") {
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

export function chooseMajorTickMeters(scale: number) {
  const targetPixels = 72;
  const rawMeters = targetPixels / scale;
  const magnitude = 10 ** Math.floor(Math.log10(rawMeters));
  const normalized = rawMeters / magnitude;
  const step = normalized <= 1 ? 1 : normalized <= 2 ? 2 : normalized <= 5 ? 5 : 10;
  return step * magnitude;
}

export function chooseMinorTickMeters(majorTickM: number) {
  const defaultMinor = majorTickM / 5;
  const magnitude = 10 ** Math.floor(Math.log10(defaultMinor));
  const normalized = defaultMinor / magnitude;
  return Math.abs(normalized - 2) < 0.001 ? magnitude : defaultMinor;
}

export function formatScaleValue(valueM: number, unit: ScaleUnit) {
  const multiplier = unit === "m" ? 1 : unit === "cm" ? 100 : 1000;
  const value = valueM * multiplier;
  if (Math.abs(value) >= 100 || Number.isInteger(value)) return value.toFixed(0);
  if (Math.abs(value) >= 10) return value.toFixed(1);
  return value.toFixed(2);
}

export function snapPoint(point: SizePoint, view: CanvasView, shapes: SizeShape[], draftPoints: SizePoint[] = []) {
  const geometrySnap = snapPointToGeometry(point, view, shapes);
  const draftSnap = snapPointToDraft(point, view, draftPoints);
  return geometrySnap ?? draftSnap ?? snapPointToGrid(point, view);
}

export function snapPointToGeometry(point: SizePoint, view: CanvasView, shapes: SizeShape[]) {
  const nodeThresholdM = 18 / view.scale;
  const segmentThresholdM = 16 / view.scale;
  if (Math.abs(point.xM) <= segmentThresholdM) {
    return {
      ...point,
      xM: 0,
      snapAttachment: { kind: "segment", shapeId: implicitMirrorShapeId, segmentIndex: 0, t: (point.yM + 1000) / 2000 } as SizeSnapAttachment,
    };
  }
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

export function snapPointToDraft(point: SizePoint, view: CanvasView, draftPoints: SizePoint[]) {
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

export function snapPointToGrid(point: SizePoint, view: CanvasView) {
  const tickM = chooseMinorTickMeters(chooseMajorTickMeters(view.scale));
  return {
    ...point,
    xM: snapNumber(point.xM, tickM),
    yM: snapNumber(point.yM, tickM),
  };
}

export function snapNumber(value: number, step: number) {
  return Number((Math.round(value / step) * step).toFixed(6));
}

export function isMultipleOf(value: number, step: number) {
  return Math.abs(value / step - Math.round(value / step)) < 0.001;
}

export function isPointVisible(x: number, y: number, view: CanvasView) {
  return x >= 0 && x <= view.width && y >= 0 && y <= view.height;
}

export function clamp(value: number, min: number, max: number) {
  return Math.min(max, Math.max(min, value));
}

export function distanceBetweenPoints(a: SizePoint, b: SizePoint) {
  return Math.hypot(a.xM - b.xM, a.yM - b.yM);
}

export function axisAlignedPoint(anchor: SizePoint, point: SizePoint) {
  const dx = point.xM - anchor.xM;
  const dy = point.yM - anchor.yM;
  return Math.abs(dx) >= Math.abs(dy) ? { ...point, yM: anchor.yM } : { ...point, xM: anchor.xM };
}

export function projectPointToSegment(point: SizePoint, start: SizePoint, end: SizePoint) {
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

export function projectPointToShapeSegment(point: SizePoint, points: SizePoint[], segmentIndex: number) {
  const start = points[segmentIndex];
  const end = points[segmentIndex + 1];
  if (!start || !end) return { point, t: 0 };
  const segmentMode = segmentRenderMode(start, end);
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

export function pointAtShapeSegmentT(points: SizePoint[], segmentIndex: number, t: number): SizePoint {
  const start = points[segmentIndex];
  const end = points[segmentIndex + 1];
  if (!start || !end) return { xM: 0, yM: 0 };
  const segmentMode = segmentRenderMode(start, end);
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

export function tangentWorldPoint(point: SizePoint, side: "in" | "out", points: SizePoint[], index: number): SizePoint {
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

export function cubicPoint(p0: SizePoint, p1: SizePoint, p2: SizePoint, p3: SizePoint, t: number): SizePoint {
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

export function svgPointFromEvent(event: MouseEvent<SVGSVGElement> | PointerEvent<SVGSVGElement>, view: CanvasView) {
  const svg = event.currentTarget;
  return svgPointFromClient(svg, event.clientX, event.clientY, view);
}

export function pointFromShapeEvent(event: MouseEvent<SVGGElement>, view: CanvasView): SizePoint {
  const svg = event.currentTarget.ownerSVGElement;
  if (!svg) return { xM: 0, yM: 0 };
  const point = svgPointFromClient(svg, event.clientX, event.clientY, view);
  return { ...fromCanvas(point.x, point.y, view), xM: Math.abs(fromCanvas(point.x, point.y, view).xM), curveMode: "spline" };
}

export function pointFromShapePointerEvent(event: PointerEvent<SVGPathElement>, view: CanvasView): SizePoint {
  const svg = event.currentTarget.ownerSVGElement;
  if (!svg) return { xM: 0, yM: 0, curveMode: "spline" };
  const point = svgPointFromClient(svg, event.clientX, event.clientY, view);
  const worldPoint = fromCanvas(point.x, point.y, view);
  return { ...worldPoint, xM: Math.abs(worldPoint.xM), curveMode: "spline" };
}

export function svgPointFromClient(svg: SVGSVGElement, clientX: number, clientY: number, view: CanvasView) {
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

export function pathForPoints(points: SizePoint[], view: CanvasView) {
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
    if ((point as SizePoint & { pathBreak?: boolean }).pathBreak) {
      path += ` M ${current.x} ${current.y}`;
      continue;
    }
    const segmentMode = segmentRenderMode(previousPoint, point);
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

export function closedPathForPoints(points: SizePoint[], view: CanvasView) {
  const path = pathForPoints(points, view);
  return path ? `${path} Z` : "";
}

function segmentRenderMode(start: SizePoint, end: SizePoint): "corner" | "spline" {
  if (start.curveMode === "corner" || end.curveMode === "corner") return "corner";
  return start.segmentOutMode ?? end.segmentInMode ?? "corner";
}

export function isClosedShape(points: SizePoint[]) {
  if (points.length < 3) return false;
  const first = points[0];
  const last = points[points.length - 1];
  return distanceBetweenPoints(first, last) <= 0.005 || (Math.abs(first.xM) <= 1e-6 && Math.abs(last.xM) <= 1e-6);
}

export function isFillablePartShape(shape: SizeShape) {
  return shape.role === "part" && shape.points.length >= 3;
}

export function cleanPartDraftPoint(point: SizePoint, preserveXSign = false): SizePoint {
  return {
    xM: preserveXSign ? point.xM : Math.abs(point.xM),
    yM: point.yM,
    curveMode: "corner",
    segmentInMode: "corner",
    segmentOutMode: "corner",
    tangentIn: undefined,
    tangentOut: undefined,
    snapAttachment: point.snapAttachment,
  };
}

export function partShapePointsFromDraft(partType: PartType, points: SizePoint[], preserveXSign = false) {
  if (points.length < 2) return points.map((point) => cleanPartDraftPoint(point, preserveXSign));
  const start = cleanPartDraftPoint(points[0], preserveXSign);
  const end = cleanPartDraftPoint(points[points.length - 1], preserveXSign);
  if (partType === "rotor") return rotorSpanFromDraft(start, end, preserveXSign);
  if (partType === "motor") return motorPointsFromDraft(start, end, preserveXSign);
  return rectanglePointsFromDraft(start, end, preserveXSign);
}

export function motorPointsFromDraft(start: SizePoint, end: SizePoint, preserveXSign = false) {
  return [
    cleanPartDraftPoint(start, preserveXSign),
    cleanPartDraftPoint(end, preserveXSign),
  ];
}

export function motorSpanFromDraft(start: SizePoint, end: SizePoint) {
  return [
    cleanPartDraftPoint(start),
    cleanPartDraftPoint(hvLockedPoint(start, end)),
  ];
}

export function motorBodyPoints(points: SizePoint[]) {
  if (points.length < 2) return points.map((point) => cleanPartDraftPoint(point));
  const [origin, handle] = motorSpanPoints(points);
  if (!origin || !handle) return points.map((point) => cleanPartDraftPoint(point));
  const halfDiameterM = Math.max(Math.abs(handle.xM - origin.xM), 0.005);
  const halfLengthM = Math.max(Math.abs(handle.yM - origin.yM), 0.01);
  return rectanglePointsFromDraft(
    cleanPartDraftPoint({ xM: Math.max(0, origin.xM - halfDiameterM), yM: origin.yM - halfLengthM }),
    cleanPartDraftPoint({ xM: origin.xM + halfDiameterM, yM: origin.yM + halfLengthM }),
  );
}

export function motorSpanPoints(points: SizePoint[]) {
  if (points.length < 2) return points.map((point) => cleanPartDraftPoint(point));
  if (points.length === 2) return points.map((point) => cleanPartDraftPoint(point));
  const bounds = pointBounds(points);
  const centerX = (bounds.minX + bounds.maxX) / 2;
  const centerY = (bounds.minY + bounds.maxY) / 2;
  return [
    cleanPartDraftPoint({ xM: centerX, yM: centerY }),
    cleanPartDraftPoint({ xM: bounds.maxX, yM: bounds.maxY }),
  ];
}

export function motorFootprintPointsFromSpan(points: SizePoint[]) {
  return motorBodyPoints(points);
}

export function motorLengthM(shape: SizeShape) {
  const [origin, handle] = motorSpanPoints(shape.points);
  if (!origin || !handle) return 0.02;
  return Math.max(Math.abs(handle.yM - origin.yM) * 2, 0.02);
}

export function motorDiameterM(shape: SizeShape) {
  const [origin, handle] = motorSpanPoints(shape.points);
  if (!origin || !handle) return 0.01;
  return Math.max(Math.abs(handle.xM - origin.xM) * 2, 0.01);
}

export function motorDepthM(shape: SizeShape) {
  return motorLengthM(shape);
}

export function pointBounds(points: SizePoint[]) {
  const xs = points.map((point) => Math.abs(point.xM));
  const ys = points.map((point) => point.yM);
  if (!xs.length || !ys.length) return { minX: 0, maxX: 0, minY: 0, maxY: 0 };
  return {
    minX: Math.min(...xs),
    maxX: Math.max(...xs),
    minY: Math.min(...ys),
    maxY: Math.max(...ys),
  };
}

export function rotorDiskDiameterM(shape: SizeShape) {
  const span = rotorSpanPoints(shape.points);
  if (span.length < 2) return 0.01;
  return Math.max(distanceBetweenPoints(span[0], span[1]) * 2, 0.01);
}

export function partZHeightM(shape: SizeShape) {
  if (shape.partType === "payload") return rectangularPartFullWidthFromTopView(shape);
  if (shape.partType === "battery") return rectangularPartHeightFromTopView(shape);
  if (shape.partType === "motor") return motorDiameterM(shape);
  if (shape.partType === "rotor") return rotorDiskDiameterM(shape);
  if (shape.partType === "electronics") return rectangularPartHeightFromTopView(shape);
  const bounds = shapeBounds(shape);
  const widthM = Math.max(bounds.maxX - bounds.minX, 0.01);
  const lengthM = Math.max(bounds.maxY - bounds.minY, 0.01);
  return Math.max(Math.min(widthM, lengthM), 0.01);
}

export function cadGeometryForShape(shape: SizeShape, shapes: SizeShape[] = []): SizeCadGeometry | undefined {
  if (shape.role === "body") return cadGeometryForBody(shape, shapes);
  if (shape.role === "liftingSurface") return shape.sketchViewMode === "side" ? undefined : cadGeometryForLiftingSurface(shape, shapes);
  if (shape.role === "part") return cadGeometryForPart(shape, shapes);
  return undefined;
}

export function cadGeometryForPart(shape: SizeShape, shapes: SizeShape[] = []): SizeCadGeometry | undefined {
  const center = topDownShapeCenter(shape);
  const placementZ = shapePlacementZ(shape, shapes);
  if (shape.partType === "motor") {
    const body = motorBodyPoints(shape.points);
    const origin = motorSpanPoints(shape.points)[0];
    if (body.length < 3) return undefined;
    const bounds = pointBounds(body);
    const lengthM = motorLengthM(shape);
    return {
      kind: "cylinder",
      centerM: [origin?.yM ?? (bounds.minY + bounds.maxY) / 2, origin?.xM ?? (bounds.minX + bounds.maxX) / 2, placementZ],
      axisM: [bounds.maxY >= bounds.minY ? 1 : -1, 0, 0],
      radiusM: motorDiameterM(shape) / 2,
      lengthM,
    };
  }
  if (shape.partType === "rotor") {
    const span = rotorSpanPoints(shape.points);
    if (span.length < 2) return undefined;
    const [hub, tip] = span;
    const radiusM = rotorDiskDiameterM(shape) / 2;
    return {
      kind: "rotor",
      centerM: [hub.yM, hub.xM, shapePlacementZ({ ...shape, points: [hub, tip] }, shapes)],
      axisM: normalizedVspAxisFromTopPoints(hub, tip),
      radiusM,
      bladeCount: Math.max(1, Math.round(shape.rotorBladeCount ?? 2)),
      rootChordM: Math.max(radiusM * 2 * 0.055, 0.008),
      tipChordM: Math.max(radiusM * 2 * 0.028, 0.004),
    };
  }
  const bounds = shapeBounds({ ...shape, points: canonicalPartPoints(shape) });
  const centerXM = frontSectionCenterX(shape, shapes);
  const widthM = shapeTouchesMirrorAxis(shape) ? Math.max(bounds.maxX * 2, 0.01) : Math.max(bounds.maxX - bounds.minX, 0.01);
  return {
    kind: "box",
    centerM: [center.yM, centerXM, placementZ],
    sizeM: [
      Math.max(bounds.maxY - bounds.minY, 0.01),
      widthM,
      partZHeightM(shape),
    ],
  };
}

export function cadGeometryForBody(shape: SizeShape, shapes: SizeShape[] = []): SizeCadGeometry | undefined {
  const localMirrorPlane = shapes.find((candidate) => candidate.role === "mirrorPlane" && candidate.id !== shape.id && shapeTouchesMirrorPlane(shape, candidate));
  if (localMirrorPlane) return cadRevolvedBodyAroundPlane(shape, localMirrorPlane, shapes);
  const bounds = shapeBounds(shape);
  const lengthM = Math.max(bounds.maxY - bounds.minY, 0.01);
  const radiusM = Math.max(bounds.maxX, 0.005);
  return {
    kind: "revolvedBody",
    centerM: [(bounds.minY + bounds.maxY) / 2, 0, shapePlacementZ(shape, shapes)],
    axisM: [1, 0, 0],
    lengthM,
    radiusM,
    profile: revolvedProfileAroundYAxis(shape),
  };
}

function cadRevolvedBodyAroundPlane(shape: SizeShape, plane: SizeShape, shapes: SizeShape[] = []): SizeCadGeometry | undefined {
  const [start, end] = plane.points;
  if (!start || !end) return cadGeometryForBody(shape);
  const axisDx = end.yM - start.yM;
  const axisDy = end.xM - start.xM;
  const axisLength = Math.hypot(axisDx, axisDy);
  if (axisLength <= 1e-9) return cadGeometryForBody(shape);
  const axisSign = axisDx < 0 || (Math.abs(axisDx) <= 1e-9 && axisDy < 0) ? -1 : 1;
  const axisXM = (axisDx / axisLength) * axisSign;
  const axisYM = (axisDy / axisLength) * axisSign;
  const axisM: [number, number, number] = [Math.abs(axisXM) <= 1e-12 ? 0 : axisXM, Math.abs(axisYM) <= 1e-12 ? 0 : axisYM, 0];
  const planeZ = effectiveZOffsetM(plane, shapes);
  const placementZ = Math.abs(planeZ) > 1e-6 ? planeZ : shapePlacementZ(shape, shapes);
  const axisStartM: [number, number, number] = [start.yM, start.xM, placementZ];
  const projections = shape.points.map((point) => ((point.yM - start.yM) * axisM[0] + (point.xM - start.xM) * axisM[1]));
  const minProjection = Math.min(...projections);
  const maxProjection = Math.max(...projections);
  const centerProjection = (minProjection + maxProjection) / 2;
  const radiusM = Math.max(...shape.points.map((point) => distancePointToLine(point, start, end)), 0.005);
  return {
    kind: "revolvedBody",
    centerM: [
      axisStartM[0] + axisM[0] * centerProjection,
      axisStartM[1] + axisM[1] * centerProjection,
      placementZ,
    ],
    axisM,
    lengthM: Math.max(maxProjection - minProjection, 0.01),
    radiusM,
    profile: revolvedProfileAroundPlane(shape, plane, axisM),
  };
}

function revolvedProfileAroundYAxis(shape: SizeShape): SizePoint[] {
  return shape.points.map((point) => ({
    xM: Math.abs(point.xM),
    yM: point.yM,
    curveMode: point.curveMode,
    segmentInMode: point.segmentInMode,
    segmentOutMode: point.segmentOutMode,
    tangentIn: point.tangentIn,
    tangentOut: point.tangentOut,
  }));
}

function revolvedProfileAroundPlane(shape: SizeShape, plane: SizeShape, axisM: [number, number, number]): SizePoint[] {
  const [start, end] = plane.points;
  if (!start || !end) return revolvedProfileAroundYAxis(shape);
  return shape.points.map((point) => ({
    xM: distancePointToLine(point, start, end),
    yM: start.yM + ((point.yM - start.yM) * axisM[0] + (point.xM - start.xM) * axisM[1]) * axisM[0],
    curveMode: point.curveMode,
    segmentInMode: point.segmentInMode,
    segmentOutMode: point.segmentOutMode,
    tangentIn: point.tangentIn,
    tangentOut: point.tangentOut,
  }));
}

export function cadGeometryForLiftingSurface(shape: SizeShape, shapes: SizeShape[] = []): SizeCadGeometry | undefined {
  const bounds = shapeBounds(shape);
  const spanM = Math.max(bounds.maxX * 2, 0.05);
  const rootChordM = Math.max(chordLengthAtX(shape.points, 0), bounds.maxY - bounds.minY, 0.05);
  const tipChordM = Math.max(chordLengthAtX(shape.points, bounds.maxX), rootChordM, 0.05);
  const rootZ = liftingSurfaceCenterZAtX(shape, shapes, 0);
  return {
    kind: "liftingSurface",
    rootLeadingEdgeM: [bounds.maxY, 0, rootZ],
    spanM,
    rootChordM,
    tipChordM,
    airfoil: shape.airfoilStations?.root ?? shape.airfoil ?? "NACA 0012",
    incidenceDeg: shape.incidenceStationsDeg?.root ?? shape.incidenceDeg ?? 0,
  };
}

export function normalizedVspAxisFromTopPoints(start: SizePoint, end: SizePoint): [number, number, number] {
  const x = end.yM - start.yM;
  const y = end.xM - start.xM;
  const length = Math.hypot(x, y);
  if (length <= 1e-9) return [1, 0, 0];
  return [x / length, y / length, 0];
}

export function rectangularPartHeightFromTopView(shape: SizeShape) {
  const bounds = shapeBounds(shape);
  return Math.max(bounds.maxX - bounds.minX, 0.01);
}

export function rectangularPartFullWidthFromTopView(shape: SizeShape) {
  const bounds = shapeBounds(shape);
  return shapeTouchesMirrorAxis(shape) ? Math.max(bounds.maxX * 2, 0.01) : Math.max(bounds.maxX - bounds.minX, 0.01);
}

export function rectanglePointsFromDraft(start: SizePoint, end: SizePoint, preserveXSign = false) {
  if (Math.abs(end.xM - start.xM) < 0.001 || Math.abs(end.yM - start.yM) < 0.001) return [start, end];
  return [
    cleanPartDraftPoint(start, preserveXSign),
    cleanPartDraftPoint({ xM: end.xM, yM: start.yM }, preserveXSign),
    cleanPartDraftPoint(end, preserveXSign),
    cleanPartDraftPoint({ xM: start.xM, yM: end.yM }, preserveXSign),
  ];
}

export function squarePointsFromDraft(start: SizePoint, end: SizePoint) {
  const dx = end.xM - start.xM;
  const dy = end.yM - start.yM;
  const side = Math.max(Math.abs(dx), Math.abs(dy), 0.01);
  const nextEnd = {
    ...end,
    xM: Math.max(0, start.xM + Math.sign(dx || 1) * side),
    yM: start.yM + Math.sign(dy || 1) * side,
  };
  return rectanglePointsFromDraft(start, cleanPartDraftPoint(nextEnd));
}

export function canonicalPartPoints(shape: SizeShape) {
  if (shape.role !== "part") return shape.points;
  if (shape.partType === "rotor") return rotorSpanPoints(shape.points);
  if (shape.partType === "motor") return motorSpanPoints(shape.points);
  if (shape.points.length < 2) return shape.points.map((point) => cleanPartDraftPoint(point));
  const bounds = shapeBounds(shape);
  const start = cleanPartDraftPoint({ xM: bounds.minX, yM: bounds.minY });
  const end = cleanPartDraftPoint({ xM: bounds.maxX, yM: bounds.maxY });
  if (shape.partType === "battery" || shape.partType === "payload") return rectanglePointsFromDraft(start, end);
  return shape.points.map((point) => cleanPartDraftPoint(point));
}

export function moveConstrainedPartPoint(shape: SizeShape, pointIndex: number, target: SizePoint) {
  if (shape.partType === "rotor") return moveRotorEndpoint(shape.points, pointIndex, target);
  if (shape.partType === "motor") return updateMotorPoint(shape.points, pointIndex, target);
  if (shape.partType !== "battery" && shape.partType !== "payload") {
    return shape.points.map((point, index) => (index === pointIndex ? cleanPartDraftPoint(target) : point));
  }
  const points = canonicalPartPoints(shape);
  if (points.length < 4) return partShapePointsFromDraft(shape.partType, [points[0] ?? target, target]);
  const opposite = points[(pointIndex + 2) % 4] ?? points[0];
  const start = cleanPartDraftPoint(opposite);
  const end = cleanPartDraftPoint(target);
  const rectangle = rectanglePointsFromDraft(start, end);
  const indexMap = [2, 3, 0, 1];
  return indexMap.map((index) => rectangle[index] ?? rectangle[0]).filter(Boolean);
}

export function rotorSpanFromDraft(start: SizePoint, end: SizePoint, preserveXSign = false) {
  const span = Math.max(Math.abs(end.xM - start.xM), 0.01);
  const endX = end.xM >= start.xM ? start.xM + span : preserveXSign ? start.xM - span : Math.max(0, start.xM - span);
  return [
    cleanPartDraftPoint(start, preserveXSign),
    cleanPartDraftPoint({ xM: endX, yM: start.yM }, preserveXSign),
  ];
}

export function rotorSpanPoints(points: SizePoint[]) {
  if (points.length < 2) return points.map((point) => cleanPartDraftPoint(point));
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

export function rotorFlarePointsFromSpan(points: SizePoint[]) {
  const span = rotorSpanPoints(points);
  if (span.length < 2) return span;
  return rotorFlarePointsFromDraft(span[0], span[1]);
}

export function rotorFlarePointsFromDraft(start: SizePoint, end: SizePoint) {
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
  const point = (xM: number, yM: number): SizePoint => ({
    xM,
    yM,
    curveMode: "corner",
    segmentInMode: "corner",
    segmentOutMode: "corner",
  });
  const addOffset = (base: SizePoint | { xM: number; yM: number }, halfWidth: number, side: 1 | -1) =>
    point(base.xM + px * halfWidth * side, base.yM + py * halfWidth * side);
  const bladeSide = (direction: 1 | -1) => {
    const rootCenter = { xM: start.xM + ux * rootInset * direction, yM: start.yM + uy * rootInset * direction };
    const mid = { xM: start.xM + dx * 0.58 * direction, yM: start.yM + dy * 0.58 * direction };
    const tip = { xM: start.xM + dx * direction, yM: start.yM + dy * direction };
    return [
      addOffset(rootCenter, rootHalfWidth, direction),
      addOffset(mid, midHalfWidth, direction),
      addOffset(tip, tipHalfWidth, direction),
      addOffset(tip, tipHalfWidth, -direction as 1 | -1),
      addOffset(mid, midHalfWidth, -direction as 1 | -1),
      addOffset(rootCenter, rootHalfWidth, -direction as 1 | -1),
    ];
  };
  const forwardBlade = bladeSide(1);
  const aftBlade = bladeSide(-1);
  return [...forwardBlade, ...aftBlade, forwardBlade[0]];
}

export function moveRotorEndpoint(points: SizePoint[], index: number, target: SizePoint) {
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

export function updateShapePointForJoin(shape: SizeShape, pointIndex: number, joinedPoint: SizePoint): SizeShape {
  if (shape.partType === "rotor") {
    const points = moveRotorEndpoint(shape.points, pointIndex, joinedPoint).map((point, index) =>
      index === pointIndex ? { ...point, snapAttachment: joinedPoint.snapAttachment } : point,
    );
    return { ...shape, points };
  }
  if (shape.partType === "motor") {
    return { ...shape, points: updateMotorPoint(shape.points, pointIndex, joinedPoint) };
  }
  return {
    ...shape,
    points: shape.points.map((point, index) => (index === pointIndex ? { ...point, ...joinedPoint } : point)),
  };
}

export function motorLockPointIndices(shape: SizeShape) {
  return [1].filter((index) => index < motorBodyPoints(shape.points).length);
}

export function updateMotorPoint(points: SizePoint[], pointIndex: number, target: SizePoint) {
  const controls = motorSpanPoints(points);
  if (controls.length < 2) return points.map((point, index) => (index === pointIndex ? cleanPartDraftPoint(target) : point));
  const origin = controls[0];
  const handle = controls[1];
  if (!origin || !handle) return controls;
  if (pointIndex === 0) {
    const nextOrigin = cleanPartDraftPoint(target);
    const dx = nextOrigin.xM - origin.xM;
    const dy = nextOrigin.yM - origin.yM;
    return [
      nextOrigin,
      cleanPartDraftPoint({ ...handle, xM: Math.max(0, handle.xM + dx), yM: handle.yM + dy }),
    ];
  }
  return [
    origin,
    cleanPartDraftPoint({
      ...target,
      xM: Math.max(origin.xM + 0.005, Math.abs(target.xM)),
      snapAttachment: target.snapAttachment,
    }),
  ];
}

export function hvLockedPoint(anchor: SizePoint, target: SizePoint) {
  const dx = target.xM - anchor.xM;
  const dy = target.yM - anchor.yM;
  return Math.abs(dx) >= Math.abs(dy)
    ? { ...target, yM: anchor.yM }
    : { ...target, xM: Math.abs(anchor.xM) };
}

export function tangentCanvasPoint(point: SizePoint, side: "in" | "out", points: SizePoint[], index: number, view: CanvasView) {
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

export function halfMoonPath(side: "in" | "out") {
  const radius = 6;
  const sweep = side === "in" ? 0 : 1;
  const x1 = 0;
  const y1 = -radius;
  const x2 = 0;
  const y2 = radius;
  return `M ${x1} ${y1} A ${radius} ${radius} 0 0 ${sweep} ${x2} ${y2} L ${x1} ${y1} Z`;
}

export function mirrorPoints(points: SizePoint[]) {
  return points.map((point) => ({
    ...point,
    xM: -point.xM,
    tangentIn: point.tangentIn ? { ...point.tangentIn, xM: -point.tangentIn.xM } : undefined,
    tangentOut: point.tangentOut ? { ...point.tangentOut, xM: -point.tangentOut.xM } : undefined,
  }));
}

export function flattenPointForFrontView(point: SizePoint, progress = 1): SizePoint {
  return {
    ...point,
    yM: lerp(point.yM, 0, progress),
    tangentIn: point.tangentIn ? { ...point.tangentIn, yM: lerp(point.tangentIn.yM, 0, progress) } : undefined,
    tangentOut: point.tangentOut ? { ...point.tangentOut, yM: lerp(point.tangentOut.yM, 0, progress) } : undefined,
  };
}

export function flattenShapeForFrontView(shape: SizeShape, progress = 1): SizeShape {
  return {
    ...shape,
    points: shape.points.map((point) => flattenPointForFrontView(point, progress)),
  };
}

export function projectedShape(shape: SizeShape, progress: number, shapes: SizeShape[], viewMode: CanvasViewMode): SizeShape {
  if (shape.sketchViewMode === viewMode) return shape;
  const t = clamp(progress, 0, 1);
  const finalShape =
    viewMode === "side"
      ? sideProjectionShapeFinal(shape, shapes)
      : frontProjectionShape(shape, 1, shapes);
  if (t >= 1) return finalShape;
  return {
    ...finalShape,
    points: morphProjectedPoints(shape, finalShape.points, t, shapes, viewMode),
  };
}

export function sideProjectionShapeFinal(shape: SizeShape, shapes: SizeShape[]): SizeShape {
  if (!referenceRoles.includes(shape.role)) return projectCadGeometryShape(shape, shapes, "side");
  const zOffsetM = effectiveZOffsetM(shape, shapes);
  if ((shape.sketchViewMode ?? "top") === "top" && Math.abs(zOffsetM) > 1e-6) {
    return {
      ...shape,
      points: shape.points.map((point) => ({
        ...point,
        xM: zOffsetM,
        yM: point.yM,
        tangentIn: undefined,
        tangentOut: undefined,
      })),
    };
  }
  const frame = sideProjectionFrame(shapes);
  return flattenShapeForSideView(shape, 1, frame);
}

export function topProjectionShape(shape: SizeShape, shapes: SizeShape[]): SizeShape {
  if (shape.sketchViewMode !== "side" || !referenceRoles.includes(shape.role)) return shape;
  const stationX = sideViewStationX(shape, shapes) ?? 0;
  return {
    ...shape,
    points: shape.points.map((point) => ({
      ...point,
      xM: stationX,
      yM: point.yM,
      tangentIn: undefined,
      tangentOut: undefined,
    })),
  };
}

export function topViewReferenceLine3DPoints(shape: SizeShape, shapes: SizeShape[]) {
  const stationX = verticalReferenceX(shape);
  const zOffset = effectiveZOffsetM(shape, shapes);
  return shape.points.map((point) => ({
    xM: stationX ?? point.xM,
    yM: point.yM,
    zM: zOffset,
  }));
}

export function liftingSurfaceCenterZAtX(shape: SizeShape, shapes: SizeShape[], xM: number) {
  const stations = liftingSurfaceZStations(shape, shapes);
  if (!stations.length) return effectiveZOffsetM(shape, shapes);
  if (stations.length === 1) return stations[0].zM;
  const sorted = [...stations].sort((a, b) => a.xM - b.xM);
  if (xM <= sorted[0].xM) return sorted[0].zM;
  for (let index = 1; index < sorted.length; index += 1) {
    const previous = sorted[index - 1];
    const current = sorted[index];
    if (xM <= current.xM) {
      const t = (xM - previous.xM) / Math.max(current.xM - previous.xM, 1e-6);
      return lerp(previous.zM, current.zM, clamp(t, 0, 1));
    }
  }
  return sorted[sorted.length - 1].zM;
}

export function liftingSurfaceZStations(shape: SizeShape, shapes: SizeShape[]) {
  const baseZ = shapeBaseZ(shape, shapes);
  const stationMap = new Map<number, { count: number; totalZ: number; xM: number }>();
  for (const point of shape.points) {
    const xM = Math.abs(point.xM);
    const key = Math.round(xM * 10000);
    const current = stationMap.get(key) ?? { count: 0, totalZ: 0, xM };
    current.count += 1;
    current.totalZ += pointAttachmentZ(point, shapes, baseZ);
    stationMap.set(key, current);
  }
  return [...stationMap.values()]
    .map((station) => ({ xM: station.xM, zM: station.totalZ / Math.max(station.count, 1) }))
    .sort((a, b) => a.xM - b.xM);
}

export function shapePlacementZ(shape: SizeShape, shapes: SizeShape[]) {
  const baseZ = shapeBaseZ(shape, shapes);
  const attachedZs = shape.points
    .map((point) => pointAttachmentZ(point, shapes, baseZ))
    .filter((zM, index) => Boolean(shape.points[index]?.snapAttachment) && Number.isFinite(zM));
  if (!attachedZs.length) return baseZ;
  return attachedZs.reduce((total, zM) => total + zM, 0) / attachedZs.length;
}

export function shapeBaseZ(shape: SizeShape, shapes: SizeShape[]) {
  if (shape.zStationId) return effectiveZOffsetM(shape, shapes);
  const touchedMirror = shapes.find(
    (candidate) => candidate.role === "mirrorPlane" && candidate.id !== shape.id && shapeTouchesMirrorPlane(shape, candidate),
  );
  return touchedMirror ? effectiveZOffsetM(touchedMirror, shapes) : 0;
}

function pointAttachmentZ(point: SizePoint, shapes: SizeShape[], fallbackZ: number) {
  const attachment = point.snapAttachment;
  if (!attachment) return fallbackZ;
  if (isImplicitMirrorShapeId(attachment.shapeId)) return 0;
  const sourceShape = shapes.find((shape) => shape.id === attachment.shapeId);
  if (!sourceShape || !referenceRoles.includes(sourceShape.role)) return fallbackZ;
  if (sourceShape.sketchViewMode === "side") {
    if (attachment.kind === "node") {
      const sourcePoint = sourceShape.points[attachment.pointIndex];
      return sourcePoint ? sourcePoint.xM + effectiveZOffsetM(sourceShape, shapes) : fallbackZ;
    }
    const start = sourceShape.points[attachment.segmentIndex];
    const end = sourceShape.points[attachment.segmentIndex + 1];
    if (!start || !end) return fallbackZ;
    return lerp(start.xM, end.xM, clamp(attachment.t, 0, 1)) + effectiveZOffsetM(sourceShape, shapes);
  }
  return effectiveZOffsetM(sourceShape, shapes);
}

export function zStationOffsetM(shape: SizeShape, shapes: SizeShape[]) {
  if (!shape.zStationId) return undefined;
  const station = shapes.find((candidate) => candidate.id === shape.zStationId);
  return station ? verticalReferenceX(station) : undefined;
}

export function effectiveZOffsetM(shape: SizeShape, shapes: SizeShape[]) {
  return zStationOffsetM(shape, shapes) ?? 0;
}

export function morphProjectedPoints(
  sourceShape: SizeShape,
  finalPoints: SizePoint[],
  progress: number,
  shapes: SizeShape[],
  viewMode: CanvasViewMode,
) {
  if (!finalPoints.length) return finalPoints;
  const sourcePoints = projectionSourcePoints(sourceShape);
  if (!sourcePoints.length) return finalPoints;
  const frame = viewMode === "side" ? sideProjectionFrame(shapes) : undefined;
  const collapseT = smootherStep(clamp(progress / sideCollapseProgress, 0, 1));
  const expandT = smootherStep(clamp((progress - sideCollapseProgress * 0.45) / (1 - sideCollapseProgress * 0.45), 0, 1));

  return finalPoints.map((finalPoint, index) => {
    const sourcePoint = sourcePointAtProjectionIndex(sourcePoints, index, finalPoints.length);
    if (viewMode === "side" && frame) {
      const sourceY = (sourcePoint.yM - frame.baselineY) * frame.longitudinalSign;
      const collapsedX = lerp(sourcePoint.xM, 0, collapseT);
      return {
        ...finalPoint,
        xM: lerp(collapsedX, finalPoint.xM, expandT),
        yM: lerp(sourceY, finalPoint.yM, progress),
        tangentIn: undefined,
        tangentOut: undefined,
      };
    }
    return {
      ...finalPoint,
      xM: lerp(sourcePoint.xM, finalPoint.xM, progress),
      yM: lerp(sourcePoint.yM, finalPoint.yM, progress),
      tangentIn: undefined,
      tangentOut: undefined,
    };
  });
}

export function projectionSourcePoints(shape: SizeShape) {
  if (shape.role === "part") {
    if (shape.partType === "motor") return motorFootprintPointsFromSpan(shape.points);
    if (shape.partType === "rotor") return rotorFlarePointsFromSpan(shape.points);
    return canonicalPartPoints(shape);
  }
  return shape.points;
}

export function sourcePointAtProjectionIndex(points: SizePoint[], index: number, targetLength: number) {
  if (!points.length) return { xM: 0, yM: 0 };
  if (points.length === 1 || targetLength <= 1) return points[0];
  const sourceIndex = Math.round((index / (targetLength - 1)) * (points.length - 1));
  return points[clamp(sourceIndex, 0, points.length - 1)] ?? points[0];
}

export function smootherStep(value: number) {
  const t = clamp(value, 0, 1);
  return t * t * t * (t * (t * 6 - 15) + 10);
}

export function frontProjectionShape(shape: SizeShape, progress: number, shapes: SizeShape[]): SizeShape {
  if (shape.sketchViewMode === "side") return sideAuthoredFrontProjection(shape, shapes);
  if (shape.role === "referenceLine") return topAuthoredReferenceFrontProjection(shape, progress, shapes);
  if (shape.role === "liftingSurface" && (shape.liftingSurfaceKind ?? "wing") === "wing" && liftingSurfaceHasDihedral(shape, shapes)) {
    return { ...shape, points: dihedralWingFrontSection(shape, shapes, progress) };
  }
  if (!referenceRoles.includes(shape.role) && progress >= 1) return projectCadGeometryShape(shape, shapes, "front");
  return applyFrontZOffset(flattenShapeForFrontView(shape, progress), effectiveZOffsetM(shape, shapes));
}

function topAuthoredReferenceFrontProjection(shape: SizeShape, progress: number, shapes: SizeShape[]): SizeShape {
  const stationX = verticalReferenceX(shape);
  if (stationX === undefined) return applyFrontZOffset(flattenShapeForFrontView(shape, progress), effectiveZOffsetM(shape, shapes));
  const zOffsetM = effectiveZOffsetM(shape, shapes);
  const projectedPoint = { xM: stationX, yM: zOffsetM, curveMode: "corner" as const, segmentInMode: "corner" as const, segmentOutMode: "corner" as const };
  return {
    ...shape,
    points: shape.points.map(() => ({ ...projectedPoint })),
  };
}

function sideAuthoredFrontProjection(shape: SizeShape, shapes: SizeShape[]): SizeShape {
  const revolvedProjection = sideAuthoredRevolvedFrontProjection(shape, shapes);
  if (revolvedProjection) return revolvedProjection;

  const stationX = Math.max(0, sideAuthoredStationX(shape, shapes) ?? 0);
  const zOffsetM = effectiveZOffsetM(shape, shapes);
  const sideHeights = shape.points.map((point) => point.xM);
  let minHeightM = sideHeights.length ? Math.min(...sideHeights) : -0.05;
  let maxHeightM = sideHeights.length ? Math.max(...sideHeights) : 0.05;
  if (Math.abs(maxHeightM - minHeightM) < 0.01) {
    minHeightM -= 0.05;
    maxHeightM += 0.05;
  }
  if (shape.role === "mirrorPlane") {
    return {
      ...shape,
      points: shape.points.map((point) => ({
        ...point,
        xM: stationX,
        yM: point.xM + zOffsetM,
        tangentIn: undefined,
        tangentOut: undefined,
      })),
    };
  }
  if (shape.role === "referenceLine") {
    const sideHeight = (shape.points.length
      ? shape.points.reduce((total, point) => total + point.xM, 0) / shape.points.length
      : 0) + zOffsetM;
    return {
      ...shape,
      points: [
        { xM: stationX, yM: sideHeight, curveMode: "corner", segmentInMode: "corner", segmentOutMode: "corner" },
        { xM: stationX, yM: sideHeight, curveMode: "corner", segmentInMode: "corner", segmentOutMode: "corner" },
      ],
    };
  }
  const halfVisibleThicknessM = Math.max((shape.bodyThicknessMm ?? 1.2) / 1000, 0.006);
  const minX = Math.max(0, stationX - halfVisibleThicknessM);
  const maxX = stationX + halfVisibleThicknessM;
  return {
    ...shape,
    points: [
      { xM: minX, yM: minHeightM + zOffsetM, curveMode: "corner", segmentInMode: "corner", segmentOutMode: "corner" },
      { xM: maxX, yM: minHeightM + zOffsetM, curveMode: "corner", segmentInMode: "corner", segmentOutMode: "corner" },
      { xM: maxX, yM: maxHeightM + zOffsetM, curveMode: "corner", segmentInMode: "corner", segmentOutMode: "corner" },
      { xM: minX, yM: maxHeightM + zOffsetM, curveMode: "corner", segmentInMode: "corner", segmentOutMode: "corner" },
      { xM: minX, yM: minHeightM + zOffsetM, curveMode: "corner", segmentInMode: "corner", segmentOutMode: "corner" },
    ],
  };
}

function sideAuthoredRevolvedFrontProjection(shape: SizeShape, shapes: SizeShape[]): SizeShape | undefined {
  if (referenceRoles.includes(shape.role) || shape.points.length < 3) return undefined;
  const mirrorPlane = touchedSideMirrorPlane(shape, shapes);
  if (!mirrorPlane?.points[0] || !mirrorPlane.points[1]) return undefined;
  const stationX = Math.max(0, sideAuthoredStationX(shape, shapes, mirrorPlane) ?? 0);
  const axis = projectionAxisForLine(mirrorPlane);
  if (!axis) return undefined;
  const radiusM = Math.max(
    ...shape.points.map((point) => distanceFromPointToProjectionAxis(point, axis)),
    0.006,
  );
  const zOffsetM = effectiveZOffsetM(mirrorPlane, shapes);
  const axisZs = mirrorPlane.points.map((point) => point.xM + zOffsetM);
  const minAxisZ = Math.min(...axisZs);
  const maxAxisZ = Math.max(...axisZs);
  const centerZ = (minAxisZ + maxAxisZ) / 2;
  const points = Math.abs(maxAxisZ - minAxisZ) <= 0.002
    ? circularFrontSection(shape, 1, radiusM, stationX).map((point) => ({ ...point, yM: point.yM + centerZ }))
    : verticalCapsuleFrontSection(stationX, minAxisZ, maxAxisZ, radiusM);
  return {
    ...shape,
    points,
  };
}

function sideAuthoredStationX(shape: SizeShape, shapes: SizeShape[], touchedMirrorPlane = touchedSideMirrorPlane(shape, shapes)) {
  return (touchedMirrorPlane ? sideViewStationX(touchedMirrorPlane, shapes) : undefined)
    ?? sideViewStationX(shape, shapes)
    ?? inheritedSideViewStationX(shape, shapes);
}

function touchedSideMirrorPlane(shape: SizeShape, shapes: SizeShape[]) {
  return shapes.find(
    (candidate) =>
      candidate.sketchViewMode === "side" &&
      candidate.role === "mirrorPlane" &&
      candidate.id !== shape.id &&
      shapeTouchesMirrorPlane(shape, candidate),
  );
}

function verticalCapsuleFrontSection(centerX: number, minZ: number, maxZ: number, radiusM: number): SizePoint[] {
  const points: SizePoint[] = [];
  const topZ = Math.max(minZ, maxZ);
  const bottomZ = Math.min(minZ, maxZ);
  const leftX = Math.max(0, centerX - radiusM);
  const rightX = centerX + radiusM;
  const samples = 18;
  for (let index = 0; index <= samples; index += 1) {
    const theta = Math.PI + (Math.PI * index) / samples;
    points.push({
      xM: Math.max(0, centerX + Math.cos(theta) * radiusM),
      yM: topZ + Math.sin(theta) * radiusM,
      curveMode: "corner",
      segmentInMode: "corner",
      segmentOutMode: "corner",
    });
  }
  points.push({ xM: rightX, yM: bottomZ, curveMode: "corner", segmentInMode: "corner", segmentOutMode: "corner" });
  for (let index = 0; index <= samples; index += 1) {
    const theta = (Math.PI * index) / samples;
    points.push({
      xM: Math.max(0, centerX + Math.cos(theta) * radiusM),
      yM: bottomZ + Math.sin(theta) * radiusM,
      curveMode: "corner",
      segmentInMode: "corner",
      segmentOutMode: "corner",
    });
  }
  points.push({ xM: leftX, yM: topZ, curveMode: "corner", segmentInMode: "corner", segmentOutMode: "corner" });
  points.push(points[0]);
  return points;
}

function inheritedSideViewStationX(shape: SizeShape, shapes: SizeShape[]) {
  if (shape.sketchViewMode !== "side" || !referenceRoles.includes(shape.role)) return undefined;
  const attachedSideShape = shapes.find(
    (candidate) =>
      candidate.id !== shape.id &&
      candidate.sketchViewMode === "side" &&
      !referenceRoles.includes(candidate.role) &&
      candidate.sideViewStationId &&
      shapeTouchesMirrorPlane(candidate, shape),
  );
  return attachedSideShape ? sideViewStationX(attachedSideShape, shapes) : undefined;
}

export function projectCadGeometryShape(shape: SizeShape, shapes: SizeShape[], viewMode: "front" | "side"): SizeShape {
  const geometry = cadGeometryForShape(shape, shapes);
  if (!geometry) return { ...shape, points: [] };
  if (shape.role === "liftingSurface" && shape.liftingSurfaceKind === "lex") return projectFlatLexShape(shape, shapes, viewMode);
  if (geometry.kind === "box") return withProjectedPoints(shape, projectBoxCadGeometry(shape, geometry, viewMode), viewMode);
  if (geometry.kind === "revolvedBody") return withProjectedPoints(shape, projectRevolvedBodyCadGeometry(shape, geometry, viewMode), viewMode);
  if (geometry.kind === "liftingSurface") return withProjectedPoints(shape, projectLiftingSurfaceCadGeometry(shape, geometry, viewMode), viewMode);
  if (geometry.kind === "cylinder" && shape.partType === "motor") {
    return viewMode === "front"
      ? withProjectedPoints(shape, applyPointZOffset(circularFrontSection(shape, 1, geometry.radiusM, Math.max(0, geometry.centerM[1])), geometry.centerM[2]), viewMode)
      : withProjectedPoints(shape, rectangularSideSectionFromCad(geometry.centerM[0], geometry.lengthM, geometry.radiusM * 2, 1, sideProjectionFrame(shapes), geometry.centerM[2]), viewMode);
  }
  if (geometry.kind === "rotor" && shape.partType === "rotor") {
    return viewMode === "front"
      ? withProjectedPoints(shape, applyPointZOffset(circularFrontSection(shape, 1, geometry.radiusM, Math.max(0, geometry.centerM[1])), geometry.centerM[2]), viewMode)
      : withProjectedPoints(shape, applyPointXOffset(rotorSideSection({ ...shape, points: canonicalPartPoints(shape) }, 1, shapes, sideProjectionFrame(shapes)), geometry.centerM[2]), viewMode);
  }
  return { ...shape, points: [] };
}

function projectFlatLexShape(shape: SizeShape, shapes: SizeShape[], viewMode: "front" | "side"): SizeShape {
  const zOffsetM = effectiveZOffsetM(shape, shapes);
  return {
    ...shape,
    points: shape.points.map((point) => ({
      ...point,
      xM: viewMode === "front" ? Math.abs(point.xM) : 0,
      yM: viewMode === "front" ? zOffsetM : point.yM,
      tangentIn: undefined,
      tangentOut: undefined,
    })),
  };
}

function withProjectedPoints(shape: SizeShape, points: SizePoint[], viewMode: "front" | "side"): SizeShape {
  return {
    ...shape,
    points,
  };
}

function applyFrontZOffset(shape: SizeShape, zOffsetM = 0): SizeShape {
  if (!zOffsetM) return shape;
  return {
    ...shape,
    points: shape.points.map((point) => ({ ...point, yM: point.yM + zOffsetM })),
  };
}

function applyPointZOffset(points: SizePoint[], zOffsetM = 0) {
  if (!zOffsetM) return points;
  return points.map((point) => ({ ...point, yM: point.yM + zOffsetM }));
}

function applyPointXOffset(points: SizePoint[], zOffsetM = 0) {
  if (!zOffsetM) return points;
  return points.map((point) => ({ ...point, xM: point.xM + zOffsetM }));
}

function projectBoxCadGeometry(shape: SizeShape, geometry: Extract<SizeCadGeometry, { kind: "box" }>, viewMode: "front" | "side") {
  if (viewMode === "side") {
    return rectangularSideSectionFromCad(geometry.centerM[0], geometry.sizeM[0], geometry.sizeM[2], 1, sideProjectionFrame([]), geometry.centerM[2]);
  }
  const fullWidthM = Math.max(geometry.sizeM[1], 0.01);
  const halfHeightM = Math.max(geometry.sizeM[2] / 2, 0.004);
  const centerX = Math.max(0, geometry.centerM[1]);
  const minX = shapeTouchesMirrorAxis(shape) ? 0 : Math.max(0, centerX - fullWidthM / 2);
  const maxX = shapeTouchesMirrorAxis(shape) ? fullWidthM / 2 : centerX + fullWidthM / 2;
  return [
    { xM: minX, yM: geometry.centerM[2] + halfHeightM, curveMode: "corner" as const },
    { xM: maxX, yM: geometry.centerM[2] + halfHeightM, curveMode: "corner" as const },
    { xM: maxX, yM: geometry.centerM[2] - halfHeightM, curveMode: "corner" as const },
    { xM: minX, yM: geometry.centerM[2] - halfHeightM, curveMode: "corner" as const },
    { xM: minX, yM: geometry.centerM[2] + halfHeightM, curveMode: "corner" as const },
  ];
}

function projectRevolvedBodyCadGeometry(shape: SizeShape, geometry: Extract<SizeCadGeometry, { kind: "revolvedBody" }>, viewMode: "front" | "side") {
  if (viewMode === "side") {
    return revolvedBodySideProfileFromCad(geometry);
  }
  return applyPointZOffset(circularFrontSection(shape, 1, geometry.radiusM, Math.max(0, geometry.centerM[1])), geometry.centerM[2]);
}

function revolvedBodySideProfileFromCad(geometry: Extract<SizeCadGeometry, { kind: "revolvedBody" }>) {
  const profile = geometry.profile?.length ? geometry.profile : [
    { xM: geometry.radiusM, yM: geometry.centerM[0] - geometry.lengthM / 2 },
    { xM: geometry.radiusM, yM: geometry.centerM[0] + geometry.lengthM / 2 },
  ];
  const upper = profile.map((point) => sideProfilePoint(point, geometry.centerM[2], 1));
  const lower = [...profile].reverse().map((point) => sideProfilePoint(point, geometry.centerM[2], -1, true));
  return [...upper, ...lower, upper[0]];
}

function sideProfilePoint(point: SizePoint, centerZ: number, xSign: 1 | -1, reverseSegmentDirection = false): SizePoint {
  const transformTangent = (vector: SizePoint | undefined) => vector
    ? { ...vector, xM: vector.xM * xSign }
    : undefined;
  return {
    ...point,
    xM: centerZ + Math.max(point.xM, 0) * xSign,
    yM: point.yM,
    segmentInMode: reverseSegmentDirection ? point.segmentOutMode : point.segmentInMode,
    segmentOutMode: reverseSegmentDirection ? point.segmentInMode : point.segmentOutMode,
    tangentIn: transformTangent(reverseSegmentDirection ? point.tangentOut : point.tangentIn),
    tangentOut: transformTangent(reverseSegmentDirection ? point.tangentIn : point.tangentOut),
  };
}

function projectLiftingSurfaceCadGeometry(shape: SizeShape, geometry: Extract<SizeCadGeometry, { kind: "liftingSurface" }>, viewMode: "front" | "side") {
  if (viewMode === "front") {
    const halfSpanM = Math.max(geometry.spanM / 2, 0.025);
    const rootX = shapeTouchesMirrorAxis(shape) ? 0 : Math.max(0, geometry.rootLeadingEdgeM[1]);
    const tipX = rootX + halfSpanM;
    const rootHalfHeightM = Math.max(geometry.rootChordM * airfoilThicknessRatio(geometry.airfoil) / 2, 0.003);
    const tipHalfHeightM = Math.max(geometry.tipChordM * airfoilThicknessRatio(geometry.airfoil) / 2, 0.003);
    const top: SizePoint[] = [];
    const bottom: SizePoint[] = [];
    for (let index = 0; index <= 18; index += 1) {
      const t = index / 18;
      const xM = lerp(rootX, tipX, t);
      const halfHeightM = lerp(rootHalfHeightM, tipHalfHeightM, t);
      top.push({ xM, yM: geometry.rootLeadingEdgeM[2] + halfHeightM, curveMode: "corner", segmentInMode: "corner", segmentOutMode: "corner" });
      bottom.unshift({ xM, yM: geometry.rootLeadingEdgeM[2] - halfHeightM, curveMode: "corner", segmentInMode: "corner", segmentOutMode: "corner" });
    }
    return [...top, ...bottom, top[0]];
  }
  const frame = sideProjectionFrame([]);
  const root = airfoilSideSection(geometry.rootLeadingEdgeM[0], -geometry.rootChordM, geometry.airfoil, 1, frame, geometry.incidenceDeg, false);
  const tip = airfoilSideSection(geometry.rootLeadingEdgeM[0], -geometry.tipChordM, geometry.airfoil, 1, frame, geometry.incidenceDeg, true);
  return applyPointXOffset([...root, ...tip], geometry.rootLeadingEdgeM[2]);
}

function rectangularSideSectionFromCad(centerY: number, lengthM: number, heightM: number, progress: number, frame: SideProjectionFrame, centerZ = 0) {
  const halfLengthM = Math.max(lengthM / 2, 0.005);
  const halfHeightM = Math.max(heightM / 2, 0.003);
  return [
    sideProjectedPoint(centerY - halfLengthM, centerZ - halfHeightM, progress, frame),
    sideProjectedPoint(centerY + halfLengthM, centerZ - halfHeightM, progress, frame),
    sideProjectedPoint(centerY + halfLengthM, centerZ + halfHeightM, progress, frame),
    sideProjectedPoint(centerY - halfLengthM, centerZ + halfHeightM, progress, frame),
    sideProjectedPoint(centerY - halfLengthM, centerZ - halfHeightM, progress, frame),
  ];
}

export function sideProjectionShape(shape: SizeShape, progress: number, shapes: SizeShape[]): SizeShape {
  const frame = sideProjectionFrame(shapes);
  if (progress < sideCollapseProgress) return collapseShapeToSideAxis(shape, progress / sideCollapseProgress, frame);

  if (!referenceRoles.includes(shape.role)) return projectCadGeometryShape(shape, shapes, "side");
  return flattenShapeForSideView(shape, 1, frame);
}

export function sideProjectionFrame(shapes: SizeShape[]): SideProjectionFrame {
  return {
    baselineY: 0,
    longitudinalSign: 1,
  };
}

export function flattenPointForSideView(point: SizePoint, progress = 1, frame: SideProjectionFrame): SizePoint {
  return {
    ...point,
    xM: lerp(point.xM, 0, progress),
    yM: (point.yM - frame.baselineY) * frame.longitudinalSign,
    tangentIn: undefined,
    tangentOut: undefined,
  };
}

export function flattenShapeForSideView(shape: SizeShape, progress = 1, frame: SideProjectionFrame): SizeShape {
  return {
    ...shape,
    points: shape.points.map((point) => flattenPointForSideView(point, progress, frame)),
  };
}

export function collapseShapeToSideAxis(shape: SizeShape, progress: number, frame: SideProjectionFrame): SizeShape {
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

export function bodySideSection(shape: SizeShape, progress: number, shapes: SizeShape[], frame: SideProjectionFrame): SizePoint[] {
  const localMirrorPlane = shapes.find((candidate) => candidate.role === "mirrorPlane" && candidate.id !== shape.id && shapeTouchesMirrorPlane(shape, candidate));
  if (localMirrorPlane) return bodySideSectionAroundPlane(shape, localMirrorPlane, progress, frame);
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

export function bodySideSectionAroundPlane(shape: SizeShape, plane: SizeShape, progress: number, frame: SideProjectionFrame): SizePoint[] {
  const axis = projectionAxisForLine(plane);
  if (!axis || shape.points.length < 2) return bodySideSection({ ...shape }, progress, [], frame);
  const projections = shape.points.map((point) => projectPointOntoAxis(point, axis));
  const minProjection = Math.min(...projections);
  const maxProjection = Math.max(...projections);
  const lengthM = Math.max(maxProjection - minProjection, 0.01);
  const right: SizePoint[] = [];
  const left: SizePoint[] = [];
  for (let index = 0; index <= 24; index += 1) {
    const stationT = index / 24;
    const projection = minProjection + lengthM * stationT;
    const axisPoint = axisPointAtProjection(axis, projection);
    const sourceY = axisPoint.yM;
    const radiusM = Math.max(radiusAtAxisProjection(shape.points, axis, projection), 0.006);
    right.push(sideProjectedPoint(sourceY, radiusM, progress, frame));
    left.unshift(sideProjectedPoint(sourceY, -radiusM, progress, frame));
  }
  return [...right, ...left, right[0]];
}

export function liftingSurfaceSideSection(shape: SizeShape, progress: number, frame: SideProjectionFrame) {
  const bounds = shapeBounds(shape);
  const stations = [
    { t: 0, airfoil: shape.airfoilStations?.root ?? shape.airfoil ?? "NACA 0012", incidenceDeg: shape.incidenceStationsDeg?.root ?? shape.incidenceDeg ?? 0 },
    { t: 1, airfoil: shape.airfoilStations?.tip ?? shape.airfoil ?? "NACA 0012", incidenceDeg: shape.incidenceStationsDeg?.tip ?? shape.incidenceDeg ?? 0 },
  ];
  return stations.flatMap((station, index) => {
    const stationX = bounds.minX + (bounds.maxX - bounds.minX) * station.t;
    const extents = chordExtentsAtX(shape.points, stationX) ?? { minY: bounds.minY, maxY: bounds.maxY };
    const leadingY = extents.maxY;
    const chordM = extents.minY - extents.maxY;
    return airfoilSideSection(leadingY, chordM, station.airfoil, progress, frame, station.incidenceDeg, index > 0);
  });
}

export function motorSideSection(shape: SizeShape, progress: number, frame: SideProjectionFrame) {
  return rectangularSideSection(shape, progress, motorDiameterM(shape), motorLengthM(shape), frame);
}

export function rotorSideSection(shape: SizeShape, progress: number, shapes: SizeShape[], frame: SideProjectionFrame) {
  const center = nearestMotorCenterY(shape, shapes) ?? topDownShapeCenter(shape).yM;
  const diameterM = rotorDiskDiameterM(shape);
  const radiusM = diameterM / 2;
  const rootChordM = Math.max(diameterM * 0.055, 0.008);
  const tipChordM = Math.max(diameterM * 0.028, 0.004);
  const rootInsetM = radiusM * 0.08;
  const bladeLengthM = Math.max(radiusM - rootInsetM, 0.01);
  const blade = rotorBladeSidePoints(center, rootInsetM, bladeLengthM, rootChordM, tipChordM, progress, frame, 1);
  const mirrorBlade = rotorBladeSidePoints(center, rootInsetM, bladeLengthM, rootChordM, tipChordM, progress, frame, -1);
  return [...blade, ...mirrorBlade];
}

export function rotorBladeSidePoints(
  centerY: number,
  rootInsetM: number,
  bladeLengthM: number,
  rootChordM: number,
  tipChordM: number,
  progress: number,
  frame: SideProjectionFrame,
  side: 1 | -1,
) {
  const samples = 10;
  const leading: SizePoint[] = [];
  const trailing: SizePoint[] = [];
  for (let index = 0; index <= samples; index += 1) {
    const t = index / samples;
    const spanHeightM = side * (rootInsetM + bladeLengthM * t);
    const chordM = lerp(rootChordM, tipChordM, t);
    const stationCenterY = centerY + chordM * 0.18;
    leading.push(sideProjectedPoint(stationCenterY - chordM * 0.5, spanHeightM, progress, frame));
    trailing.unshift(sideProjectedPoint(stationCenterY + chordM * 0.5, spanHeightM, progress, frame));
  }
  return [...leading, ...trailing, leading[0]];
}

export function rectangularSideSection(shape: SizeShape, progress: number, heightM: number, overrideLengthM?: number, frame: SideProjectionFrame = { baselineY: 0, longitudinalSign: 1 }) {
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

export function sidePartHalfHeight(shape: SizeShape) {
  return partZHeightM(shape);
}

export function sideProjectedPoint(lengthM: number, heightM: number, progress: number, frame: SideProjectionFrame): SizePoint {
  return {
    xM: heightM * progress,
    yM: (lengthM - frame.baselineY) * frame.longitudinalSign,
    curveMode: "corner",
    segmentInMode: "corner",
    segmentOutMode: "corner",
  };
}

export function airfoilSideSection(
  leadingY: number,
  chordM: number,
  airfoilName: string,
  progress: number,
  frame: SideProjectionFrame,
  incidenceDeg = 0,
  pathBreak = false,
) {
  const upper: SizePoint[] = [];
  const lower: SizePoint[] = [];
  const safeChordM = Math.max(Math.abs(chordM), 0.01);
  const direction = chordM < 0 ? -1 : 1;
  const safeThicknessRatio = Math.max(airfoilThicknessRatio(airfoilName), 0.04);
  const incidenceRad = (incidenceDeg * Math.PI) / 180;
  const cos = Math.cos(incidenceRad);
  const sin = Math.sin(incidenceRad);
  for (let index = 0; index <= 28; index += 1) {
    const x = index / 28;
    const chordOffsetM = safeChordM * x * direction;
    const halfThicknessM = nacaSymmetricHalfThickness(x, safeThicknessRatio, safeChordM);
    const camberM = airfoilCamberAtStation(airfoilName, x, safeChordM);
    upper.push(airfoilSidePoint(leadingY, chordOffsetM, camberM + halfThicknessM, cos, sin, progress, frame, pathBreak && index === 0));
    lower.unshift(airfoilSidePoint(leadingY, chordOffsetM, camberM - halfThicknessM, cos, sin, progress, frame));
  }
  return [...upper, ...lower, { ...upper[0], pathBreak: false } as SizePoint & { pathBreak?: boolean }];
}

export function airfoilSidePoint(
  leadingY: number,
  chordOffsetM: number,
  heightM: number,
  cos: number,
  sin: number,
  progress: number,
  frame: SideProjectionFrame,
  pathBreak = false,
): SizePoint {
  const yM = leadingY + chordOffsetM * cos - heightM * sin;
  const zM = chordOffsetM * sin + heightM * cos;
  return {
    ...sideProjectedPoint(yM, zM, progress, frame),
    pathBreak,
  } as SizePoint & { pathBreak?: boolean };
}

export function nacaSymmetricHalfThickness(stationT: number, thicknessRatio: number, chordM: number) {
  const x = clamp(stationT, 0, 1);
  const normalizedHalfThickness =
    5 *
    thicknessRatio *
    (0.2969 * Math.sqrt(x) - 0.126 * x - 0.3516 * x * x + 0.2843 * x ** 3 - 0.1015 * x ** 4);
  return Math.max(normalizedHalfThickness * chordM, 0);
}

export function airfoilCamberAtStation(name: string, stationT: number, chordM: number) {
  const match = name.match(/(\d{4})/);
  if (!match) return 0;
  const digits = match[1];
  const maxCamber = Number(digits[0]) / 100;
  const camberPosition = Number(digits[1]) / 10;
  if (maxCamber <= 0 || camberPosition <= 0) return 0;
  const x = clamp(stationT, 0, 1);
  const camber =
    x < camberPosition
      ? (maxCamber / (camberPosition ** 2)) * (2 * camberPosition * x - x ** 2)
      : (maxCamber / ((1 - camberPosition) ** 2)) * ((1 - 2 * camberPosition) + 2 * camberPosition * x - x ** 2);
  return camber * chordM;
}

export function circularFrontSection(shape: SizeShape, progress: number, overrideRadiusM?: number, overrideCenterX?: number) {
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

export function boxFrontSection(shape: SizeShape, progress: number, heightM = partZHeightM(shape)) {
  const centerX = frontSectionCenterX(shape);
  const bounds = shapeBounds(shape);
  const halfWidthM = Math.max((bounds.maxX - bounds.minX) / 2, 0.01);
  const halfHeightM = Math.max(heightM / 2, 0.004);
  const minX = shapeTouchesMirrorAxis(shape) ? 0 : Math.max(0, centerX - halfWidthM);
  const maxX = shapeTouchesMirrorAxis(shape) ? Math.max(bounds.maxX, 0.01) : centerX + halfWidthM;
  return [
    { xM: minX, yM: halfHeightM * progress, curveMode: "corner" as const },
    { xM: maxX, yM: halfHeightM * progress, curveMode: "corner" as const },
    { xM: maxX, yM: -halfHeightM * progress, curveMode: "corner" as const },
    { xM: minX, yM: -halfHeightM * progress, curveMode: "corner" as const },
    { xM: minX, yM: halfHeightM * progress, curveMode: "corner" as const },
  ];
}

export function liftingSurfaceFrontSection(shape: SizeShape, progress: number, shapes: SizeShape[] = []) {
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

export function dihedralWingFrontSection(shape: SizeShape, shapes: SizeShape[], progress = 1) {
  const pointSets = frontPointSetsForShape(shape, shapes);
  const bounds = pointSetBounds(pointSets);
  const rootX = shapeTouchesMirrorAxis(shape) ? 0 : bounds.minX;
  const tipX = Math.max(bounds.maxX, rootX + 0.01);
  const spanM = Math.max(tipX - rootX, 0.01);
  const sampleInsetM = spanM * 0.015;
  const rootHalfHeightM = liftingSurfaceHalfHeightAtSpanEnd(shape, pointSets, rootX, sampleInsetM, "root");
  const tipHalfHeightM = liftingSurfaceHalfHeightAtSpanEnd(shape, pointSets, tipX, sampleInsetM, "tip");
  const rootZ = liftingSurfaceCenterZAtX(shape, shapes, rootX);
  const tipZ = liftingSurfaceCenterZAtX(shape, shapes, tipX);
  const liftM = shape.dihedralLiftM !== undefined ? Math.max(shape.dihedralLiftM, 0) : tipZ - rootZ;
  const breakX = Math.min(Math.max(dihedralBreakX(shape, shapes) ?? tipX, rootX + 0.01), tipX);
  const top: SizePoint[] = [];
  const bottom: SizePoint[] = [];
  for (let index = 0; index <= 24; index += 1) {
    const stationT = index / 24;
    const xM = rootX + spanM * stationT;
    const airfoilT = (xM - rootX) / spanM;
    const halfHeightM = lerp(rootHalfHeightM, tipHalfHeightM, airfoilT);
    const centerZM = rootZ + (xM <= breakX ? liftM * ((xM - rootX) / Math.max(breakX - rootX, 0.01)) : liftM);
    top.push({ xM, yM: centerZM + halfHeightM * progress, curveMode: "corner", segmentInMode: "corner", segmentOutMode: "corner" });
    bottom.unshift({ xM, yM: centerZM - halfHeightM * progress, curveMode: "corner", segmentInMode: "corner", segmentOutMode: "corner" });
  }
  return [...top, ...bottom, top[0]];
}

function liftingSurfaceHasDihedral(shape: SizeShape, shapes: SizeShape[]) {
  if (shape.dihedralLiftM && Math.abs(shape.dihedralLiftM) > 1e-6) return true;
  const stations = liftingSurfaceZStations(shape, shapes);
  if (stations.length < 2) return false;
  const zs = stations.map((station) => station.zM);
  return Math.max(...zs) - Math.min(...zs) > 1e-6;
}

function dihedralBreakX(shape: SizeShape, shapes: SizeShape[]) {
  if (isImplicitMirrorShapeId(shape.dihedralBreakStationId)) return 0;
  const station = shapes.find((candidate) => candidate.id === shape.dihedralBreakStationId);
  return station ? verticalReferenceX(station) : undefined;
}

export function liftingSurfaceHalfHeightAtSpanEnd(
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

export function frontPointSetsForShape(shape: SizeShape, shapes: SizeShape[]) {
  const localMirrorPlanes = shouldUseLocalMirror(shape)
    ? shapes.filter((plane) => plane.role === "mirrorPlane" && plane.id !== shape.id && shapeTouchesMirrorPlane(shape, plane))
    : [];
  return [shape.points, ...localMirrorPlanes.map((plane) => mirrorPointsAcrossPlane(shape.points, plane))];
}

export function rotorOrPartRadius(shape: SizeShape, shapes: SizeShape[]) {
  if (shape.partType === "rotor") return Math.max(rotorDiameterEstimate(shape, shapes) / 2, 0.01);
  return Math.max(frontSectionRadius(shape, shapes), frontSectionDepth(shape) / 2, 0.01);
}

export function frontSectionCenterX(shape: SizeShape, shapes: SizeShape[] = []) {
  if ((shape.role === "body" || shape.role === "part") && shapeTouchesMirrorAxis(shape)) return 0;
  const referenceCenter = referenceCenterXForShape(shape, shapes);
  if (referenceCenter !== undefined) return referenceCenter;
  if (shape.partType === "rotor") return nearestMotorCenterX(shape, shapes) ?? rotorHubCenterX(shape);
  if (shape.partType === "motor") return motorSpanPoints(shape.points)[0]?.xM ?? 0;
  const bounds = shapeBounds(shape);
  return shapeTouchesMirrorAxis(shape) ? 0 : (bounds.minX + bounds.maxX) / 2;
}

export function nearestMotorCenterX(shape: SizeShape, shapes: SizeShape[]) {
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

export function nearestMotorCenterY(shape: SizeShape, shapes: SizeShape[]) {
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

export function topDownShapeCenter(shape: SizeShape): SizePoint {
  if (shape.partType === "motor") {
    const origin = motorSpanPoints(shape.points)[0];
    if (origin) return { xM: origin.xM, yM: origin.yM };
  }
  const bounds = shapeBounds(shape);
  return {
    xM: shapeTouchesMirrorAxis(shape) ? 0 : (bounds.minX + bounds.maxX) / 2,
    yM: (bounds.minY + bounds.maxY) / 2,
  };
}

export function rotorHubCenterX(shape: SizeShape) {
  const bounds = shapeBounds(shape);
  if (shapeTouchesMirrorAxis(shape)) return 0;
  const sorted = shape.points.map((point) => Math.abs(point.xM)).sort((a, b) => a - b);
  return sorted[0] ?? (bounds.minX + bounds.maxX) / 2;
}

export function referenceCenterXForShape(shape: SizeShape, shapes: SizeShape[]) {
  const explicitStationX = sideViewStationX(shape, shapes);
  if (explicitStationX !== undefined) return explicitStationX;

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

export function sideViewStationX(shape: SizeShape, shapes: SizeShape[]) {
  if (shape.sketchViewMode !== "side" || !shape.sideViewStationId) return undefined;
  const attachedStationX = sideViewSnapStationX(shape, shapes);
  if (attachedStationX !== undefined) return attachedStationX;
  if (isImplicitMirrorShapeId(shape.sideViewStationId)) return 0;
  const station = shapes.find((candidate) => candidate.id === shape.sideViewStationId);
  return station ? verticalReferenceX(station) : undefined;
}

function sideViewSnapStationX(shape: SizeShape, shapes: SizeShape[]) {
  for (const point of shape.points) {
    const attachment = point.snapAttachment;
    if (!attachment) continue;
    const station = shapes.find(
      (candidate) =>
        candidate.id === attachment.shapeId &&
        referenceRoles.includes(candidate.role) &&
        (candidate.sketchViewMode ?? "top") === "top",
    );
    const stationX = station ? verticalReferenceX(station) : undefined;
    if (stationX !== undefined) return stationX;
  }
  return undefined;
}

export function verticalReferenceX(shape: SizeShape) {
  const [start, end] = shape.points;
  if (!start || !end) return undefined;
  if (Math.abs(start.xM - end.xM) > Math.abs(start.yM - end.yM)) return undefined;
  return (start.xM + end.xM) / 2;
}

export function referenceOverlapsShapeY(reference: SizeShape, bounds: ReturnType<typeof shapeBounds>) {
  const [start, end] = reference.points;
  if (!start || !end) return false;
  const minY = Math.min(start.yM, end.yM);
  const maxY = Math.max(start.yM, end.yM);
  return maxY >= bounds.minY - 0.02 && minY <= bounds.maxY + 0.02;
}

export function frontSectionHalfWidth(shape: SizeShape) {
  const bounds = shapeBounds(shape);
  return shapeTouchesMirrorAxis(shape) ? bounds.maxX : Math.max((bounds.maxX - bounds.minX) / 2, 0);
}

export function frontSectionRadius(shape: SizeShape, shapes: SizeShape[] = []) {
  return mirroredDiameterForPointSets(frontPointSetsForShape(shape, shapes)) / 2;
}

export function frontSectionDepth(shape: SizeShape) {
  const bounds = shapeBounds(shape);
  return Math.max(bounds.maxY - bounds.minY, 0);
}

export function shapeTouchesMirrorAxis(shape: SizeShape) {
  return pointsTouchMirrorAxis(shape.points);
}

export function pointsTouchMirrorAxis(points: SizePoint[]) {
  return points.some((point) => Math.abs(point.xM) <= mirrorAxisTouchToleranceM);
}

export function chordLengthAtX(points: SizePoint[], xM: number) {
  const extents = chordExtentsAtX(points, xM);
  return extents ? extents.maxY - extents.minY : 0;
}

export function chordExtentsAtX(points: SizePoint[], xM: number) {
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
  if (intersections.length < 2) return undefined;
  return { minY: Math.min(...intersections), maxY: Math.max(...intersections) };
}

export function chordLengthAtXForSets(pointSets: SizePoint[][], xM: number) {
  return Math.max(...pointSets.map((points) => chordLengthAtX(points, xM)), 0);
}

export function widthAtYForSets(pointSets: SizePoint[][], yM: number) {
  return Math.max(...pointSets.map((points) => widthAtY(points, yM)), 0);
}

export function widthAtY(points: SizePoint[], yM: number) {
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

export function maxChordLengthForSets(pointSets: SizePoint[][]) {
  const bounds = pointSetBounds(pointSets);
  const spanM = Math.max(bounds.maxX - bounds.minX, 0.01);
  let chordM = 0;
  for (let index = 0; index <= 20; index += 1) {
    const xM = bounds.minX + (spanM * index) / 20;
    chordM = Math.max(chordM, chordLengthAtXForSets(pointSets, xM));
  }
  return chordM || Math.max(bounds.maxY - bounds.minY, 0);
}

export function mirroredDiameterForPointSets(pointSets: SizePoint[][]) {
  const bounds = pointSetBounds(pointSets);
  if (bounds.minX <= mirrorAxisTouchToleranceM) return Math.max(bounds.maxX * 2, 0);
  return Math.max(bounds.maxX - bounds.minX, 0);
}

export function pointSetBounds(pointSets: SizePoint[][]) {
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

export function airfoilThicknessRatioAtStation(shape: SizeShape, stationT: number) {
  const root = airfoilThicknessRatio(shape.airfoilStations?.root ?? shape.airfoil ?? "NACA 0012");
  const tip = airfoilThicknessRatio(shape.airfoilStations?.tip ?? shape.airfoil ?? "NACA 0012");
  return lerp(root, tip, clamp(stationT, 0, 1));
}

export function airfoilThicknessRatio(name: string) {
  const match = name.match(/(\d{4})/);
  if (match) return Math.max(Number(match[1].slice(2)) / 100, 0.04);
  const normalized = name.toLowerCase().replace(/\s+/g, "");
  if (normalized.includes("clarky")) return 0.117;
  if (normalized.includes("mh32")) return 0.087;
  if (normalized.includes("s1223")) return 0.121;
  return 0.12;
}

export function incidenceAtStation(shape: SizeShape, stationT: number) {
  const root = shape.incidenceStationsDeg?.root ?? shape.incidenceDeg ?? 0;
  const tip = shape.incidenceStationsDeg?.tip ?? shape.incidenceDeg ?? 0;
  return lerp(root, tip, clamp(stationT, 0, 1));
}

export function lerp(from: number, to: number, progress: number) {
  return from + (to - from) * progress;
}

export function shouldUseLocalMirror(shape: SizeShape) {
  return shape.role !== "referenceLine" && shape.role !== "mirrorPlane";
}

export function shapeTouchesMirrorPlane(shape: SizeShape, plane: SizeShape) {
  const [start, end] = plane.points;
  if (!start || !end) return false;
  const thresholdM = 0.015;
  return shape.points.some((point) => distancePointToSegment(point, start, end) <= thresholdM) || shapeSegments(shape.points).some(([a, b]) => segmentsTouch(a, b, start, end, thresholdM));
}

export function mirrorPointsAcrossPlane(points: SizePoint[], plane: SizeShape) {
  const [start, end] = plane.points;
  if (!start || !end) return points;
  return points.map((point) => mirrorPointAcrossLine(point, start, end));
}

export function mirrorPointAcrossLine(point: SizePoint, start: SizePoint, end: SizePoint): SizePoint {
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
    tangentIn: point.tangentIn ? mirrorVectorAcrossLine(point.tangentIn, dx, dy, lengthSquared) : undefined,
    tangentOut: point.tangentOut ? mirrorVectorAcrossLine(point.tangentOut, dx, dy, lengthSquared) : undefined,
  };
}

function mirrorVectorAcrossLine(vector: SizePoint, dx: number, dy: number, lengthSquared: number): SizePoint {
  const dot = vector.xM * dx + vector.yM * dy;
  const projectionX = (dx * dot) / lengthSquared;
  const projectionY = (dy * dot) / lengthSquared;
  return {
    ...vector,
    xM: projectionX * 2 - vector.xM,
    yM: projectionY * 2 - vector.yM,
  };
}

type ProjectionAxis = {
  start: SizePoint;
  unitX: number;
  unitY: number;
};

function projectionAxisForLine(lineShape: SizeShape): ProjectionAxis | undefined {
  const [start, end] = lineShape.points;
  if (!start || !end) return undefined;
  const dx = end.xM - start.xM;
  const dy = end.yM - start.yM;
  const length = Math.hypot(dx, dy);
  if (length <= 1e-9) return undefined;
  return { start, unitX: dx / length, unitY: dy / length };
}

function projectPointOntoAxis(point: SizePoint, axis: ProjectionAxis) {
  return (point.xM - axis.start.xM) * axis.unitX + (point.yM - axis.start.yM) * axis.unitY;
}

function axisPointAtProjection(axis: ProjectionAxis, projection: number): SizePoint {
  return {
    xM: axis.start.xM + axis.unitX * projection,
    yM: axis.start.yM + axis.unitY * projection,
  };
}

function radiusAtAxisProjection(points: SizePoint[], axis: ProjectionAxis, projection: number) {
  let radiusM = 0;
  const thresholdM = 1e-6;
  for (let index = 0; index < points.length; index += 1) {
    const point = points[index];
    const next = points[(index + 1) % points.length];
    const pointProjection = projectPointOntoAxis(point, axis);
    const nextProjection = projectPointOntoAxis(next, axis);
    if (Math.abs(pointProjection - projection) <= thresholdM) {
      radiusM = Math.max(radiusM, distanceFromPointToProjectionAxis(point, axis));
    }
    if (Math.abs(nextProjection - projection) <= thresholdM) {
      radiusM = Math.max(radiusM, distanceFromPointToProjectionAxis(next, axis));
    }
    const minProjection = Math.min(pointProjection, nextProjection);
    const maxProjection = Math.max(pointProjection, nextProjection);
    if (projection < minProjection - thresholdM || projection > maxProjection + thresholdM) continue;
    const projectionRange = nextProjection - pointProjection;
    if (Math.abs(projectionRange) <= thresholdM) {
      radiusM = Math.max(
        radiusM,
        distanceFromPointToProjectionAxis(point, axis),
        distanceFromPointToProjectionAxis(next, axis),
      );
      continue;
    }
    const t = clamp((projection - pointProjection) / projectionRange, 0, 1);
    const sample = {
      xM: point.xM + (next.xM - point.xM) * t,
      yM: point.yM + (next.yM - point.yM) * t,
    };
    radiusM = Math.max(radiusM, distanceFromPointToProjectionAxis(sample, axis));
  }
  return radiusM;
}

function distanceFromPointToProjectionAxis(point: SizePoint, axis: ProjectionAxis) {
  return Math.abs((point.xM - axis.start.xM) * axis.unitY - (point.yM - axis.start.yM) * axis.unitX);
}

export function distancePointToLine(point: SizePoint, start: SizePoint, end: SizePoint) {
  const dx = end.xM - start.xM;
  const dy = end.yM - start.yM;
  const length = Math.hypot(dx, dy);
  if (length <= 1e-9) return distanceBetweenPoints(point, start);
  return Math.abs(dy * point.xM - dx * point.yM + end.xM * start.yM - end.yM * start.xM) / length;
}

export function distancePointToSegment(point: SizePoint, start: SizePoint, end: SizePoint) {
  const dx = end.xM - start.xM;
  const dy = end.yM - start.yM;
  const lengthSquared = dx * dx + dy * dy;
  if (lengthSquared <= 1e-9) return distanceBetweenPoints(point, start);
  const t = clamp(((point.xM - start.xM) * dx + (point.yM - start.yM) * dy) / lengthSquared, 0, 1);
  return distanceBetweenPoints(point, { xM: start.xM + dx * t, yM: start.yM + dy * t });
}

function shapeSegments(points: SizePoint[]) {
  const segments: Array<[SizePoint, SizePoint]> = [];
  for (let index = 0; index < points.length - 1; index += 1) {
    segments.push([points[index], points[index + 1]]);
  }
  if (points.length > 2) segments.push([points[points.length - 1], points[0]]);
  return segments;
}

function segmentsTouch(a: SizePoint, b: SizePoint, c: SizePoint, d: SizePoint, thresholdM: number) {
  if (segmentsIntersect(a, b, c, d)) return true;
  return (
    distancePointToSegment(a, c, d) <= thresholdM ||
    distancePointToSegment(b, c, d) <= thresholdM ||
    distancePointToSegment(c, a, b) <= thresholdM ||
    distancePointToSegment(d, a, b) <= thresholdM
  );
}

function segmentsIntersect(a: SizePoint, b: SizePoint, c: SizePoint, d: SizePoint) {
  const epsilon = 1e-9;
  const abC = orientation(a, b, c);
  const abD = orientation(a, b, d);
  const cdA = orientation(c, d, a);
  const cdB = orientation(c, d, b);
  if (Math.abs(abC) <= epsilon && pointWithinSegment(c, a, b)) return true;
  if (Math.abs(abD) <= epsilon && pointWithinSegment(d, a, b)) return true;
  if (Math.abs(cdA) <= epsilon && pointWithinSegment(a, c, d)) return true;
  if (Math.abs(cdB) <= epsilon && pointWithinSegment(b, c, d)) return true;
  return (abC > 0) !== (abD > 0) && (cdA > 0) !== (cdB > 0);
}

function orientation(a: SizePoint, b: SizePoint, c: SizePoint) {
  return (b.xM - a.xM) * (c.yM - a.yM) - (b.yM - a.yM) * (c.xM - a.xM);
}

function pointWithinSegment(point: SizePoint, start: SizePoint, end: SizePoint) {
  const epsilon = 1e-9;
  return (
    point.xM >= Math.min(start.xM, end.xM) - epsilon &&
    point.xM <= Math.max(start.xM, end.xM) + epsilon &&
    point.yM >= Math.min(start.yM, end.yM) - epsilon &&
    point.yM <= Math.max(start.yM, end.yM) + epsilon
  );
}

export function closeIfNearCenterline(points: SizePoint[]) {
  return points.map((point): SizePoint => ({ ...point, xM: Math.max(0, point.xM) }));
}

export function moveAttachedOrFreePoint(current: SizePoint, target: SizePoint, shapes: SizeShape[], preserveXSign = false): SizePoint {
  if (current.snapAttachment?.kind === "segment") {
    const sourceShape =
      isImplicitMirrorShapeId(current.snapAttachment.shapeId)
        ? implicitMirrorShape()
        : shapes.find((shape) => shape.id === current.snapAttachment?.shapeId);
    if (sourceShape?.points[current.snapAttachment.segmentIndex] && sourceShape.points[current.snapAttachment.segmentIndex + 1]) {
      const projection = projectPointToShapeSegment(target, sourceShape.points, current.snapAttachment.segmentIndex);
      return {
        ...current,
        ...projection.point,
        xM: preserveXSign ? projection.point.xM : Math.abs(projection.point.xM),
        snapAttachment: { ...current.snapAttachment, t: projection.t },
      };
    }
  }
  return { ...current, xM: preserveXSign ? target.xM : Math.abs(target.xM), yM: target.yM, snapAttachment: undefined };
}

export function moveShapePointWithConstraints(shape: SizeShape, index: number, current: SizePoint, target: SizePoint, shapes: SizeShape[]) {
  const preserveXSign = shape.sketchViewMode === "side";
  const moved = moveAttachedOrFreePoint(current, target, shapes, preserveXSign);
  if (!referenceRoles.includes(shape.role) || shape.points.length < 2) return moved;
  const anchor = shape.points[index === 0 ? 1 : 0];
  return referenceEndpointPoint(shape.points, anchor, moved, preserveXSign);
}

export function nearestSegmentTarget(shape: SizeShape, point: SizePoint): SizeDimensionTarget {
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

export function sameDimensionTarget(a: SizeDimensionTarget, b: SizeDimensionTarget) {
  if (a.kind !== b.kind || a.shapeId !== b.shapeId) return false;
  if (a.kind === "node" && b.kind === "node") return a.pointIndex === b.pointIndex;
  if (a.kind === "segment" && b.kind === "segment") return a.segmentIndex === b.segmentIndex && Math.abs(a.t - b.t) < 0.001;
  return false;
}

export function measureDimension(targetA: SizeDimensionTarget, targetB: SizeDimensionTarget, shapes: SizeShape[]) {
  const points = dimensionTargetPoints(targetA, targetB, shapes);
  const a = points?.start;
  const b = points?.end;
  return a && b ? distanceBetweenPoints(a, b) : undefined;
}

export function dimensionTargetPoints(targetA: SizeDimensionTarget, targetB: SizeDimensionTarget, shapes: SizeShape[]) {
  const lineA = dimensionLineTarget(targetA, shapes);
  const lineB = dimensionLineTarget(targetB, shapes);
  const pointA = dimensionTargetPoint(targetA, shapes);
  const pointB = dimensionTargetPoint(targetB, shapes);
  if (lineA && lineB) return closestPointsBetweenDimensionLines(lineA.start, lineA.end, lineB.start, lineB.end);
  if (pointA && lineB) return { start: pointA, end: closestPointOnDimensionLine(pointA, lineB.start, lineB.end, lineB.infinite) };
  if (lineA && pointB) return { start: closestPointOnDimensionLine(pointB, lineA.start, lineA.end, lineA.infinite), end: pointB };
  if (pointA && pointB) return { start: pointA, end: pointB };
  return undefined;
}

function dimensionLineTarget(target: SizeDimensionTarget, shapes: SizeShape[]) {
  if (target.kind !== "segment") return undefined;
  const shape = isImplicitMirrorShapeId(target.shapeId) ? implicitMirrorShape() : shapes.find((candidate) => candidate.id === target.shapeId);
  if (!shape || !referenceRoles.includes(shape.role)) return undefined;
  const start = shape?.points[target.segmentIndex];
  const end = shape?.points[target.segmentIndex + 1];
  if (!start || !end) return undefined;
  return { start, end, infinite: referenceRoles.includes(shape.role) };
}

function closestPointsBetweenDimensionLines(startA: SizePoint, endA: SizePoint, startB: SizePoint, endB: SizePoint) {
  const ax = endA.xM - startA.xM;
  const ay = endA.yM - startA.yM;
  const bx = endB.xM - startB.xM;
  const by = endB.yM - startB.yM;
  const denominator = cross2d(ax, ay, bx, by);
  if (Math.abs(denominator) > 1e-9) {
    const cx = startB.xM - startA.xM;
    const cy = startB.yM - startA.yM;
    const t = cross2d(cx, cy, bx, by) / denominator;
    const intersection = { xM: startA.xM + ax * t, yM: startA.yM + ay * t };
    return { start: intersection, end: intersection };
  }
  const start = startA;
  return { start, end: closestPointOnDimensionLine(start, startB, endB, true) };
}

function closestPointOnDimensionLine(point: SizePoint, start: SizePoint, end: SizePoint, infinite: boolean) {
  const dx = end.xM - start.xM;
  const dy = end.yM - start.yM;
  const lengthSquared = dx * dx + dy * dy;
  if (lengthSquared <= 1e-12) return start;
  const rawT = ((point.xM - start.xM) * dx + (point.yM - start.yM) * dy) / lengthSquared;
  const t = infinite ? rawT : clamp(rawT, 0, 1);
  return { xM: start.xM + dx * t, yM: start.yM + dy * t };
}

function cross2d(ax: number, ay: number, bx: number, by: number) {
  return ax * by - ay * bx;
}

export function dimensionTargetPoint(target: SizeDimensionTarget, shapes: SizeShape[]): SizePoint | undefined {
  const shape = isImplicitMirrorShapeId(target.shapeId) ? implicitMirrorShape() : shapes.find((candidate) => candidate.id === target.shapeId);
  if (!shape) return undefined;
  if (target.kind === "node") return shape.points[target.pointIndex];
  return pointAtShapeSegmentT(shape.points, target.segmentIndex, target.t);
}

export function enforceDimensions(shapes: SizeShape[], dimensions: SizeDimension[]) {
  let next = cloneSizeShapes(shapes);
  for (const dimension of dimensions) {
    next = enforceDimension(next, dimension);
  }
  return resolveAttachedShapes(next);
}

export function enforceDimension(shapes: SizeShape[], dimension: SizeDimension): SizeShape[] {
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

export function movableNodeTarget(target: SizeDimensionTarget, shapes: SizeShape[]): SizeDimensionTarget | undefined {
  if (target.kind !== "node") return undefined;
  const shape = shapes.find((candidate) => candidate.id === target.shapeId);
  const point = shape?.points[target.pointIndex];
  return point && !point.snapAttachment ? target : undefined;
}

export function moveNodeToDimension(
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

export function dimensionDirection(current: SizePoint, anchor: SizePoint, shapes: SizeShape[], segmentTarget?: SizeDimensionTarget): SizePoint {
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

export function trimDimensionValue(value: number) {
  return Number(value.toFixed(4)).toString();
}

export function referenceEndpointPoint(points: SizePoint[], anchor: SizePoint, target: SizePoint, preserveXSign = false): SizePoint {
  const [start, end] = points;
  if (!start || !end) return { ...target, xM: preserveXSign ? target.xM : Math.abs(target.xM) };
  const vertical = Math.abs(end.yM - start.yM) >= Math.abs(end.xM - start.xM);
  return vertical
    ? { ...target, xM: preserveXSign ? anchor.xM : Math.abs(anchor.xM), yM: target.yM, snapAttachment: undefined }
    : { ...target, xM: preserveXSign ? target.xM : Math.abs(target.xM), yM: anchor.yM, snapAttachment: undefined };
}

export function translateReferenceLinePoints(points: SizePoint[], startPoint: SizePoint, targetPoint: SizePoint, preserveXSign = false): SizePoint[] {
  const [start, end] = points;
  if (!start || !end) return points;
  const vertical = Math.abs(end.yM - start.yM) >= Math.abs(end.xM - start.xM);
  const deltaX = targetPoint.xM - startPoint.xM;
  const deltaY = targetPoint.yM - startPoint.yM;
  return points.map((point) =>
    vertical
      ? { ...point, xM: preserveXSign ? point.xM + deltaX : Math.abs(point.xM + deltaX), snapAttachment: undefined }
      : { ...point, yM: point.yM + deltaY, snapAttachment: undefined },
  );
}

export function translateShapePointsForDrag(points: SizePoint[], startPoint: SizePoint, targetPoint: SizePoint): SizePoint[] {
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

export function cloneSizePoints(points: SizePoint[]): SizePoint[] {
  return points.map((point) => ({
    ...point,
    tangentIn: point.tangentIn ? { ...point.tangentIn } : undefined,
    tangentOut: point.tangentOut ? { ...point.tangentOut } : undefined,
    snapAttachment: point.snapAttachment ? { ...point.snapAttachment } : undefined,
  }));
}

export function cloneSizeShapes(shapes: SizeShape[]): SizeShape[] {
  return shapes.map((shape) => ({
    ...shape,
    points: cloneSizePoints(shape.points),
  }));
}

export function insertPointOnNearestSegment(points: SizePoint[], target: SizePoint) {
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

export function setSegmentMode(points: SizePoint[], index: number, side: "in" | "out", mode: "corner" | "spline") {
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

export function setPointCurveMode(points: SizePoint[], index: number, mode: "corner" | "spline") {
  return points.map((point, pointIndex) => {
    if (pointIndex !== index) return point;
    if (mode === "corner") {
      return {
        ...point,
        curveMode: mode,
        segmentInMode: "corner" as const,
        segmentOutMode: "corner" as const,
        tangentIn: undefined,
        tangentOut: undefined,
      };
    }
    return {
      ...point,
      curveMode: mode,
    };
  });
}

export function setTangentVector(points: SizePoint[], index: number, side: "in" | "out", target: SizePoint) {
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

export function cloneSizingProject(project: SizingProject): SizingProject {
  return JSON.parse(JSON.stringify(project)) as SizingProject;
}

export function resolveAttachedShapes(shapes: SizeShape[]) {
  return shapes.map((shape) => ({
    ...shape,
    points:
      shape.partType === "rotor"
        ? rotorSpanPoints(shape.points.map((point) => resolveAttachedPoint(point, shapes)))
        : shape.partType === "motor"
          ? resolveMotorAttachedPoints(shape.points, shapes)
        : shape.points.map((point) => resolveAttachedPoint(point, shapes)),
  }));
}

export function resolveMotorAttachedPoints(points: SizePoint[], shapes: SizeShape[]) {
  const controls = motorSpanPoints(points);
  if (controls.length < 2) return controls.map((point) => resolveAttachedPoint(point, shapes));
  const origin = controls[0];
  const handle = controls[1];
  if (!origin || !handle) return controls;
  const resolvedOrigin = resolveAttachedPoint(origin, shapes);
  const dx = resolvedOrigin.xM - origin.xM;
  const dy = resolvedOrigin.yM - origin.yM;
  return [
    resolvedOrigin,
    cleanPartDraftPoint({
      ...handle,
      xM: Math.max(0, handle.xM + dx),
      yM: handle.yM + dy,
    }),
  ];
}

export function resolveAttachedPoint(point: SizePoint, shapes: SizeShape[]): SizePoint {
  const attachment = point.snapAttachment;
  if (!attachment) return point;
  const sourceShape = isImplicitMirrorShapeId(attachment.shapeId) ? implicitMirrorShape() : shapes.find((shape) => shape.id === attachment.shapeId);
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

export function toCanvas(point: SizePoint, view: CanvasView) {
  return {
    x: view.originX + point.xM * view.scale,
    y: view.originY - point.yM * view.scale,
  };
}

export function fromCanvas(x: number, y: number, view: CanvasView): SizePoint {
  return {
    xM: (x - view.originX) / view.scale,
    yM: (view.originY - y) / view.scale,
  };
}
