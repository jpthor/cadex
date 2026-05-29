export type SizeShapeRole = "body" | "liftingSurface" | "part" | "referenceLine" | "mirrorPlane";
const implicitMirrorShapeId = "implicit-x-axis-mirror";
const legacyImplicitMirrorShapeId = "implicit-y-axis-mirror";
export type SizeDrawMode = "line" | "spline";
export type BodyMaterial = "aluminium" | "fibreglass" | "carbonFibre";
export type PartType = "payload" | "battery" | "motor" | "rotor" | "electronics";
export type LiftingSurfaceKind = "wing" | "tailplane" | "fin" | "lex";

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
  labelOffset?: SizeVector;
};

export type SizeVector = {
  xM: number;
  yM: number;
};

export type SizeCadGeometry =
  | {
      kind: "box";
      centerM: [number, number, number];
      sizeM: [number, number, number];
    }
  | {
      kind: "cylinder";
      centerM: [number, number, number];
      axisM: [number, number, number];
      radiusM: number;
      lengthM: number;
    }
  | {
      kind: "rotor";
      centerM: [number, number, number];
      axisM: [number, number, number];
      radiusM: number;
      bladeCount: number;
      rootChordM: number;
      tipChordM: number;
    }
  | {
      kind: "revolvedBody";
      centerM: [number, number, number];
      axisM?: [number, number, number];
      lengthM: number;
      radiusM: number;
      profile?: SizePoint[];
    }
  | {
      kind: "liftingSurface";
      rootLeadingEdgeM: [number, number, number];
      spanM: number;
      rootChordM: number;
      tipChordM: number;
      airfoil: string;
      incidenceDeg: number;
    };

export type SizeShape = {
  id: string;
  role: SizeShapeRole;
  label: string;
  drawMode: SizeDrawMode;
  points: SizePoint[];
  airfoil?: string;
  liftingSurfaceKind?: LiftingSurfaceKind;
  airfoilStations?: Partial<Record<"root" | "tip" | "root10" | "tip90", string>>;
  incidenceDeg?: number;
  incidenceStationsDeg?: Partial<Record<"root" | "tip" | "root10" | "tip90", number>>;
  massKg?: number;
  bodyMaterial?: BodyMaterial;
  bodyThicknessMm?: number;
  partType?: PartType;
  rotorBladeCount?: number;
  cadGeometry?: SizeCadGeometry;
  sketchViewMode?: "top" | "front" | "side";
  sideViewStationId?: string;
  zStationId?: string;
  zOffsetM?: number;
  dihedralBreakStationId?: string;
  dihedralLiftM?: number;
};

export type SizingMission = {
  aspectRatio: number;
  lengthRatio: number;
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
  sketchCanvasView?: SizingCanvasView;
  selectedShapeId: string;
  activeRole: SizeShapeRole;
  drawMode: SizeDrawMode;
  mission: SizingMission;
  analysis?: SizingAnalysis;
  components?: unknown;
  dimensions?: SizeDimension[];
};

export type SizingCanvasView = {
  width: number;
  height: number;
  originX: number;
  originY: number;
  scale: number;
};

