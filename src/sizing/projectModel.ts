export type SizeShapeRole = "body" | "liftingSurface" | "part" | "referenceLine" | "mirrorPlane";
export type SizeDrawMode = "line" | "spline";
export type BodyMaterial = "aluminium" | "fibreglass" | "carbonFibre";
export type PartType = "payload" | "battery" | "motor" | "rotor" | "electronics";
export type LiftingSurfaceKind = "wing" | "tailplane" | "canard";

export type SizePoint = {
  xM: number;
  yM: number;
  curveMode?: "spline" | "corner";
  segmentInMode?: "spline" | "corner";
  segmentOutMode?: "spline" | "corner";
  tangentIn?: SizeVector;
  tangentOut?: SizeVector;
  snapAttachment?: SizeSnapAttachment;
};

export type SizeSnapAttachment =
  | { kind: "node"; shapeId: string; pointIndex: number }
  | { kind: "segment"; shapeId: string; segmentIndex: number; t: number };

export type SizeDimensionTarget =
  | { kind: "node"; shapeId: string; pointIndex: number }
  | { kind: "segment"; shapeId: string; segmentIndex: number; t: number };

export type SizeDimension = {
  id: string;
  label: string;
  targetA: SizeDimensionTarget;
  targetB: SizeDimensionTarget;
  valueM: number;
};

export type SizeVector = {
  xM: number;
  yM: number;
};

export type SizeShape = {
  id: string;
  role: SizeShapeRole;
  label: string;
  drawMode: SizeDrawMode;
  points: SizePoint[];
  airfoil?: string;
  liftingSurfaceKind?: LiftingSurfaceKind;
  airfoilStations?: Partial<Record<"root10" | "tip90", string>>;
  incidenceDeg?: number;
  incidenceStationsDeg?: Partial<Record<"root10" | "tip90", number>>;
  massKg?: number;
  bodyMaterial?: BodyMaterial;
  bodyThicknessMm?: number;
  partType?: PartType;
  rotorBladeCount?: number;
};

export type SizingMission = {
  payloadKg: number;
  takeoffThrustToWeight: number;
  cruiseSpeedMS: number;
  enduranceMin: number;
  hoverTimeMin: number;
  reservePct: number;
  diskLoadingNpm2: number;
  cruiseLiftCoefficient: number;
  tailVolumeTarget: number;
  batteryEnergyDensityWhKg: number;
  motorCount: number;
  rotorBladeCount: number;
};

export type SizingAnalysis = {
  totalMassKg: number;
  wingAreaM2: number;
  meanChordM: number;
  com: SizePoint;
  cop: SizePoint;
  staticMarginPct: number;
  tailplaneAreaM2?: number;
  tailVolumeCoefficient?: number;
  rotorCount?: number;
  rotorThrustCenter?: SizePoint;
  rotorThrustLineOffsetM?: number;
  hoverThrustPerRotorN?: number;
  hoverPowerTotalW?: number;
  inertia: { rollKgM2: number; pitchKgM2: number; yawKgM2: number };
  warnings: string[];
};

export type SizingProject = {
  shapes: SizeShape[];
  sizingReferenceShapes?: SizeShape[];
  showSizingReference?: boolean;
  selectedShapeId: string;
  activeRole: SizeShapeRole;
  drawMode: SizeDrawMode;
  mission: SizingMission;
  analysis?: SizingAnalysis;
  components?: unknown;
  dimensions?: SizeDimension[];
};

const defaultMission: SizingMission = {
  payloadKg: 2,
  takeoffThrustToWeight: 1.4,
  cruiseSpeedMS: 17,
  enduranceMin: 20,
  hoverTimeMin: 2,
  reservePct: 20,
  diskLoadingNpm2: 65,
  cruiseLiftCoefficient: 0.55,
  tailVolumeTarget: 0.55,
  batteryEnergyDensityWhKg: 190,
  motorCount: 2,
  rotorBladeCount: 2,
};

export const roleLabels: Record<SizeShapeRole, string> = {
  body: "Body",
  liftingSurface: "Lifting surface",
  part: "Part",
  referenceLine: "Reference line",
  mirrorPlane: "Mirror plane",
};

export const bodyMaterialLabels: Record<BodyMaterial, string> = {
  aluminium: "Aluminium",
  fibreglass: "Fibreglass",
  carbonFibre: "Carbon fibre",
};

