export type SizeShapeRole = "body" | "liftingSurface";
export type SizeDrawMode = "line" | "spline";
export type BodyMaterial = "aluminium" | "fibreglass" | "carbonFibre";

export type SizePoint = {
  xM: number;
  yM: number;
  curveMode?: "spline" | "corner";
  segmentInMode?: "spline" | "corner";
  segmentOutMode?: "spline" | "corner";
  tangentIn?: SizeVector;
  tangentOut?: SizeVector;
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
  massKg?: number;
  bodyMaterial?: BodyMaterial;
  bodyThicknessMm?: number;
};

export type SizingMission = {
  payloadKg: number;
  cruiseSpeedMS: number;
  enduranceMin: number;
  batteryEnergyDensityWhKg: number;
  motorCount: number;
};

export type SizingAnalysis = {
  totalMassKg: number;
  wingAreaM2: number;
  meanChordM: number;
  wingLoadingKgM2: number;
  com: SizePoint;
  cop: SizePoint;
  staticMarginPct: number;
  inertia: { rollKgM2: number; pitchKgM2: number; yawKgM2: number };
  clCruise: number;
  cdEstimate: number;
  liftDragRatio: number;
  thrustToWeight: number;
  stallSpeedMS: number;
  batteryRequiredWh: number;
  batteryAvailableWh: number;
  energyMarginWh: number;
  warnings: string[];
};

export type SizingProject = {
  shapes: SizeShape[];
  selectedShapeId: string;
  activeRole: SizeShapeRole;
  drawMode: SizeDrawMode;
  mission: SizingMission;
  analysis?: SizingAnalysis;
  components?: unknown;
};

const defaultMission: SizingMission = {
  payloadKg: 2,
  cruiseSpeedMS: 17,
  enduranceMin: 20,
  batteryEnergyDensityWhKg: 190,
  motorCount: 2,
};

export const roleLabels: Record<SizeShapeRole, string> = {
  body: "Body",
  liftingSurface: "Lifting surface",
};

export const bodyMaterialLabels: Record<BodyMaterial, string> = {
  aluminium: "Aluminium",
  fibreglass: "Fibreglass",
  carbonFibre: "Carbon fibre",
};

const bodyMaterialDensityKgM3: Record<BodyMaterial, number> = {
  aluminium: 2700,
  fibreglass: 1850,
  carbonFibre: 1600,
};

const defaultBodyMaterial: BodyMaterial = "carbonFibre";

export function defaultSizingProject(): SizingProject {
  return {
    shapes: [],
    selectedShapeId: "",
    activeRole: "liftingSurface" as SizeShapeRole,
    drawMode: "spline" as SizeDrawMode,
    mission: defaultMission,
  };
}

export function normalizeSizingProject(input: unknown): SizingProject {
  if (!input || typeof input !== "object") return defaultSizingProject();
  const candidate = input as Partial<SizingProject> & { components?: unknown[] };
  if (!Array.isArray(candidate.shapes)) return defaultSizingProject();
  const shapes = candidate.shapes.map(normalizeShape).filter((shape) => shape.points.length >= 2);
  if (!shapes.length || isSeedSketch(shapes)) return defaultSizingProject();
  return {
    shapes,
    selectedShapeId: candidate.selectedShapeId ?? shapes[0].id,
    activeRole: candidate.activeRole === "body" || candidate.activeRole === "liftingSurface" ? candidate.activeRole : "body",
    drawMode: candidate.drawMode === "spline" ? "spline" : "line",
    mission: {
      payloadKg: numberOr(candidate.mission?.payloadKg, 2),
      cruiseSpeedMS: numberOr(candidate.mission?.cruiseSpeedMS, 17),
      enduranceMin: numberOr(candidate.mission?.enduranceMin, 20),
      batteryEnergyDensityWhKg: numberOr(candidate.mission?.batteryEnergyDensityWhKg, 190),
      motorCount: Math.max(1, Math.round(numberOr(candidate.mission?.motorCount, 2))),
    },
    analysis: candidate.analysis,
  };
}

function isSeedSketch(shapes: SizeShape[]) {
  const ids = new Set(shapes.map((shape) => shape.id));
  return ids.has("body-fuselage") && ids.has("surface-wing") && ids.has("surface-tail");
}