const defaultMission: SizingMission = {
  aspectRatio: 2.8,
  lengthRatio: 0.8,
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
  rotorBladeCount: 4,
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
  fin: "Fin",
  lex: "LEX",
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
    sketchCanvasView: undefined,
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
    sketchCanvasView: normalizeCanvasView(candidate.sketchCanvasView),
    selectedShapeId: shapes.some((shape) => shape.id === candidate.selectedShapeId) ? candidate.selectedShapeId ?? "" : shapes[0]?.id ?? "",
    activeRole: normalizeRole(candidate.activeRole),
    drawMode: candidate.drawMode === "spline" ? "spline" : "line",
    mission: {
      aspectRatio: clampNumber(candidate.mission?.aspectRatio, 2.8, 2.2, 12),
      lengthRatio: clampNumber(candidate.mission?.lengthRatio, 0.8, 0.45, 2),
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

function normalizeCanvasView(value: unknown): SizingCanvasView | undefined {
  if (!value || typeof value !== "object") return undefined;
  const candidate = value as Partial<SizingCanvasView>;
  const width = positiveNumber(candidate.width, 900);
  const height = positiveNumber(candidate.height, 720);
  const scale = positiveNumber(candidate.scale, 190);
  return {
    width,
    height,
    originX: numberOr(candidate.originX, width / 2),
    originY: numberOr(candidate.originY, height * 0.1),
    scale,
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
            root: typeof shape.airfoilStations?.root === "string" ? shape.airfoilStations.root : shape.airfoilStations?.root10 ?? shape.airfoil ?? "NACA 0012",
            tip: typeof shape.airfoilStations?.tip === "string" ? shape.airfoilStations.tip : shape.airfoilStations?.tip90 ?? shape.airfoil ?? "NACA 0012",
          }
        : undefined,
    incidenceDeg: role === "liftingSurface" ? numberOr(shape.incidenceDeg, 0) : undefined,
    incidenceStationsDeg:
      role === "liftingSurface"
        ? {
            root: numberOr(shape.incidenceStationsDeg?.root, numberOr(shape.incidenceStationsDeg?.root10, numberOr(shape.incidenceDeg, 0))),
            tip: numberOr(shape.incidenceStationsDeg?.tip, numberOr(shape.incidenceStationsDeg?.tip90, numberOr(shape.incidenceDeg, 0))),
          }
        : undefined,
    massKg: optionalNumber(shape.massKg),
    bodyMaterial: role === "body" || role === "liftingSurface" ? normalizeBodyMaterial(shape.bodyMaterial) : undefined,
    bodyThicknessMm: role === "body" || role === "liftingSurface" ? optionalNumber(shape.bodyThicknessMm) : undefined,
    partType,
    rotorBladeCount: role === "part" && partType === "rotor" ? Math.max(1, Math.round(numberOr(shape.rotorBladeCount, 2))) : undefined,
    cadGeometry: normalizeCadGeometry(shape.cadGeometry),
    sketchViewMode: normalizeSketchViewMode(shape.sketchViewMode),
    sideViewStationId: normalizeShapeId(shape.sideViewStationId),
    zStationId: normalizeShapeId(shape.zStationId),
    zOffsetM: optionalNumber(shape.zOffsetM),
    dihedralBreakStationId: normalizeShapeId(shape.dihedralBreakStationId),
    dihedralLiftM: optionalNumber(shape.dihedralLiftM),
  };
}

function normalizeCadGeometry(value: unknown): SizeCadGeometry | undefined {
  if (!value || typeof value !== "object") return undefined;
  const candidate = value as Partial<SizeCadGeometry>;
  if (candidate.kind === "box" && isVec3(candidate.centerM) && isVec3(candidate.sizeM)) {
    return { kind: "box", centerM: candidate.centerM, sizeM: candidate.sizeM };
  }
  if (candidate.kind === "cylinder" && isVec3(candidate.centerM) && isVec3(candidate.axisM)) {
    return {
      kind: "cylinder",
      centerM: candidate.centerM,
      axisM: candidate.axisM,
      radiusM: positiveNumber(candidate.radiusM, 0.01),
      lengthM: positiveNumber(candidate.lengthM, 0.01),
    };
  }
  if (candidate.kind === "rotor" && isVec3(candidate.centerM) && isVec3(candidate.axisM)) {
    return {
      kind: "rotor",
      centerM: candidate.centerM,
      axisM: candidate.axisM,
      radiusM: positiveNumber(candidate.radiusM, 0.01),
      bladeCount: Math.max(1, Math.round(numberOr(candidate.bladeCount, 2))),
      rootChordM: positiveNumber(candidate.rootChordM, 0.008),
      tipChordM: positiveNumber(candidate.tipChordM, 0.004),
    };
  }
  if (candidate.kind === "revolvedBody" && isVec3(candidate.centerM)) {
    const profile = Array.isArray(candidate.profile)
      ? candidate.profile.map(normalizeProfilePoint).filter((point): point is SizePoint => Boolean(point))
      : undefined;
    return {
      kind: "revolvedBody",
      centerM: candidate.centerM,
      axisM: isVec3(candidate.axisM) ? candidate.axisM : undefined,
      lengthM: positiveNumber(candidate.lengthM, 0.01),
      radiusM: positiveNumber(candidate.radiusM, 0.005),
      profile,
    };
  }
  if (candidate.kind === "liftingSurface" && isVec3(candidate.rootLeadingEdgeM)) {
    return {
      kind: "liftingSurface",
      rootLeadingEdgeM: candidate.rootLeadingEdgeM,
      spanM: positiveNumber(candidate.spanM, 0.05),
      rootChordM: positiveNumber(candidate.rootChordM, 0.05),
      tipChordM: positiveNumber(candidate.tipChordM, 0.05),
      airfoil: typeof candidate.airfoil === "string" ? candidate.airfoil : "NACA 0012",
      incidenceDeg: numberOr(candidate.incidenceDeg, 0),
    };
  }
  return undefined;
}

function isVec3(value: unknown): value is [number, number, number] {
  return Array.isArray(value) && value.length === 3 && value.every((entry) => Number.isFinite(entry));
}

function normalizeProfilePoint(value: unknown): SizePoint | undefined {
  if (!value || typeof value !== "object") return undefined;
  const point = value as Partial<SizePoint>;
  if (!Number.isFinite(point.xM) || !Number.isFinite(point.yM)) return undefined;
  return {
    xM: numberOr(point.xM, 0),
    yM: numberOr(point.yM, 0),
    curveMode: point.curveMode === "corner" ? "corner" : "spline",
    segmentInMode: point.segmentInMode === "spline" ? "spline" : point.segmentInMode === "corner" ? "corner" : undefined,
    segmentOutMode: point.segmentOutMode === "spline" ? "spline" : point.segmentOutMode === "corner" ? "corner" : undefined,
    tangentIn: normalizeVector(point.tangentIn),
    tangentOut: normalizeVector(point.tangentOut),
    snapAttachment: normalizeSnapAttachment(point.snapAttachment),
  };
}

function positiveNumber(value: unknown, fallback: number) {
  return Math.max(numberOr(value, fallback), fallback);
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

function clampNumber(value: unknown, fallback: number, min: number, max: number) {
  return Math.min(max, Math.max(min, numberOr(value, fallback)));
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
  return value === "tailplane" || value === "fin" || value === "lex" || value === "wing" ? value : "wing";
}

function normalizeSketchViewMode(value: unknown) {
  return value === "front" || value === "side" || value === "top" ? value : undefined;
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
    const shapeId = normalizeShapeId(candidate.shapeId);
    const pointIndex = optionalNumber(candidate.pointIndex);
    return shapeId && pointIndex !== undefined ? { kind: "node", shapeId, pointIndex: Math.max(0, Math.round(pointIndex)) } : undefined;
  }
  if (candidate.kind === "segment") {
    const shapeId = normalizeShapeId(candidate.shapeId);
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
    labelOffset: normalizeVector(candidate.labelOffset),
  };
}

function normalizeDimensionTarget(value: unknown): SizeDimensionTarget | undefined {
  if (!value || typeof value !== "object") return undefined;
  const candidate = value as Partial<SizeDimensionTarget>;
  const shapeId = normalizeShapeId(candidate.shapeId);
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

function normalizeShapeId(value: unknown) {
  if (typeof value !== "string" || !value) return undefined;
  return value === legacyImplicitMirrorShapeId ? implicitMirrorShapeId : value;
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
