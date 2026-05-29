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

export type SketchAeroComputation = {
  validity: {
    lift: boolean;
    drag: boolean;
    tailVolume: boolean;
    finVolume: boolean;
    rotor: boolean;
  };
  assumptions: {
    rhoKgM3: number;
    oswaldEfficiency: number;
    parasiteCd: number;
    propulsiveEfficiency: number;
  };
  geometry: {
    wingAreaM2: number;
    wingSpanM: number;
    wingTrueSpanM: number;
    meanChordM: number;
    aspectRatio: number;
    averageDihedralDeg: number;
    tailplaneAreaM2: number;
    tailplaneArmM: number;
    finAreaM2: number;
    finArmM: number;
    lexAreaM2: number;
    rotorDiskAreaM2: number;
    dragReferenceAreaM2: number;
  };
  mass: {
    totalMassKg: number;
    wingLoadingKgM2: number;
  };
  stability: {
    centerOfMassY: number;
    centerOfPressureY: number;
    staticMarginPct: number;
    tailVolumeCoefficient: number;
    finVolumeCoefficient: number;
    rollStabilityIndex: number;
    rollStabilityLabel: string;
  };
  aerodynamics: {
    cruiseSpeedMS: number;
    cruiseSpeedKt: number;
    dynamicPressurePa: number;
    liftCoefficient: number;
    inducedDragCoefficient: number;
    parasiteDragCoefficient: number;
    dragCoefficient: number;
    liftToDrag: number;
    dragN: number;
    cruisePowerW: number;
    maxLiftCoefficientClean: number;
    maxLiftCoefficientWithLex: number;
    stallSpeedCleanMS: number;
    stallSpeedMS: number;
  };
  lex: {
    active: boolean;
    areaM2: number;
    areaRatio: number;
    deltaMaxLiftCoefficient: number;
    influencedAreaM2: number;
    influencedAreaRatio: number;
    influencedBodyAreaM2: number;
    influencedWingAreaM2: number;
    vortexStrength: number;
    stallSpeedReductionPct: number;
  };
  propulsion: {
    rotorCount: number;
    hoverThrustPerRotorN: number;
    hoverPowerTotalW: number;
    rotorDiskLoadingNpm2: number;
  };
  inertia: SizingAnalysis["inertia"];
  warnings: string[];
};

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
  batteryThicknessClampM: { min: 0.012, max: 0.028 },
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
    fin: 0.7,
    lex: 0.45,
  } satisfies Record<LiftingSurfaceKind, number>,
  tailplaneDynamicPressureRatio: 3.45,
  tailplaneDownwashGradient: 0,
  rhoKgM3: 1.225,
  hoverFigureOfMerit: 0.68,
  oswaldEfficiency: 0.75,
  parasiteCd: 0.07,
  propulsiveEfficiency: 0.72,
  maxLiftCoefficient: 1.25,
};