export const partTypeLabels: Record<PartType, string> = {
  payload: "Payload",
  battery: "Battery",
  motor: "Motor",
  rotor: "Rotor",
  electronics: "Electronics",
};

export const liftingSurfaceKindLabels: Record<LiftingSurfaceKind, string> = {
  wing: "Wing",
  tailplane: "Tailplane",
  canard: "Canard",
};

export function defaultSizingProject(): SizingProject {
  return {
    shapes: [],
    selectedShapeId: "",
    activeRole: "body" as SizeShapeRole,
    drawMode: "spline" as SizeDrawMode,
    mission: defaultMission,
    dimensions: [],
    sizingReferenceShapes: [],
    showSizingReference: true,
  };
}

export function normalizeSizingProject(input: unknown): SizingProject {
  if (!input || typeof input !== "object") return defaultSizingProject();
  const candidate = input as Partial<SizingProject> & { components?: unknown[] };
  if (!Array.isArray(candidate.shapes)) return defaultSizingProject();
  const normalizedShapes = candidate.shapes.map(normalizeShape).filter((shape) => shape.points.length >= 2);
  const shapes = isSeedSketch(normalizedShapes) ? [] : normalizedShapes;
  return {
    shapes,
    sizingReferenceShapes: Array.isArray(candidate.sizingReferenceShapes)
      ? candidate.sizingReferenceShapes.map(normalizeShape).filter((shape) => shape.points.length >= 2)
      : [],
    showSizingReference: candidate.showSizingReference ?? true,
    selectedShapeId: shapes.some((shape) => shape.id === candidate.selectedShapeId) ? candidate.selectedShapeId ?? "" : shapes[0]?.id ?? "",
    activeRole: normalizeRole(candidate.activeRole),
    drawMode: candidate.drawMode === "spline" ? "spline" : "line",
    mission: {
      payloadKg: numberOr(candidate.mission?.payloadKg, 2),
      takeoffThrustToWeight: numberOr(candidate.mission?.takeoffThrustToWeight, 1.4),
      cruiseSpeedMS: normalizeCruiseSpeedMS(candidate.mission?.cruiseSpeedMS),
      enduranceMin: numberOr(candidate.mission?.enduranceMin, 20),
      hoverTimeMin: numberOr(candidate.mission?.hoverTimeMin, 2),
      reservePct: numberOr(candidate.mission?.reservePct, 20),
      diskLoadingNpm2: numberOr(candidate.mission?.diskLoadingNpm2, 65),
      cruiseLiftCoefficient: numberOr(candidate.mission?.cruiseLiftCoefficient, 0.55),
      tailVolumeTarget: numberOr(candidate.mission?.tailVolumeTarget, 0.55),
      batteryEnergyDensityWhKg: numberOr(candidate.mission?.batteryEnergyDensityWhKg, 190),
      motorCount: 2,
      rotorBladeCount: normalizeRotorBladeCount(candidate.mission?.rotorBladeCount),
    },
    analysis: candidate.analysis,
    dimensions: Array.isArray(candidate.dimensions) ? candidate.dimensions.map(normalizeDimension).filter(Boolean) as SizeDimension[] : [],
  };
}

function isSeedSketch(shapes: SizeShape[]) {
  const ids = new Set(shapes.map((shape) => shape.id));
  return ids.has("body-fuselage") && ids.has("surface-wing") && ids.has("surface-tail");
}