export function computeSizingAnalysis(project: Pick<SizingProject, "shapes" | "mission">): SizingAnalysis {
  const bodies = project.shapes.filter((shape) => shape.role === "body");
  const lifting = project.shapes.filter((shape) => shape.role === "liftingSurface");
  const liftingStats = lifting.map(liftingSurfaceStats);
  const bodyMass = sum(bodies.map(bodyMassEstimate));
  const liftingMass = sum(lifting.map((shape) => shape.massKg ?? liftingSurfaceStats(shape).areaM2 * 1.2));
  const batteryMassKg = Math.max(project.mission.payloadKg * 0.62, 0.35);
  const totalMassKg = Math.max(project.mission.payloadKg + bodyMass + liftingMass + batteryMassKg, 0.1);
  const massItems = [
    ...bodies.map((shape) => ({ point: shapeCentroid(shape), mass: bodyMassEstimate(shape) })),
    ...lifting.map((shape) => ({ point: shapeCentroid(shape), mass: shape.massKg ?? liftingSurfaceStats(shape).areaM2 * 1.2 })),
    { point: { xM: 0, yM: 0.05 }, mass: project.mission.payloadKg },
    { point: { xM: 0, yM: -0.12 }, mass: batteryMassKg },
  ];
  const com = weightedCenter(massItems);
  const wingAreaM2 = Math.max(sum(liftingStats.map((stats) => stats.areaM2)), 0.01);
  const meanChordM = wingAreaM2 / Math.max(sum(liftingStats.map((stats) => stats.spanM)), 0.01);
  const cop = aerodynamicCenter(lifting, liftingStats);
  const staticMarginPct = ((com.yM - cop.yM) / Math.max(meanChordM, 0.01)) * 100;
  const rho = 1.225;
  const speed = Math.max(project.mission.cruiseSpeedMS, 1);
  const weightN = totalMassKg * 9.81;
  const clCruise = weightN / (0.5 * rho * speed * speed * wingAreaM2);
  const spanM = Math.max(sum(liftingStats.map((stats) => stats.spanM)), 0.1);
  const aspectRatio = (spanM * spanM) / wingAreaM2;
  const cdEstimate = 0.04 + (clCruise * clCruise) / (Math.PI * 0.74 * aspectRatio);
  const liftDragRatio = clCruise / Math.max(cdEstimate, 0.001);
  const thrustToWeight = (project.mission.motorCount * 7.2) / weightN;
  const stallSpeedMS = Math.sqrt((2 * weightN) / (rho * wingAreaM2 * 1.2));
  const batteryAvailableWh = batteryMassKg * project.mission.batteryEnergyDensityWhKg;
  const batteryRequiredWh = (totalMassKg * 95 * (project.mission.enduranceMin / 60)) / 0.72;
  const energyMarginWh = batteryAvailableWh - batteryRequiredWh;
  const inertia = inertiaEstimate(massItems, com);
  const wingLoadingKgM2 = totalMassKg / wingAreaM2;
  const warnings = [
    !lifting.length ? "Draw at least one lifting surface before trusting aero estimates." : "",
    staticMarginPct < 5 ? "Static margin is low; move mass forward or lifting area aft." : "",
    clCruise > 0.8 ? "Cruise CL is high; add lifting area or reduce mass/speed demand." : "",
    energyMarginWh < 0 ? "Battery energy margin is negative." : "",
    thrustToWeight < 0.3 ? "Thrust-to-weight is low for confident takeoff/climb." : "",
  ].filter(Boolean);

  return {
    totalMassKg,
    wingAreaM2,
    meanChordM,
    wingLoadingKgM2,
    com,
    cop,
    staticMarginPct,
    inertia,
    clCruise,
    cdEstimate,
    liftDragRatio,
    thrustToWeight,
    stallSpeedMS,
    batteryRequiredWh,
    batteryAvailableWh,
    energyMarginWh,
    warnings,
  };
}

function normalizeShape(shape: SizeShape): SizeShape {
  const role = shape.role === "liftingSurface" ? "liftingSurface" : "body";
  return {
    id: typeof shape.id === "string" ? shape.id : crypto.randomUUID(),
    role,
    label: typeof shape.label === "string" ? shape.label : roleLabels[role],
    drawMode: shape.drawMode === "spline" ? "spline" : "line",
    points: Array.isArray(shape.points)
      ? shape.points.map((point) => ({
          xM: Math.abs(numberOr(point.xM, 0)),
          yM: numberOr(point.yM, 0),
          curveMode: point.curveMode === "corner" ? "corner" : "spline",
          segmentInMode: point.segmentInMode === "spline" ? "spline" : point.segmentInMode === "corner" ? "corner" : undefined,
          segmentOutMode: point.segmentOutMode === "spline" ? "spline" : point.segmentOutMode === "corner" ? "corner" : undefined,
          tangentIn: normalizeVector(point.tangentIn),
          tangentOut: normalizeVector(point.tangentOut),
        }))
      : [],
    airfoil: role === "liftingSurface" ? shape.airfoil ?? "NACA 0012" : undefined,
    massKg: optionalNumber(shape.massKg),
    bodyMaterial: normalizeBodyMaterial(shape.bodyMaterial),
    bodyThicknessMm: optionalNumber(shape.bodyThicknessMm),
  };
}

export function shapeBounds(shape: SizeShape) {
  const xs = shape.points.map((point) => Math.abs(point.xM));
  const ys = shape.points.map((point) => point.yM);
  if (!xs.length || !ys.length) {
    return { minX: 0, maxX: 0, minY: 0, maxY: 0 };
  }
  return {
    minX: Math.min(...xs),
    maxX: Math.max(...xs),
    minY: Math.min(...ys),
    maxY: Math.max(...ys),
  };
}