export function computeSizingAnalysis(project: Pick<SizingProject, "shapes" | "mission">): SizingAnalysis {
  const bodies = project.shapes.filter((shape) => shape.role === "body");
  const lifting = project.shapes.filter((shape) => shape.role === "liftingSurface");
  const parts = project.shapes.filter((shape) => shape.role === "part");
  const liftingStats = lifting.map((shape) => liftingSurfaceStats(shape, project.shapes));
  const bodyMass = sum(bodies.map((shape) => bodyMassEstimate(shape, project.shapes)));
  const liftingMass = sum(lifting.map((shape) => liftingSurfaceMassEstimate(shape, project.shapes)));
  const partMass = sum(parts.map((shape) => partMassEstimate(shape, project.shapes)));
  const totalMassKg = Math.max(bodyMass + liftingMass + partMass, 0.1);
  const massItems = [
    ...bodies.map((shape) => ({ point: shapeCentroid(shape), lateralRadiusM: shapeLateralRadiusM(shape, project.shapes), mass: bodyMassEstimate(shape, project.shapes) })),
    ...lifting.map((shape) => ({ point: shapeCentroid(shape), lateralRadiusM: shapeLateralRadiusM(shape, project.shapes), mass: liftingSurfaceMassEstimate(shape, project.shapes) })),
    ...parts.map((shape) => ({ point: shapeCentroid(shape), lateralRadiusM: shapeLateralRadiusM(shape, project.shapes), mass: partMassEstimate(shape, project.shapes) })),
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
    tailStats.length && tailVolumeCoefficient < Math.max(missionTailVolumeTarget * 0.55, 0.28)
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

export function computeSketchAerodynamics(project: Pick<SizingProject, "shapes" | "mission">): SketchAeroComputation {
  const analysis = computeSizingAnalysis(project);
  const liftingStats = project.shapes
    .filter((shape) => shape.role === "liftingSurface")
    .map((shape) => liftingSurfaceStats(shape, project.shapes));
  const wingStats = liftingStats.filter((stats) => stats.kind === "wing");
  const tailStats = liftingStats.filter((stats) => stats.kind === "tailplane");
  const finStats = liftingStats.filter((stats) => stats.kind === "fin");
  const lexStats = liftingStats.filter((stats) => stats.kind === "lex");
  const referenceStats = wingStats.length ? wingStats : liftingStats;
  const wingAreaM2 = sum(referenceStats.map((stats) => stats.areaM2));
  const wingSpanM = Math.max(0, ...referenceStats.map((stats) => stats.spanM));
  const wingDihedralStats = wingShapesDihedralStats(project.shapes);
  const wingTrueSpanM = wingDihedralStats.projectedSpanM > 0 ? wingDihedralStats.trueSpanM : wingSpanM;
  const averageDihedralDeg = wingDihedralStats.averageDihedralDeg;
  const aspectRatio = wingAreaM2 > 0 ? (wingSpanM * wingSpanM) / wingAreaM2 : 0;
  const meanChordM = wingSpanM > 0 ? wingAreaM2 / wingSpanM : 0;
  const hasAerodynamicReference = wingStats.length > 0 && wingAreaM2 > 0.02 && wingSpanM > 0.05 && aspectRatio > 0.1;
  const wingAerodynamicCenterY = weightedValue(
    referenceStats.map((stats) => ({ value: stats.aerodynamicCenterY, weight: stats.areaM2 })),
    0,
  );
  const tailAerodynamicCenterY = weightedValue(
    tailStats.map((stats) => ({ value: stats.aerodynamicCenterY, weight: stats.areaM2 })),
    wingAerodynamicCenterY,
  );
  const finAerodynamicCenterY = weightedValue(
    finStats.map((stats) => ({ value: stats.aerodynamicCenterY, weight: stats.areaM2 })),
    wingAerodynamicCenterY,
  );
  const tailplaneAreaM2 = sum(tailStats.map((stats) => stats.areaM2));
  const finAreaM2 = sum(finStats.map((stats) => stats.areaM2));
  const lexAreaM2 = sum(lexStats.map((stats) => stats.areaM2));
  const tailplaneArmM = Math.max(0, wingAerodynamicCenterY - tailAerodynamicCenterY);
  const finArmM = Math.max(0, wingAerodynamicCenterY - finAerodynamicCenterY);
  const tailVolumeCoefficient = tailplaneAreaM2 > 0
    ? (tailplaneAreaM2 * tailplaneArmM) / Math.max(wingAreaM2 * meanChordM, 0.001)
    : 0;
  const finVolumeCoefficient = finAreaM2 > 0
    ? (finAreaM2 * finArmM) / Math.max(wingAreaM2 * wingSpanM, 0.001)
    : 0;
  const rotorShapes = project.shapes.filter((shape) => shape.role === "part" && shape.partType === "rotor");
  const rotorDiskAreaM2 = sum(
    rotorShapes.map((shape) => Math.PI * Math.pow(rotorDiameterEstimate(shape, project.shapes) / 2, 2) * rotorInstanceCount(shape, project.shapes)),
  );
  const frontalAreaM2 = frontalAreaEstimate(project.shapes);
  const cruiseSpeedMS = Math.max(project.mission.cruiseSpeedMS, 0.1);
  const dynamicPressurePa = 0.5 * auditedSizingAssumptions.rhoKgM3 * cruiseSpeedMS * cruiseSpeedMS;
  const weightN = analysis.totalMassKg * 9.80665;
  const liftCoefficient = hasAerodynamicReference ? weightN / Math.max(dynamicPressurePa * wingAreaM2, 0.001) : 0;
  const dihedralLiftFactor = Math.pow(Math.cos((averageDihedralDeg * Math.PI) / 180), 2);
  const inducedFactor = hasAerodynamicReference ? 1 / (Math.PI * auditedSizingAssumptions.oswaldEfficiency * Math.max(aspectRatio * dihedralLiftFactor, 0.001)) : 0;
  const inducedDragCoefficient = inducedFactor * liftCoefficient * liftCoefficient;
  const parasiteDragCoefficient = estimateParasiteCd(project.shapes);
  const bluntDragCoefficient = estimateBluntCd(project.shapes);
  const hasDragReference = hasAerodynamicReference || frontalAreaM2 > 0.001;
  const dragReferenceAreaM2 = hasAerodynamicReference ? wingAreaM2 : frontalAreaM2;
  const dragCoefficient = hasAerodynamicReference ? parasiteDragCoefficient + inducedDragCoefficient : bluntDragCoefficient;
  const dragN = hasDragReference ? dynamicPressurePa * dragReferenceAreaM2 * dragCoefficient : 0;
  const cruisePowerW = hasDragReference ? (dragN * cruiseSpeedMS) / auditedSizingAssumptions.propulsiveEfficiency : 0;
  const maxLiftCoefficientClean = auditedSizingAssumptions.maxLiftCoefficient;
  const lexVortex = estimateLexVortex(project.shapes, lexStats, wingStats, wingAreaM2, wingAerodynamicCenterY);
  const maxLiftCoefficientWithLex = maxLiftCoefficientClean + lexVortex.deltaMaxLiftCoefficient;
  const stallSpeedCleanMS = hasAerodynamicReference
    ? Math.sqrt((2 * weightN) / Math.max(auditedSizingAssumptions.rhoKgM3 * wingAreaM2 * maxLiftCoefficientClean, 0.001))
    : 0;
  const stallSpeedMS = hasAerodynamicReference
    ? Math.sqrt((2 * weightN) / Math.max(auditedSizingAssumptions.rhoKgM3 * wingAreaM2 * maxLiftCoefficientWithLex, 0.001))
    : 0;
  const rotorDiskLoadingNpm2 = rotorDiskAreaM2 > 0 ? weightN / rotorDiskAreaM2 : 0;
  const rollStabilityIndex = hasAerodynamicReference ? averageDihedralDeg * liftCoefficient : 0;
  const rollStabilityLabel = rollStabilityFromIndex(rollStabilityIndex);
  const warnings = uniqueStrings([
    ...analysis.warnings,
    !hasAerodynamicReference ? "Draw and mark a wing before trusting CL, induced drag, L/D, static margin, or stall speed." : "",
    !hasDragReference ? "Draw a body, part, rotor, or lifting surface before trusting drag or cruise power." : "",
    hasAerodynamicReference && aspectRatio > 0 && aspectRatio < 4 ? "Low aspect ratio is costing induced drag. More span or less chord improves L/D." : "",
    liftCoefficient > 0.85 ? "Cruise CL is high. Increase wing area, reduce mass, or fly faster." : "",
    dragCoefficient > 0.13 ? "Estimated CD is high for cruise. Check rotor/boom exposure and wing aspect ratio." : "",
    hasAerodynamicReference && rollStabilityIndex < -1.5 ? "Anhedral effect is roll-destabilising. Check roll authority and hover-transition behaviour." : "",
    hasAerodynamicReference && rollStabilityIndex > 6 ? "Strong dihedral effect. Roll may be very self-righting and sluggish." : "",
    hasAerodynamicReference && finStats.length && finVolumeCoefficient < 0.025 ? "Fin volume is low. Directional stability may be weak in forward flight." : "",
    rotorShapes.length && rotorDiskLoadingNpm2 > 160 ? "Rotor disk loading is high. Hover power will be expensive." : "",
    lexStats.length && !wingStats.length ? "LEX surfaces need a marked wing before vortex-lift stall estimates are meaningful." : "",
    lexStats.length && wingStats.length && lexVortex.influencedAreaM2 <= 0.001 ? "LEX vortex corridor does not pass over downstream body or lifting area." : "",
    lexVortex.active ? "LEX vortex lift is an estimate for medium/high AoA only; validate with CFD or testing before relying on stall margin." : "",
  ].filter(Boolean));

  return {
    validity: {
      lift: hasAerodynamicReference,
      drag: hasDragReference,
      tailVolume: hasAerodynamicReference && tailplaneAreaM2 > 0 && tailplaneArmM > 0,
      finVolume: hasAerodynamicReference && finAreaM2 > 0 && finArmM > 0,
      rotor: rotorDiskAreaM2 > 0 && (analysis.rotorCount ?? 0) > 0,
    },
    assumptions: {
      rhoKgM3: auditedSizingAssumptions.rhoKgM3,
      oswaldEfficiency: auditedSizingAssumptions.oswaldEfficiency,
      parasiteCd: parasiteDragCoefficient,
      propulsiveEfficiency: auditedSizingAssumptions.propulsiveEfficiency,
    },
    geometry: {
      wingAreaM2,
      wingSpanM,
      wingTrueSpanM,
      meanChordM,
      aspectRatio,
      averageDihedralDeg,
      tailplaneAreaM2,
      tailplaneArmM,
      finAreaM2,
      finArmM,
      lexAreaM2,
      rotorDiskAreaM2,
      dragReferenceAreaM2,
    },
    mass: {
      totalMassKg: analysis.totalMassKg,
      wingLoadingKgM2: hasAerodynamicReference ? analysis.totalMassKg / Math.max(wingAreaM2, 0.001) : 0,
    },
    stability: {
      centerOfMassY: analysis.com.yM,
      centerOfPressureY: analysis.cop.yM,
      staticMarginPct: analysis.staticMarginPct,
      tailVolumeCoefficient,
      finVolumeCoefficient,
      rollStabilityIndex,
      rollStabilityLabel,
    },
    aerodynamics: {
      cruiseSpeedMS,
      cruiseSpeedKt: cruiseSpeedMS / 0.514444,
      dynamicPressurePa,
      liftCoefficient,
      inducedDragCoefficient,
      parasiteDragCoefficient,
      dragCoefficient,
      liftToDrag: dragCoefficient > 0 ? liftCoefficient / dragCoefficient : 0,
      dragN,
      cruisePowerW,
      maxLiftCoefficientClean,
      maxLiftCoefficientWithLex,
      stallSpeedCleanMS,
      stallSpeedMS,
    },
    lex: {
      active: lexVortex.active,
      areaM2: lexAreaM2,
      areaRatio: wingAreaM2 > 0 ? lexAreaM2 / wingAreaM2 : 0,
      deltaMaxLiftCoefficient: lexVortex.deltaMaxLiftCoefficient,
      influencedAreaM2: lexVortex.influencedAreaM2,
      influencedAreaRatio: wingAreaM2 > 0 ? lexVortex.influencedAreaM2 / wingAreaM2 : 0,
      influencedBodyAreaM2: lexVortex.influencedBodyAreaM2,
      influencedWingAreaM2: lexVortex.influencedWingAreaM2,
      vortexStrength: lexVortex.vortexStrength,
      stallSpeedReductionPct: stallSpeedCleanMS > 0 ? (1 - stallSpeedMS / stallSpeedCleanMS) * 100 : 0,
    },
    propulsion: {
      rotorCount: analysis.rotorCount ?? 0,
      hoverThrustPerRotorN: analysis.hoverThrustPerRotorN ?? 0,
      hoverPowerTotalW: analysis.hoverPowerTotalW ?? 0,
      rotorDiskLoadingNpm2,
    },
    inertia: analysis.inertia,
    warnings,
  };
}

function estimateLexVortex(
  shapes: SizeShape[],
  lexStats: LiftingStats[],
  wingStats: LiftingStats[],
  wingAreaM2: number,
  wingAerodynamicCenterY: number,
) {
  if (!lexStats.length || !wingStats.length || wingAreaM2 <= 0) {
    return {
      active: false,
      deltaMaxLiftCoefficient: 0,
      influencedAreaM2: 0,
      influencedBodyAreaM2: 0,
      influencedWingAreaM2: 0,
      vortexStrength: 0,
    };
  }
  const lexShapes = shapes.filter((shape) => shape.role === "liftingSurface" && shape.liftingSurfaceKind === "lex");
  const areaRatio = clamp(sum(lexStats.map((stats) => stats.areaM2)) / Math.max(wingAreaM2, 0.001), 0, 0.3);
  const corridors = lexShapes.map(lexVortexCorridor).filter((entry): entry is LexVortexCorridor => Boolean(entry));
  const influence = downstreamLexInfluence(shapes, corridors);
  const sweepStrength = weightedValue(
    lexShapes.map((shape, index) => {
      const bounds = shapeBounds(shape);
      const lateralSpanM = Math.max(bounds.maxX - bounds.minX, 0.01);
      const longitudinalRunM = Math.max(bounds.maxY - bounds.minY, 0.01);
      const slenderness = longitudinalRunM / lateralSpanM;
      const sweepFactor = clamp((slenderness - 0.55) / 1.7, 0.25, 1);
      const sharpLeadingEdgeFactor = shape.points.length <= 5 ? 1 : 0.82;
      const centerAheadOfWingFactor = shapeCentroid(shape).yM >= wingAerodynamicCenterY ? 1 : 0.55;
      return {
        value: sweepFactor * sharpLeadingEdgeFactor * centerAheadOfWingFactor,
        weight: lexStats[index]?.areaM2 ?? 0.001,
      };
    }),
    0.65,
  );
  const influencedAreaRatio = clamp(influence.weightedAreaM2 / Math.max(wingAreaM2, 0.001), 0, 0.55);
  const vortexStrength = clamp((areaRatio * 2.6 + influencedAreaRatio * 1.8) * sweepStrength, 0, 1);
  const deltaMaxLiftCoefficient = clamp(0.7 * influencedAreaRatio * vortexStrength, 0, 0.45);
  return {
    active: deltaMaxLiftCoefficient > 0.005 && influence.totalAreaM2 > 0.001,
    deltaMaxLiftCoefficient,
    influencedAreaM2: influence.totalAreaM2,
    influencedBodyAreaM2: influence.bodyAreaM2,
    influencedWingAreaM2: influence.wingAreaM2,
    vortexStrength,
  };
}

type LexVortexCorridor = {
  startX: number;
  startY: number;
  widthM: number;
};

function lexVortexCorridor(shape: SizeShape): LexVortexCorridor | undefined {
  if (shape.points.length < 3) return undefined;
  const bounds = shapeBounds(shape);
  const leadingY = Math.max(...shape.points.map((point) => point.yM));
  const leadingPoints = shape.points.filter((point) => Math.abs(point.yM - leadingY) <= 0.01);
  const apex = leadingPoints.reduce((best, point) => (Math.abs(point.xM) < Math.abs(best.xM) ? point : best), leadingPoints[0] ?? shape.points[0]);
  const halfWidthM = Math.max(bounds.maxX - bounds.minX, bounds.maxX, 0.02);
  return {
    startX: Math.max(0, Math.abs(apex.xM)),
    startY: apex.yM,
    widthM: clamp(halfWidthM * 0.45, 0.025, 0.18),
  };
}

function downstreamLexInfluence(shapes: SizeShape[], corridors: LexVortexCorridor[]) {
  const empty = { bodyAreaM2: 0, totalAreaM2: 0, weightedAreaM2: 0, wingAreaM2: 0 };
  if (!corridors.length) return empty;
  return shapes.reduce((totals, shape) => {
    const weight = lexInfluenceWeight(shape);
    if (weight <= 0 || shape.points.length < 3) return totals;
    const halfAreaM2 = sampledVortexOverlapArea(shape.points, corridors);
    const totalAreaM2 = halfAreaM2 * 2;
    totals.totalAreaM2 += totalAreaM2;
    totals.weightedAreaM2 += totalAreaM2 * weight;
    if (shape.role === "body") totals.bodyAreaM2 += totalAreaM2;
    if (shape.role === "liftingSurface" && (shape.liftingSurfaceKind ?? "wing") === "wing") totals.wingAreaM2 += totalAreaM2;
    return totals;
  }, empty);
}

function lexInfluenceWeight(shape: SizeShape) {
  if (shape.role === "body") return 0.35;
  if (shape.role !== "liftingSurface") return 0;
  const kind = shape.liftingSurfaceKind ?? "wing";
  if (kind === "wing") return 1;
  if (kind === "tailplane") return 0.45;
  return 0;
}

function sampledVortexOverlapArea(points: SizePoint[], corridors: LexVortexCorridor[]) {
  const halfPoints = points.map((point) => ({ ...point, xM: Math.abs(point.xM) }));
  const halfAreaM2 = polygonArea(halfPoints);
  if (halfAreaM2 <= 0) return 0;
  const bounds = rawPointBounds(halfPoints);
  const xSpan = Math.max(bounds.maxX - bounds.minX, 0.001);
  const ySpan = Math.max(bounds.maxY - bounds.minY, 0.001);
  const xSamples = clamp(Math.ceil(xSpan / 0.025), 8, 36);
  const ySamples = clamp(Math.ceil(ySpan / 0.025), 8, 36);
  let insideCount = 0;
  let coveredCount = 0;
  for (let xi = 0; xi < xSamples; xi += 1) {
    const xM = bounds.minX + ((xi + 0.5) / xSamples) * xSpan;
    for (let yi = 0; yi < ySamples; yi += 1) {
      const yM = bounds.minY + ((yi + 0.5) / ySamples) * ySpan;
      const point = { xM, yM };
      if (!pointInPolygon(point, halfPoints)) continue;
      insideCount += 1;
      if (corridors.some((corridor) => pointInLexVortexCorridor(point, corridor))) coveredCount += 1;
    }
  }
  return insideCount > 0 ? halfAreaM2 * (coveredCount / insideCount) : 0;
}

function pointInLexVortexCorridor(point: SizePoint, corridor: LexVortexCorridor) {
  const downstreamM = corridor.startY - point.yM;
  if (downstreamM < 0) return false;
  const centerX = corridor.startX + downstreamM * 0.12;
  const widthM = corridor.widthM + downstreamM * 0.06;
  return Math.abs(point.xM - centerX) <= widthM;
}

function wingShapesDihedralStats(shapes: SizeShape[]) {
  const wingShapes = shapes.filter((shape) => shape.role === "liftingSurface" && (shape.liftingSurfaceKind ?? "wing") === "wing");
  const panelStats = wingShapes.map((shape) => wingShapeDihedralStats(shape, shapes)).filter((stats) => stats.projectedSpanM > 0);
  const projectedSpanM = sum(panelStats.map((stats) => stats.projectedSpanM));
  const trueSpanM = sum(panelStats.map((stats) => stats.trueSpanM));
  const averageDihedralDeg = weightedValue(
    panelStats.map((stats) => ({ value: stats.dihedralDeg, weight: stats.projectedSpanM })),
    0,
  );
  return { projectedSpanM, trueSpanM, averageDihedralDeg };
}

function wingShapeDihedralStats(shape: SizeShape, shapes: SizeShape[]) {
  const bounds = shapeBounds(shape);
  const rootX = touchesMirrorAxis(shape) ? 0 : bounds.minX;
  const tipX = Math.max(bounds.maxX, rootX);
  const projectedHalfSpanM = Math.max(tipX, 0);
  const outerPanelRunM = Math.max(tipX - rootX, 0);
  if (projectedHalfSpanM <= 1e-6 || outerPanelRunM <= 1e-6) return { projectedSpanM: 0, trueSpanM: 0, dihedralDeg: 0 };
  const breakX = clamp(dihedralBreakX(shape, shapes) ?? tipX, rootX, tipX);
  const liftedRunM = Math.max(breakX - rootX, 0);
  const flatRunM = Math.max(tipX - breakX, 0);
  const centerGapM = Math.max(rootX, 0);
  const liftM = shape.dihedralLiftM ?? 0;
  const trueHalfSpanM = centerGapM + Math.hypot(liftedRunM, liftM) + flatRunM;
  const dihedralDeg = liftedRunM > 1e-6 ? Math.atan2(liftM, liftedRunM) * 180 / Math.PI : 0;
  const mirrorMultiplier = touchesMirrorAxis(shape) ? 1 : 2;
  return {
    projectedSpanM: projectedHalfSpanM * mirrorMultiplier,
    trueSpanM: trueHalfSpanM * mirrorMultiplier,
    dihedralDeg,
  };
}

function dihedralBreakX(shape: SizeShape, shapes: SizeShape[]) {
  if (shape.dihedralBreakStationId === "implicit-x-axis-mirror" || shape.dihedralBreakStationId === "implicit-y-axis-mirror") return 0;
  const station = shapes.find((candidate) => candidate.id === shape.dihedralBreakStationId);
  return station ? verticalReferenceX(station) : undefined;
}

function verticalReferenceX(shape: SizeShape) {
  const [start, end] = shape.points;
  if (!start || !end) return undefined;
  if (Math.abs(start.xM - end.xM) > Math.abs(start.yM - end.yM)) return undefined;
  return (start.xM + end.xM) / 2;
}

function rollStabilityFromIndex(index: number) {
  if (index < -1.5) return "anhedral";
  if (index < 0.5) return "neutral";
  if (index < 3.5) return "mild";
  if (index < 6) return "stable";
  return "strong";
}

function uniqueStrings(values: string[]) {
  return [...new Set(values)];
}

function estimateParasiteCd(shapes: SizeShape[]) {
  const hasRotors = shapes.some((shape) => shape.role === "part" && shape.partType === "rotor");
  const hasBooms = shapes.some((shape) => shape.role === "body" && shape.label.toLowerCase().includes("boom"));
  const hasFins = shapes.some((shape) => shape.role === "liftingSurface" && shape.liftingSurfaceKind === "fin");
  return auditedSizingAssumptions.parasiteCd + (hasRotors ? 0.01 : 0) + (hasBooms ? 0.005 : 0) + (hasFins ? 0.004 : 0);
}

function estimateBluntCd(shapes: SizeShape[]) {
  const hasBody = shapes.some((shape) => shape.role === "body");
  const hasRotor = shapes.some((shape) => shape.role === "part" && shape.partType === "rotor");
  const hasBoxPart = shapes.some((shape) => shape.role === "part" && shape.partType !== "rotor" && shape.partType !== "motor");
  const hasMotor = shapes.some((shape) => shape.role === "part" && shape.partType === "motor");
  if (hasBody && !hasBoxPart && !hasRotor) return 0.85 + (hasMotor ? 0.08 : 0);
  return 1.05 + (hasRotor ? 0.15 : 0) + (hasMotor ? 0.08 : 0);
}

function frontalAreaEstimate(shapes: SizeShape[]) {
  return sum(shapes.map((shape) => shapeFrontalAreaEstimate(shape, shapes)));
}

function shapeFrontalAreaEstimate(shape: SizeShape, shapes: SizeShape[]) {
  if (!shape.points.length || shape.role === "referenceLine" || shape.role === "mirrorPlane") return 0;
  if (shape.role === "body") {
    const bounds = shapeBounds(shape);
    return Math.PI * bounds.maxX * bounds.maxX;
  }
  if (shape.role === "liftingSurface") {
    const stats = liftingSurfaceStats(shape, shapes);
    const incidenceRad = Math.abs((shape.incidenceDeg ?? 0) * Math.PI / 180);
    return stats.areaM2 * Math.max(0.06, Math.sin(incidenceRad));
  }
  if (shape.role !== "part") return 0;
  const instanceCount = partInstanceCount(shape, shapes);
  if (shape.partType === "motor") {
    return Math.PI * Math.pow(motorDiameterEstimateM(shape) / 2, 2) * instanceCount;
  }
  if (shape.partType === "rotor") {
    const diameterM = rotorDiameterEstimate(shape, shapes);
    const bladeCount = Math.max(1, Math.round(shape.rotorBladeCount ?? 2));
    const bladeAreaM2 = diameterM * Math.max(diameterM * auditedSizingAssumptions.rotorRootChordDiameterFraction, 0.008) * 0.5;
    return bladeAreaM2 * bladeCount * rotorInstanceCount(shape, shapes);
  }
  const bounds = shapeBounds(shape);
  const widthM = touchesMirrorAxis(shape) ? bounds.maxX * 2 : Math.max(bounds.maxX - bounds.minX, 0);
  const heightM = inferredBoxHeightM(shape);
  return widthM * heightM * instanceCount;
}

function partInstanceCount(shape: SizeShape, shapes: SizeShape[]) {
  const localMirrorMultiplier = shapes.some((candidate) => mirrorPlaneAppliesToShape(shape, candidate) && shapeTouchesLine(shape, candidate)) ? 2 : 1;
  const originMirrorMultiplier = touchesMirrorAxis(shape) ? 1 : 2;
  return localMirrorMultiplier * originMirrorMultiplier;
}

function inferredBoxHeightM(shape: SizeShape) {
  const bounds = shapeBounds(shape);
  const widthM = touchesMirrorAxis(shape) ? bounds.maxX * 2 : Math.max(bounds.maxX - bounds.minX, 0);
  const lengthM = Math.max(bounds.maxY - bounds.minY, 0);
  const smallerDimensionM = Math.min(widthM || lengthM, lengthM || widthM);
  return clamp(smallerDimensionM * 0.5, 0.01, 0.18);
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

function shapeLateralRadiusM(shape: SizeShape, shapes: SizeShape[]) {
  if (!shape.points.length) return 0;
  if (shape.role === "liftingSurface") {
    return liftingSurfaceStats(shape, shapes).spanM / Math.sqrt(12);
  }
  const bounds = shapeBounds(shape);
  if (shape.role === "body" || touchesMirrorAxis(shape)) {
    return bounds.maxX / Math.sqrt(3);
  }
  const centroid = polygonCentroid(shape.points);
  if (centroid) return Math.abs(centroid.xM);
  return sum(shape.points.map((point) => Math.abs(point.xM))) / shape.points.length;
}

export function bodyMassEstimate(shape: SizeShape, shapes: SizeShape[] = []) {
  const density = auditedSizingAssumptions.bodyMaterialDensityKgM3[shape.bodyMaterial ?? auditedSizingAssumptions.defaultBodyMaterial];
  const thicknessM = Math.max(shape.bodyThicknessMm ?? 1.2, 0) / 1000;
  return bodySurfaceAreaEstimate(shape, shapes) * thicknessM * density;
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
  return clamp(
    bounds.maxX * 2,
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
  const localMirrorMultiplier = shapes.some((candidate) => mirrorPlaneAppliesToShape(shape, candidate) && shapeTouchesLine(shape, candidate)) ? 2 : 1;
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
  const localMirrorPlane = shapes.find((candidate) => mirrorPlaneAppliesToShape(shape, candidate) && shapeTouchesLine(shape, candidate));
  if (localMirrorPlane) return [...shape.points, ...mirrorAcrossLine(shape.points, localMirrorPlane)];
  if (touchesMirrorAxis(shape)) return [...shape.points, ...shape.points.map((point) => ({ ...point, xM: -point.xM }))];
  return shape.points;
}

export function bodySurfaceAreaEstimate(shape: SizeShape, shapes: SizeShape[] = []) {
  if (shape.points.length < 3) return 0;
  const localMirrorPlane = shapes.find((candidate) => mirrorPlaneAppliesToShape(shape, candidate) && shapeTouchesLine(shape, candidate));
  if (localMirrorPlane) return revolvedSurfaceAreaAroundLine(shape.points, localMirrorPlane);
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
  const localMirrorPlane = shapes.find((candidate) => mirrorPlaneAppliesToShape(shape, candidate) && shapeTouchesLine(shape, candidate));
  const isSideViewFin = (shape.liftingSurfaceKind ?? "wing") === "fin" && shape.sketchViewMode === "side";
  if (localMirrorPlane) {
    const base = liftingSurfaceStats(shape);
    const mirroredShape = { ...shape, points: mirrorAcrossLine(shape.points, localMirrorPlane) };
    const mirrored = liftingSurfaceStats(mirroredShape);
    const areaM2 = base.areaM2 + mirrored.areaM2;
    const combinedBounds = isSideViewFin
      ? rawPointBounds([...shape.points, ...mirroredShape.points])
      : shapeBounds({ ...shape, points: [...shape.points, ...mirroredShape.points] });
    const combinedSpanM = isSideViewFin
      ? Math.max(combinedBounds.maxX - combinedBounds.minX, base.spanM, mirrored.spanM, 0.05)
      : Math.max(base.spanM, mirrored.spanM, combinedBounds.maxX * 2, 0.05);
    return {
      ...base,
      areaM2,
      spanM: combinedSpanM,
      chordM: areaM2 / Math.max(combinedSpanM, 0.05),
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
  if (isSideViewFin) {
    const bounds = rawPointBounds(shape.points);
    const heightM = Math.max(bounds.maxX - bounds.minX, 0.05);
    const chordExtentM = Math.max(bounds.maxY - bounds.minY, 0.01);
    const areaM2 = Math.max(polygonArea(shape.points), heightM * chordExtentM * 0.5, 0.001);
    const chordM = areaM2 / heightM;
    const centroid = polygonCentroid(shape.points) ?? {
      xM: (bounds.minX + bounds.maxX) / 2,
      yM: (bounds.minY + bounds.maxY) / 2,
    };
    return {
      areaM2,
      spanM: heightM,
      chordM,
      center: centroid,
      aerodynamicCenterY: bounds.maxY - chordM * 0.25,
      kind: "fin",
      effectiveness: auditedSizingAssumptions.liftingSurfaceEffectiveness.fin,
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

function mirrorPlaneAppliesToShape(shape: SizeShape, plane: SizeShape) {
  if (plane.role !== "mirrorPlane" || plane.id === shape.id) return false;
  return (plane.sketchViewMode ?? "top") === (shape.sketchViewMode ?? "top");
}

function rawPointBounds(points: SizePoint[]) {
  const xs = points.map((point) => point.xM);
  const ys = points.map((point) => point.yM);
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
  const longitudinalStats = aeroStats.filter((entry) => entry.kind !== "fin");
  if (!longitudinalStats.length) return { xM: 0, yM: 0 };
  const totalSlopeWeight = sum(longitudinalStats.map(longitudinalNeutralPointWeight));
  if (Math.abs(totalSlopeWeight) > 1e-9) {
    return {
      xM: 0,
      yM: sum(longitudinalStats.map((entry) => entry.aerodynamicCenterY * longitudinalNeutralPointWeight(entry))) / totalSlopeWeight,
    };
  }
  const longitudinalFallbackStats = stats.filter((entry) => entry.kind !== "fin");
  const totalArea = Math.max(sum(longitudinalFallbackStats.map((entry) => entry.areaM2)), 0.01);
  return {
    xM: 0,
    yM: sum(longitudinalFallbackStats.map((entry) => entry.aerodynamicCenterY * entry.areaM2)) / totalArea,
  };
}

function longitudinalNeutralPointWeight(entry: AeroStats) {
  if (entry.kind !== "tailplane") return entry.liftSlopeWeight;
  const downwashFactor = clamp(1 - auditedSizingAssumptions.tailplaneDownwashGradient, 0.05, 1);
  return entry.liftSlopeWeight * auditedSizingAssumptions.tailplaneDynamicPressureRatio * downwashFactor;
}

function blendedAirfoilProperties(shape: SizeShape) {
  const root = airfoilProperties(shape.airfoilStations?.root ?? shape.airfoil ?? "NACA 0012");
  const tip = airfoilProperties(shape.airfoilStations?.tip ?? shape.airfoil ?? "NACA 0012");
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

function inertiaEstimate(items: { point: SizePoint; lateralRadiusM?: number; mass: number }[], com: SizePoint) {
  return items.reduce(
    (acc, item) => {
      const dx = item.point.xM - com.xM;
      const dy = item.point.yM - com.yM;
      const lateral = item.lateralRadiusM ?? 0;
      acc.rollKgM2 += item.mass * (dx * dx + lateral * lateral);
      acc.pitchKgM2 += item.mass * dy * dy;
      acc.yawKgM2 += item.mass * (dx * dx + lateral * lateral + dy * dy);
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

function pointInPolygon(point: SizePoint, polygon: SizePoint[]) {
  if (polygon.length < 3) return false;
  let inside = false;
  for (let index = 0, previousIndex = polygon.length - 1; index < polygon.length; previousIndex = index, index += 1) {
    const current = polygon[index];
    const previous = polygon[previousIndex];
    const crossesY = current.yM > point.yM !== previous.yM > point.yM;
    if (!crossesY) continue;
    const denominator = previous.yM - current.yM;
    if (Math.abs(denominator) <= 1e-12) continue;
    const xAtY = ((previous.xM - current.xM) * (point.yM - current.yM)) / denominator + current.xM;
    if (point.xM < xAtY) inside = !inside;
  }
  return inside;
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

function revolvedSurfaceAreaAroundLine(points: SizePoint[], lineShape: SizeShape) {
  const [start, end] = lineShape.points;
  if (!start || !end || points.length < 2) return 0;
  return points.reduce((area, point, index) => {
    const next = points[(index + 1) % points.length];
    const radiusM = (distancePointToLine(point, start, end) + distancePointToLine(next, start, end)) / 2;
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
