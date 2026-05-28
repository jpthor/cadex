import type { BodyMaterial, LiftingSurfaceKind, SizePoint, SizeShape, SizingAnalysis, SizingProject } from "../sizingEngine";

type LiftingStats = {
  areaM2: number;
  spanM: number;
  chordM: number;
  center: SizePoint;
  aerodynamicCenterY: number;
  kind: LiftingSurfaceKind;
  effectiveness: number;
};
type AeroStats = ReturnType<typeof liftingSurfaceAeroStats>;

export const auditedSizingAssumptions = {
  mirrorAxisTouchToleranceM: 0.005,
  bodyMaterialDensityKgM3: {
    aluminium: 2700,
    fibreglass: 1850,
    carbonFibre: 1600,
  } satisfies Record<BodyMaterial, number>,
  defaultBodyMaterial: "carbonFibre" as BodyMaterial,
  lipoPackDensityKgM3: 1700,
  brushlessMotorDensityKgM3: 3200,
  carbonRotorDensityKgM3: 1600,
  batteryThicknessFractionOfSmallerDimension: 0.28,
  batteryThicknessClampM: { min: 0.012, max: 0.08 },
  motorDepthFractionOfSmallerDimension: 0.75,
  motorDepthClampM: { min: 0.015, max: 0.12 },
  rotorBladeLengthRadiusFraction: 0.92,
  rotorRootChordDiameterFraction: 0.055,
  rotorTipChordDiameterFraction: 0.028,
  rotorShellThicknessDiameterFraction: 0.003,
  rotorShellThicknessClampM: { min: 0.0008, max: 0.003 },
  liftingSurfaceEffectiveness: {
    wing: 1,
    tailplane: 0.9,
    canard: 0.85,
  } satisfies Record<LiftingSurfaceKind, number>,
  rhoKgM3: 1.225,
  hoverFigureOfMerit: 0.68,
};