function normalizeShape(shape: SizeShape): SizeShape {
  const role = normalizeRole(shape.role);
  const partType = role === "part" ? normalizePartType(shape.partType) : undefined;
  const points: SizePoint[] = Array.isArray(shape.points)
    ? shape.points.map((point) => ({
        xM: Math.abs(numberOr(point.xM, 0)),
        yM: numberOr(point.yM, 0),
        curveMode: point.curveMode === "corner" ? "corner" : "spline",
        segmentInMode: point.segmentInMode === "spline" ? "spline" : point.segmentInMode === "corner" ? "corner" : undefined,
        segmentOutMode: point.segmentOutMode === "spline" ? "spline" : point.segmentOutMode === "corner" ? "corner" : undefined,
        tangentIn: normalizeVector(point.tangentIn),
        tangentOut: normalizeVector(point.tangentOut),
        snapAttachment: normalizeSnapAttachment(point.snapAttachment),
      }))
    : [];
  return {
    id: typeof shape.id === "string" ? shape.id : crypto.randomUUID(),
    role,
    label: typeof shape.label === "string" ? shape.label : roleLabels[role],
    drawMode: shape.drawMode === "spline" ? "spline" : "line",
    points: partType === "rotor" ? normalizeRotorSpanPoints(points) : points,
    airfoil: role === "liftingSurface" ? shape.airfoil ?? "NACA 0012" : undefined,
    liftingSurfaceKind: role === "liftingSurface" ? normalizeLiftingSurfaceKind(shape.liftingSurfaceKind) : undefined,
    airfoilStations:
      role === "liftingSurface"
        ? {
            root10: typeof shape.airfoilStations?.root10 === "string" ? shape.airfoilStations.root10 : shape.airfoil ?? "NACA 0012",
            tip90: typeof shape.airfoilStations?.tip90 === "string" ? shape.airfoilStations.tip90 : shape.airfoil ?? "NACA 0012",
          }
        : undefined,
    incidenceDeg: role === "liftingSurface" ? numberOr(shape.incidenceDeg, 0) : undefined,
    incidenceStationsDeg:
      role === "liftingSurface"
        ? {
            root10: numberOr(shape.incidenceStationsDeg?.root10, numberOr(shape.incidenceDeg, 0)),
            tip90: numberOr(shape.incidenceStationsDeg?.tip90, numberOr(shape.incidenceDeg, 0)),
          }
        : undefined,
    massKg: optionalNumber(shape.massKg),
    bodyMaterial: role === "body" || role === "liftingSurface" ? normalizeBodyMaterial(shape.bodyMaterial) : undefined,
    bodyThicknessMm: role === "body" || role === "liftingSurface" ? optionalNumber(shape.bodyThicknessMm) : undefined,
    partType,
    rotorBladeCount: role === "part" && partType === "rotor" ? Math.max(1, Math.round(numberOr(shape.rotorBladeCount, 2))) : undefined,
  };
}

function normalizeRotorSpanPoints(points: SizePoint[]) {
  if (points.length < 2) return points;
  if (points.length > 2) {
    const xs = points.map((point) => Math.abs(point.xM));
    const ys = points.map((point) => point.yM);
    const minX = Math.min(...xs);
    const maxX = Math.max(...xs);
    const centerY = (Math.min(...ys) + Math.max(...ys)) / 2;
    return [
      normalizeRotorPoint({ xM: minX, yM: centerY }),
      normalizeRotorPoint({ xM: maxX, yM: centerY }),
    ];
  }
  const start = normalizeRotorPoint(points[0]);
  const span = Math.max(Math.abs(points[1].xM - start.xM), 0.01);
  const endX = points[1].xM >= start.xM ? start.xM + span : Math.max(0, start.xM - span);
  return [start, normalizeRotorPoint({ ...points[1], xM: endX, yM: start.yM })];
}

function normalizeRotorPoint(point: Pick<SizePoint, "xM" | "yM"> & Partial<SizePoint>): SizePoint {
  return {
    ...point,
    xM: Math.abs(numberOr(point.xM, 0)),
    yM: numberOr(point.yM, 0),
    curveMode: "corner",
    segmentInMode: "corner",
    segmentOutMode: "corner",
    tangentIn: undefined,
    tangentOut: undefined,
  };
}

function numberOr(value: unknown, fallback: number) {
  return typeof value === "number" && Number.isFinite(value) ? value : fallback;
}

function normalizeCruiseSpeedMS(value: unknown) {
  const cruiseSpeedMS = numberOr(value, 17);
  return cruiseSpeedMS <= 1.000001 ? 17 : cruiseSpeedMS;
}

function optionalNumber(value: unknown) {
  return typeof value === "number" && Number.isFinite(value) ? value : undefined;
}

function normalizeRotorBladeCount(value: unknown) {
  const bladeCount = Math.round(numberOr(value, 2));
  return bladeCount === 3 || bladeCount === 4 ? bladeCount : 2;
}

function normalizeBodyMaterial(value: unknown): BodyMaterial | undefined {
  return value === "aluminium" || value === "fibreglass" || value === "carbonFibre" ? value : undefined;
}

function normalizePartType(value: unknown): PartType {
  return value === "battery" || value === "motor" || value === "rotor" || value === "electronics" || value === "payload" ? value : "payload";
}