function shapeCentroid(shape: SizeShape): SizePoint {
  if (!shape.points.length) return { xM: 0, yM: 0 };
  const polygon = polygonCentroid(shape.points);
  if (polygon) {
    return { xM: 0, yM: polygon.yM };
  }
  return {
    xM: 0,
    yM: sum(shape.points.map((point) => point.yM)) / shape.points.length,
  };
}

export function bodyMassEstimate(shape: SizeShape) {
  const density = bodyMaterialDensityKgM3[shape.bodyMaterial ?? defaultBodyMaterial];
  const thicknessM = Math.max(shape.bodyThicknessMm ?? 1.2, 0) / 1000;
  return bodySurfaceAreaEstimate(shape) * thicknessM * density;
}

export function bodySurfaceAreaEstimate(shape: SizeShape) {
  if (shape.points.length < 2) return 0;
  return shape.points.reduce((area, point, index) => {
    const next = shape.points[index + 1];
    if (!next) return area;
    const radiusM = (Math.abs(point.xM) + Math.abs(next.xM)) / 2;
    const segmentLengthM = Math.hypot(next.xM - point.xM, next.yM - point.yM);
    return area + segmentLengthM * 2 * Math.PI * radiusM;
  }, 0);
}

function liftingSurfaceStats(shape: SizeShape) {
  const bounds = shapeBounds(shape);
  const areaHalf = Math.max(polygonArea(shape.points), bounds.maxX * Math.max(bounds.maxY - bounds.minY, 0.02));
  const areaM2 = areaHalf * 2;
  const spanM = Math.max(bounds.maxX * 2, 0.05);
  const chordM = areaM2 / spanM;
  const center = shapeCentroid(shape);
  const aerodynamicCenterY = bounds.maxY - chordM * 0.25;
  return { areaM2, spanM, chordM, center, aerodynamicCenterY };
}

function aerodynamicCenter(shapes: SizeShape[], stats: ReturnType<typeof liftingSurfaceStats>[]) {
  if (!shapes.length) return { xM: 0, yM: 0 };
  const totalArea = Math.max(sum(stats.map((entry) => entry.areaM2)), 0.01);
  return {
    xM: 0,
    yM: sum(stats.map((entry) => entry.aerodynamicCenterY * entry.areaM2)) / totalArea,
  };
}

function weightedCenter(items: { point: SizePoint; mass: number }[]) {
  const total = Math.max(sum(items.map((item) => item.mass)), 0.1);
  return {
    xM: sum(items.map((item) => item.point.xM * item.mass)) / total,
    yM: sum(items.map((item) => item.point.yM * item.mass)) / total,
  };
}

function inertiaEstimate(items: { point: SizePoint; mass: number }[], com: SizePoint) {
  return items.reduce(
    (acc, item) => {
      const dx = item.point.xM - com.xM;
      const dy = item.point.yM - com.yM;
      acc.rollKgM2 += item.mass * dx * dx;
      acc.pitchKgM2 += item.mass * dy * dy;
      acc.yawKgM2 += item.mass * (dx * dx + dy * dy);
      return acc;
    },
    { rollKgM2: 0, pitchKgM2: 0, yawKgM2: 0 },
  );
}

function polygonArea(points: SizePoint[]) {
  if (points.length < 3) return 0;
  const area = points.reduce((total, point, index) => {
    const next = points[(index + 1) % points.length];
    return total + point.xM * next.yM - next.xM * point.yM;
  }, 0);
  return Math.abs(area) / 2;
}

function polygonCentroid(points: SizePoint[]): SizePoint | undefined {
  if (points.length < 3) return undefined;
  let crossSum = 0;
  let centroidX = 0;
  let centroidY = 0;
  for (let index = 0; index < points.length; index += 1) {
    const point = points[index];
    const next = points[(index + 1) % points.length];
    const cross = point.xM * next.yM - next.xM * point.yM;
    crossSum += cross;
    centroidX += (point.xM + next.xM) * cross;
    centroidY += (point.yM + next.yM) * cross;
  }
  if (Math.abs(crossSum) < 1e-9) return undefined;
  return {
    xM: centroidX / (3 * crossSum),
    yM: centroidY / (3 * crossSum),
  };
}

function numberOr(value: unknown, fallback: number) {
  return typeof value === "number" && Number.isFinite(value) ? value : fallback;
}

function optionalNumber(value: unknown) {
  return typeof value === "number" && Number.isFinite(value) ? value : undefined;
}

function normalizeBodyMaterial(value: unknown): BodyMaterial | undefined {
  return value === "aluminium" || value === "fibreglass" || value === "carbonFibre" ? value : undefined;
}

function normalizeVector(value: unknown): SizeVector | undefined {
  if (!value || typeof value !== "object") return undefined;
  const candidate = value as Partial<SizeVector>;
  const xM = optionalNumber(candidate.xM);
  const yM = optionalNumber(candidate.yM);
  return xM === undefined || yM === undefined ? undefined : { xM, yM };
}

function sum(values: number[]) {
  return values.reduce((total, value) => total + value, 0);
}