export function computeSizingAnalysis(project: Pick<SizingProject, "shapes" | "mission">): SizingAnalysis {
  const bodies = project.shapes.filter((shape) => shape.role === "body");
  const lifting = project.shapes.filter((shape) => shape.role === "liftingSurface");
  const parts = project.shapes.filter((shape) => shape.role === "part");
  const liftingStats = lifting.map((shape) => liftingSurfaceStats(shape, project.shapes));
  const bodyMass = sum(bodies.map(bodyMassEstimate));
  const liftingMass = sum(lifting.map((shape) => liftingSurfaceMassEstimate(shape, project.shapes)));
  const partMass = sum(parts.map((shape) => partMassEstimate(shape, project.shapes)));
  const totalMassKg = Math.max(bodyMass + liftingMass + partMass, 0.1);
  const massItems = [
    ...bodies.map((shape) => ({ point: shapeCentroid(shape), mass: bodyMassEstimate(shape) })),
    ...lifting.map((shape) => ({ point: shapeCentroid(shape), mass: liftingSurfaceMassEstimate(shape, project.shapes) })),
    ...parts.map((shape) => ({ point: shapeCentroid(shape), mass: partMassEstimate(shape, project.shapes) })),
  ];
  const com = weightedCenter(massItems);
  const wingStats = liftingStats.filter((stats) => stats.kind === "wing");
  const tailStats = liftingStats.filter((stats) => stats.kind === "tailplane");
  const referenceStats = wingStats.length ? wingStats : liftingStats;
  const wingAreaM2 = Math.max(sum(referenceStats.map((stats) => stats.areaM2)), 0.01);
  const meanChordM = wingAreaM2 / Math.max(sum(referenceStats.map((stats) => stats.spanM)), 0.01);
  const tailplaneAreaM2 = sum(tailStats.map((stats) => stats.areaM2));
  const tailAerodynamicCenterY = weightedValue(
    tailStats.map((stats) => ({ value: stats.aerodynamicCenterY, weight: stats.areaM2 })),
    0,
  );
  const wingAerodynamicCenterY = weightedValue(
    referenceStats.map((stats) => ({ value: stats.aerodynamicCenterY, weight: stats.areaM2 })),
    0,
  );
  const tailArmM = Math.max(0, wingAerodynamicCenterY - tailAerodynamicCenterY);
  const tailVolumeCoefficient = tailplaneAreaM2 > 0 ? (tailplaneAreaM2 * tailArmM) / Math.max(wingAreaM2 * meanChordM, 0.01) : 0;
  const aeroStats = liftingStats.map((stats, index) => liftingSurfaceAeroStats(lifting[index], stats));
  const cop = neutralPoint(aeroStats, liftingStats);
  const staticMarginPct = ((com.yM - cop.yM) / Math.max(meanChordM, 0.01)) * 100;
  const rotorShapes = parts.filter((shape) => shape.partType === "rotor");
  const rotorCount = sum(rotorShapes.map((shape) => rotorInstanceCount(shape, project.shapes)));
  const rotorThrustCenter = weightedPoint(
    rotorShapes.map((shape) => ({ point: shapeCentroid(shape), weight: rotorInstanceCount(shape, project.shapes) })),
    { xM: 0, yM: 0 },
  );
  const rotorThrustLineOffsetM = rotorShapes.length ? com.yM - rotorThrustCenter.yM : 0;
  const missionTakeoffThrustToWeight = Number.isFinite(project.mission.takeoffThrustToWeight) ? project.mission.takeoffThrustToWeight : 1.4;
  const missionTailVolumeTarget = Number.isFinite(project.mission.tailVolumeTarget) ? project.mission.tailVolumeTarget : 0.55;
  const hoverThrustPerRotorN = rotorCount > 0 ? (totalMassKg * 9.80665 * Math.max(missionTakeoffThrustToWeight, 0.1)) / rotorCount : 0;
  const rotorDiskAreaM2 = sum(
    rotorShapes.map((shape) => Math.PI * Math.pow(rotorDiameterEstimate(shape, project.shapes) / 2, 2) * rotorInstanceCount(shape, project.shapes)),
  );
  const hoverPowerTotalW = rotorDiskAreaM2 > 0
    ? Math.pow(totalMassKg * 9.80665, 1.5) / Math.sqrt(2 * auditedSizingAssumptions.rhoKgM3 * rotorDiskAreaM2) / auditedSizingAssumptions.hoverFigureOfMerit
    : 0;
  const inertia = inertiaEstimate(massItems, com);
  const warnings = [
    !lifting.length ? "Draw at least one lifting surface before trusting stability markers." : "",
    lifting.length && !wingStats.length ? "No wing is marked; using all lifting surfaces as the reference wing." : "",
    staticMarginPct < 5 ? "Static margin is low; move mass forward or lifting area aft." : "",
    rotorShapes.length && rotorCount !== 2 ? "Twin-rotor tailsitter expects exactly 2 physical rotors after mirrors." : "",
    rotorShapes.length && Math.abs(rotorThrustLineOffsetM) > Math.max(meanChordM * 0.08, 0.03)
      ? "CoM is far from the rotor thrust line for hover; move mass or rotors."
      : "",
    tailStats.length && tailVolumeCoefficient < Math.max(missionTailVolumeTarget * 0.75, 0.25)
      ? "Dual empennage tail volume is low for a tailsitter; add tail area or tail arm."
      : "",
  ].filter(Boolean);

  return {
    totalMassKg,
    wingAreaM2,
    meanChordM,
    com,
    cop,
    staticMarginPct,
    tailplaneAreaM2,
    tailVolumeCoefficient,
    rotorCount,
    rotorThrustCenter,
    rotorThrustLineOffsetM,
    hoverThrustPerRotorN,
    hoverPowerTotalW,
    inertia,
    warnings,
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
  const density = auditedSizingAssumptions.bodyMaterialDensityKgM3[shape.bodyMaterial ?? auditedSizingAssumptions.defaultBodyMaterial];
  const thicknessM = Math.max(shape.bodyThicknessMm ?? 1.2, 0) / 1000;
  return bodySurfaceAreaEstimate(shape) * thicknessM * density;
}

export function liftingSurfaceMassEstimate(shape: SizeShape, shapes: SizeShape[] = []) {
  const density = auditedSizingAssumptions.bodyMaterialDensityKgM3[shape.bodyMaterial ?? auditedSizingAssumptions.defaultBodyMaterial];
  const thicknessM = Math.max(shape.bodyThicknessMm ?? 1.2, 0) / 1000;
  return liftingSurfaceSkinAreaEstimate(shape, shapes) * thicknessM * density;
}

export function partMassEstimate(shape: SizeShape, shapes: SizeShape[] = []) {
  if (shape.partType === "battery") return batteryMassEstimate(shape);
  if (shape.partType === "motor") return motorMassEstimate(shape);
  if (shape.partType === "rotor") return rotorTotalMassEstimate(shape, shapes);
  return Math.max(shape.massKg ?? 0, 0);
}

export function batteryMassEstimate(shape: SizeShape) {
  return batteryVolumeEstimate(shape) * auditedSizingAssumptions.lipoPackDensityKgM3;
}

export function batteryVolumeEstimate(shape: SizeShape) {
  return batteryPlanformAreaEstimate(shape) * inferredBatteryThicknessM(shape);
}

export function batteryPlanformAreaEstimate(shape: SizeShape) {
  if (shape.points.length < 3) return 0;
  return polygonArea(shape.points) * 2;
}

export function inferredBatteryThicknessM(shape: SizeShape) {
  const bounds = shapeBounds(shape);
  const widthM = Math.max(bounds.maxX * 2, 0);
  const lengthM = Math.max(bounds.maxY - bounds.minY, 0);
  const smallerDimensionM = Math.min(widthM || lengthM, lengthM || widthM);
  return clamp(
    smallerDimensionM * auditedSizingAssumptions.batteryThicknessFractionOfSmallerDimension,
    auditedSizingAssumptions.batteryThicknessClampM.min,
    auditedSizingAssumptions.batteryThicknessClampM.max,
  );
}

export function motorMassEstimate(shape: SizeShape) {
  return motorVolumeEstimate(shape) * auditedSizingAssumptions.brushlessMotorDensityKgM3;
}

export function motorVolumeEstimate(shape: SizeShape) {
  return motorPlanformAreaEstimate(shape) * motorLengthEstimateM(shape);
}

export function motorPlanformAreaEstimate(shape: SizeShape) {
  const diameterM = motorDiameterEstimateM(shape);
  const mirroredCount = touchesMirrorAxis(shape) ? 1 : 2;
  return Math.PI * Math.pow(diameterM / 2, 2) * mirroredCount;
}

export function inferredMotorDepthM(shape: SizeShape) {
  return motorLengthEstimateM(shape);
}

export function motorDiameterEstimateM(shape: SizeShape) {
  if (shape.partType === "motor" && shape.points.length === 2) {
    const [origin, handle] = shape.points;
    if (origin && handle) return Math.max(Math.abs(handle.xM - origin.xM) * 2, 0.01);
  }
  const bounds = shapeBounds(shape);
  return Math.max(bounds.maxX - bounds.minX, 0.01);
}

export function motorLengthEstimateM(shape: SizeShape) {
  if (shape.partType === "motor" && shape.points.length === 2) {
    const [origin, handle] = shape.points;
    if (origin && handle) return Math.max(Math.abs(handle.yM - origin.yM) * 2, 0.02);
  }
  const bounds = shapeBounds(shape);
  return Math.max(bounds.maxY - bounds.minY, 0.02);
}

export function rotorTotalMassEstimate(shape: SizeShape, shapes: SizeShape[] = []) {
  return rotorMassPerRotorEstimate(shape, shapes) * rotorInstanceCount(shape, shapes);
}

export function rotorMassPerRotorEstimate(shape: SizeShape, shapes: SizeShape[] = []) {
  return rotorVolumePerRotorEstimate(shape, shapes) * auditedSizingAssumptions.carbonRotorDensityKgM3;
}

export function rotorVolumePerRotorEstimate(shape: SizeShape, shapes: SizeShape[] = []) {
  const diameterM = rotorDiameterEstimate(shape, shapes);
  if (diameterM <= 0) return 0;
  const bladeCount = Math.max(1, Math.round(shape.rotorBladeCount ?? 2));
  const radiusM = diameterM / 2;
  const rootChordM = Math.max(diameterM * auditedSizingAssumptions.rotorRootChordDiameterFraction, 0.008);
  const tipChordM = Math.max(diameterM * auditedSizingAssumptions.rotorTipChordDiameterFraction, 0.004);
  const averageChordM = (rootChordM + tipChordM) / 2;
  const bladeLengthM = Math.max(radiusM * auditedSizingAssumptions.rotorBladeLengthRadiusFraction, 0);
  const shellThicknessM = clamp(
    diameterM * auditedSizingAssumptions.rotorShellThicknessDiameterFraction,
    auditedSizingAssumptions.rotorShellThicknessClampM.min,
    auditedSizingAssumptions.rotorShellThicknessClampM.max,
  );
  return bladeCount * bladeLengthM * averageChordM * shellThicknessM;
}

export function rotorInstanceCount(shape: SizeShape, shapes: SizeShape[] = []) {
  const localMirrorMultiplier = shapes.some((candidate) => candidate.role === "mirrorPlane" && shapeTouchesLine(shape, candidate)) ? 2 : 1;
  const originMirrorMultiplier = touchesMirrorAxis(shape) ? 1 : 2;
  return localMirrorMultiplier * originMirrorMultiplier;
}

export function rotorDiameterEstimate(shape: SizeShape, shapes: SizeShape[] = []) {
  if (shape.points.length < 2) return 0;
  if (shape.points.length === 2) return distance(shape.points[0], shape.points[1]) * 2;
  const points = rotorDiameterPoints(shape, shapes);
  const bounds = shapeBounds({ ...shape, points });
  return Math.max(bounds.maxX - bounds.minX, bounds.maxX * 2);
}

function rotorDiameterPoints(shape: SizeShape, shapes: SizeShape[]) {
  const localMirrorPlane = shapes.find((candidate) => candidate.role === "mirrorPlane" && shapeTouchesLine(shape, candidate));
  if (localMirrorPlane) return [...shape.points, ...mirrorAcrossLine(shape.points, localMirrorPlane)];
  if (touchesMirrorAxis(shape)) return [...shape.points, ...shape.points.map((point) => ({ ...point, xM: -point.xM }))];
  return shape.points;
}

export function bodySurfaceAreaEstimate(shape: SizeShape) {
  if (shape.points.length < 3) return 0;
  if (touchesMirrorAxis(shape)) return revolvedSurfaceArea(shape.points);
  const thicknessM = Math.max(shape.bodyThicknessMm ?? 1.2, 0) / 1000;
  const halfPlanformAreaM2 = polygonArea(shape.points);
  const halfPerimeterM = closedPerimeter(shape.points);
  return (halfPlanformAreaM2 * 2 + halfPerimeterM * thicknessM) * 2;
}

export function liftingSurfaceSkinAreaEstimate(shape: SizeShape, shapes: SizeShape[] = []) {
  return liftingSurfaceStats(shape, shapes).areaM2;
}

export function liftingSurfaceStats(shape: SizeShape, shapes: SizeShape[] = []): LiftingStats {
  const localMirrorPlane = shapes.find((candidate) => candidate.role === "mirrorPlane" && shapeTouchesLine(shape, candidate));
  if (localMirrorPlane) {
    const base = liftingSurfaceStats(shape);
    const mirroredShape = { ...shape, points: mirrorAcrossLine(shape.points, localMirrorPlane) };
    const mirrored = liftingSurfaceStats(mirroredShape);
    const areaM2 = base.areaM2 + mirrored.areaM2;
    const combinedBounds = shapeBounds({ ...shape, points: [...shape.points, ...mirroredShape.points] });
    return {
      ...base,
      areaM2,
      spanM: Math.max(base.spanM, mirrored.spanM, combinedBounds.maxX * 2, 0.05),
      chordM: areaM2 / Math.max(Math.max(base.spanM, mirrored.spanM, combinedBounds.maxX * 2, 0.05), 0.05),
      center: weightedPoint(
        [
          { point: base.center, weight: base.areaM2 },
          { point: mirrored.center, weight: mirrored.areaM2 },
        ],
        base.center,
      ),
      aerodynamicCenterY: weightedValue(
        [
          { value: base.aerodynamicCenterY, weight: base.areaM2 },
          { value: mirrored.aerodynamicCenterY, weight: mirrored.areaM2 },
        ],
        base.aerodynamicCenterY,
      ),
    };
  }
  const bounds = shapeBounds(shape);
  const integrated = integrateHalfPlanform(shape.points);
  const fallbackAreaHalf = Math.max(polygonArea(shape.points), (bounds.maxX - bounds.minX) * Math.max(bounds.maxY - bounds.minY, 0.02));
  const areaHalf = Math.max(integrated.areaHalfM2, fallbackAreaHalf, 0.001);
  const areaM2 = areaHalf * 2;
  const spanM = Math.max(bounds.maxX * 2, (bounds.maxX - bounds.minX) * 2, 0.05);
  const chordM = areaM2 / spanM;
  const center = shapeCentroid(shape);
  const aerodynamicCenterY = integrated.areaHalfM2 > 0 ? integrated.aerodynamicCenterY : bounds.maxY - chordM * 0.25;
  return {
    areaM2,
    spanM,
    chordM,
    center,
    aerodynamicCenterY,
    kind: shape.liftingSurfaceKind ?? "wing",
    effectiveness: auditedSizingAssumptions.liftingSurfaceEffectiveness[shape.liftingSurfaceKind ?? "wing"],
  };
}

function integrateHalfPlanform(points: SizePoint[]) {
  if (points.length < 3) return { areaHalfM2: 0, aerodynamicCenterY: 0 };
  const xs = [...new Set(points.map((point) => Math.abs(point.xM)))].sort((a, b) => a - b);
  if (xs.length < 2) return { areaHalfM2: 0, aerodynamicCenterY: 0 };
  let areaHalfM2 = 0;
  let quarterChordMoment = 0;
  for (let index = 0; index < xs.length - 1; index += 1) {
    const xA = xs[index];
    const xB = xs[index + 1];
    if (Math.abs(xB - xA) < 1e-6) continue;
    const sampleA = chordAtX(points, xA + (xB - xA) * 0.001);
    const sampleB = chordAtX(points, xB - (xB - xA) * 0.001);
    if (!sampleA || !sampleB) continue;
    const chordA = sampleA.leadingY - sampleA.trailingY;
    const chordB = sampleB.leadingY - sampleB.trailingY;
    if (chordA <= 0 || chordB <= 0) continue;
    const areaSlice = ((chordA + chordB) / 2) * (xB - xA);
    const acA = sampleA.leadingY - chordA * 0.25;
    const acB = sampleB.leadingY - chordB * 0.25;
    areaHalfM2 += areaSlice;
    quarterChordMoment += areaSlice * ((acA * chordA + acB * chordB) / Math.max(chordA + chordB, 1e-9));
  }
  return {
    areaHalfM2,
    aerodynamicCenterY: areaHalfM2 > 0 ? quarterChordMoment / areaHalfM2 : 0,
  };
}

function chordAtX(points: SizePoint[], x: number) {
  const intersections: number[] = [];
  for (let index = 0; index < points.length; index += 1) {
    const start = points[index];
    const end = points[(index + 1) % points.length];
    const x1 = Math.abs(start.xM);
    const x2 = Math.abs(end.xM);
    if (Math.abs(x2 - x1) < 1e-9) continue;
    const minX = Math.min(x1, x2);
    const maxX = Math.max(x1, x2);
    if (x < minX || x >= maxX) continue;
    const t = (x - x1) / (x2 - x1);
    intersections.push(start.yM + (end.yM - start.yM) * t);
  }
  if (intersections.length < 2) return undefined;
  intersections.sort((a, b) => a - b);
  return {
    trailingY: intersections[0],
    leadingY: intersections[intersections.length - 1],
  };
}

function liftingSurfaceAeroStats(shape: SizeShape, stats: LiftingStats) {
  const aerofoil = blendedAirfoilProperties(shape);
  return {
    ...stats,
    liftSlopeWeight: aerofoil.liftSlopePerDeg * stats.areaM2 * stats.effectiveness,
  };
}

function neutralPoint(aeroStats: AeroStats[], stats: LiftingStats[]) {
  if (!aeroStats.length) return { xM: 0, yM: 0 };
  const totalSlopeWeight = sum(aeroStats.map((entry) => entry.liftSlopeWeight));
  if (Math.abs(totalSlopeWeight) > 1e-9) {
    return {
      xM: 0,
      yM: sum(aeroStats.map((entry) => entry.aerodynamicCenterY * entry.liftSlopeWeight)) / totalSlopeWeight,
    };
  }
  const totalArea = Math.max(sum(stats.map((entry) => entry.areaM2)), 0.01);
  return {
    xM: 0,
    yM: sum(stats.map((entry) => entry.aerodynamicCenterY * entry.areaM2)) / totalArea,
  };
}

function blendedAirfoilProperties(shape: SizeShape) {
  const root = airfoilProperties(shape.airfoilStations?.root10 ?? shape.airfoil ?? "NACA 0012");
  const tip = airfoilProperties(shape.airfoilStations?.tip90 ?? shape.airfoil ?? "NACA 0012");
  return {
    liftSlopePerDeg: (root.liftSlopePerDeg + tip.liftSlopePerDeg) / 2,
  };
}

function airfoilProperties(name: string) {
  const normalized = name.toLowerCase().replace(/\s+/g, "");
  if (normalized.includes("s1223")) return { liftSlopePerDeg: 0.105 };
  if (normalized.includes("clarky")) return { liftSlopePerDeg: 0.103 };
  if (normalized.includes("mh32")) return { liftSlopePerDeg: 0.101 };
  if (normalized.includes("4412")) return { liftSlopePerDeg: 0.104 };
  if (normalized.includes("2412")) return { liftSlopePerDeg: 0.104 };
  return { liftSlopePerDeg: 0.102 };
}

function weightedCenter(items: { point: SizePoint; mass: number }[]) {
  const total = Math.max(sum(items.map((item) => item.mass)), 0.1);
  return {
    xM: sum(items.map((item) => item.point.xM * item.mass)) / total,
    yM: sum(items.map((item) => item.point.yM * item.mass)) / total,
  };
}

function weightedPoint(items: { point: SizePoint; weight: number }[], fallback: SizePoint) {
  const total = sum(items.map((item) => item.weight));
  if (total <= 1e-9) return fallback;
  return {
    xM: sum(items.map((item) => item.point.xM * item.weight)) / total,
    yM: sum(items.map((item) => item.point.yM * item.weight)) / total,
  };
}

function weightedValue(items: { value: number; weight: number }[], fallback: number) {
  const total = sum(items.map((item) => item.weight));
  return total > 1e-9 ? sum(items.map((item) => item.value * item.weight)) / total : fallback;
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

function closedPerimeter(points: SizePoint[]) {
  if (points.length < 2) return 0;
  return points.reduce((total, point, index) => {
    const next = points[(index + 1) % points.length];
    return total + Math.hypot(next.xM - point.xM, next.yM - point.yM);
  }, 0);
}

function revolvedSurfaceArea(points: SizePoint[]) {
  if (points.length < 2) return 0;
  return points.reduce((area, point, index) => {
    const next = points[(index + 1) % points.length];
    const radiusM = (Math.abs(point.xM) + Math.abs(next.xM)) / 2;
    const segmentLengthM = Math.hypot(next.xM - point.xM, next.yM - point.yM);
    return area + segmentLengthM * 2 * Math.PI * radiusM;
  }, 0);
}

function touchesMirrorAxis(shape: SizeShape) {
  return shape.points.some((point) => Math.abs(point.xM) <= auditedSizingAssumptions.mirrorAxisTouchToleranceM);
}

function shapeTouchesLine(shape: SizeShape, lineShape: SizeShape) {
  const [start, end] = lineShape.points;
  if (!start || !end) return false;
  const thresholdM = auditedSizingAssumptions.mirrorAxisTouchToleranceM;
  return shape.points.some((point) => distancePointToSegment(point, start, end) <= thresholdM) || shapeSegments(shape.points).some(([a, b]) => segmentsTouch(a, b, start, end, thresholdM));
}

function mirrorAcrossLine(points: SizePoint[], lineShape: SizeShape) {
  const [start, end] = lineShape.points;
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
  if (length <= 1e-9) return distance(point, start);
  return Math.abs(dy * point.xM - dx * point.yM + end.xM * start.yM - end.yM * start.xM) / length;
}

function distancePointToSegment(point: SizePoint, start: SizePoint, end: SizePoint) {
  const dx = end.xM - start.xM;
  const dy = end.yM - start.yM;
  const lengthSquared = dx * dx + dy * dy;
  if (lengthSquared <= 1e-9) return distance(point, start);
  const t = clamp(((point.xM - start.xM) * dx + (point.yM - start.yM) * dy) / lengthSquared, 0, 1);
  return distance(point, { xM: start.xM + dx * t, yM: start.yM + dy * t });
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

function distance(a: SizePoint, b: SizePoint) {
  return Math.hypot(a.xM - b.xM, a.yM - b.yM);
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

function clamp(value: number, min: number, max: number) {
  return Math.min(max, Math.max(min, value));
}

function sum(values: number[]) {
  return values.reduce((total, value) => total + value, 0);
}