function normalizeLiftingSurfaceKind(value: unknown): LiftingSurfaceKind {
  return value === "tailplane" || value === "canard" || value === "wing" ? value : "wing";
}

function normalizeRole(value: unknown): SizeShapeRole {
  return value === "body" || value === "liftingSurface" || value === "part" || value === "referenceLine" || value === "mirrorPlane"
    ? value
    : "body";
}

function normalizeVector(value: unknown): SizeVector | undefined {
  if (!value || typeof value !== "object") return undefined;
  const candidate = value as Partial<SizeVector>;
  const xM = optionalNumber(candidate.xM);
  const yM = optionalNumber(candidate.yM);
  return xM === undefined || yM === undefined ? undefined : { xM, yM };
}

function normalizeSnapAttachment(value: unknown): SizeSnapAttachment | undefined {
  if (!value || typeof value !== "object") return undefined;
  const candidate = value as Partial<SizeSnapAttachment>;
  if (candidate.kind === "node") {
    const shapeId = typeof candidate.shapeId === "string" ? candidate.shapeId : undefined;
    const pointIndex = optionalNumber(candidate.pointIndex);
    return shapeId && pointIndex !== undefined ? { kind: "node", shapeId, pointIndex: Math.max(0, Math.round(pointIndex)) } : undefined;
  }
  if (candidate.kind === "segment") {
    const shapeId = typeof candidate.shapeId === "string" ? candidate.shapeId : undefined;
    const segmentIndex = optionalNumber(candidate.segmentIndex);
    const t = optionalNumber(candidate.t);
    return shapeId && segmentIndex !== undefined && t !== undefined
      ? { kind: "segment", shapeId, segmentIndex: Math.max(0, Math.round(segmentIndex)), t: Math.min(1, Math.max(0, t)) }
      : undefined;
  }
  return undefined;
}

function normalizeDimension(value: unknown): SizeDimension | undefined {
  if (!value || typeof value !== "object") return undefined;
  const candidate = value as Partial<SizeDimension>;
  const targetA = normalizeDimensionTarget(candidate.targetA);
  const targetB = normalizeDimensionTarget(candidate.targetB);
  const valueM = optionalNumber(candidate.valueM);
  if (!targetA || !targetB || valueM === undefined || valueM <= 0) return undefined;
  return {
    id: typeof candidate.id === "string" ? candidate.id : crypto.randomUUID(),
    label: typeof candidate.label === "string" ? candidate.label : "Dimension",
    targetA,
    targetB,
    valueM,
  };
}

function normalizeDimensionTarget(value: unknown): SizeDimensionTarget | undefined {
  if (!value || typeof value !== "object") return undefined;
  const candidate = value as Partial<SizeDimensionTarget>;
  const shapeId = typeof candidate.shapeId === "string" ? candidate.shapeId : undefined;
  if (!shapeId) return undefined;
  if (candidate.kind === "node") {
    const pointIndex = optionalNumber(candidate.pointIndex);
    return pointIndex === undefined ? undefined : { kind: "node", shapeId, pointIndex: Math.max(0, Math.round(pointIndex)) };
  }
  if (candidate.kind === "segment") {
    const segmentIndex = optionalNumber(candidate.segmentIndex);
    const t = optionalNumber(candidate.t);
    return segmentIndex === undefined || t === undefined
      ? undefined
      : { kind: "segment", shapeId, segmentIndex: Math.max(0, Math.round(segmentIndex)), t: Math.min(1, Math.max(0, t)) };
  }
  return undefined;
}

export {
  auditedSizingAssumptions,
  batteryMassEstimate,
  batteryPlanformAreaEstimate,
  batteryVolumeEstimate,
  bodyMassEstimate,
  bodySurfaceAreaEstimate,
  computeSizingAnalysis,
  inferredBatteryThicknessM,
  inferredMotorDepthM,
  liftingSurfaceMassEstimate,
  liftingSurfaceSkinAreaEstimate,
  motorMassEstimate,
  motorPlanformAreaEstimate,
  motorVolumeEstimate,
  partMassEstimate,
  rotorDiameterEstimate,
  rotorInstanceCount,
  rotorMassPerRotorEstimate,
  rotorTotalMassEstimate,
  rotorVolumePerRotorEstimate,
  shapeBounds,
} from "./auditedSizingEngine.ts";
