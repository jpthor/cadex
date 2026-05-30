import type { PropulsionTabState } from "./app/types";
import { batterySamples, computePropulsionSizing, motorSamples, propellerSamples, rotorDefinitionFromSizing } from "./propulsionEngine.ts";
import type { PropellerSample, RotorDefinition } from "./propulsionEngine";
import { defaultTurbineCount, turbineEngineOptions } from "./sketch/constants.ts";
import type { TurbineEngineOption, TurbinePerformancePoint } from "./sketch/constants";
import { computeSketchAerodynamics } from "./sizing/index.ts";
import type { SizingProject, SketchAeroComputation } from "./sizing";

const gravity = 9.80665;
const metersPerSecondPerKnot = 0.514444;
const fullCellVoltage = 4.2;
const nominalCellVoltage = 3.7;
const emptyCellVoltage = 3.3;
const minimumFlightSpeedMargin = 1.2;

export type JetComparisonInput = {
  aircraftMassKg: number;
  batteryEnergyDensityWhKg: number;
  commandPct?: number;
  propulsionState: PropulsionTabState;
  sizingProject: SizingProject;
};

export type JetCondition = {
  aircraftMassKg: number;
  batteryCurrentA: number;
  batteryPowerW: number;
  batteryEnduranceMin: number;
  commandPct: number;
  enduranceMin: number;
  enduranceLimiter: "battery" | "fuel" | "none";
  fuelEfficiencyFactor: number;
  fuelEnduranceMin: number;
  fuelBurnKgMin: number;
  flyable: boolean;
  jetThrustN: number;
  minimumFlyableSpeedKt: number;
  motorCurrentA: number;
  motorPowerW: number;
  pitchOverspeedPct: number;
  pitchSpeedKt: number;
  propThrustN: number;
  rangeNm: number;
  speedKt: number;
  totalThrustN: number;
};

export type IntelligentJetCondition = JetCondition & {
  balanceErrorPct: number;
  balanceStatus: "matched" | "idle-limited" | "max-limited" | "no-battery-draw";
  desiredFuelBurnKgMin: number;
  fuelCommandPct: number;
  propCommandPct: number;
};

export type BaseCruiseCondition = {
  commandPct: number;
  enduranceMin: number;
  flyable: boolean;
  minimumFlyableSpeedKt: number;
  powerPct: number;
  powerW: number;
  rangeNm: number;
  speedKt: number;
};

export type RelativeGain = {
  delta: number;
  pct: number | null;
};

export type EnduranceAssistPoint = {
  batteryEnduranceMin: number;
  batteryPowerW: number;
  commandPct: number;
  enduranceMin: number;
  enduranceLimiter: "battery" | "fuel" | "none";
  flyable: boolean;
  fuelBurnKgMin: number;
  fuelEnduranceMin: number;
  jetThrustN: number;
  minimumFlyableSpeedKt: number;
  propCommandPct: number;
  propPowerW: number;
  propThrustN: number;
  rangeNm: number;
  speedKt: number;
};

export type IJetCommandMixPoint = {
  baselineEnduranceMin: number;
  baselineJetCommandPct: number;
  baselinePropCommandPct: number;
  baselineRangeNm: number;
  baselineSpeedKt: number;
  enduranceGainPct: number | null;
  enduranceMin: number;
  jetCommandPct: number;
  jetThrustN: number;
  masterCommandPct: number;
  mode: "idle" | "optimized" | "prop-capped";
  propCommandPct: number;
  propThrustN: number;
  rangeGainPct: number | null;
  rangeNm: number;
  speedGainPct: number | null;
  speedKt: number;
  targetThrustN: number;
  totalThrustN: number;
};

export type JetComparison = {
  aircraftMassKg: number;
  batteryCapacityAh: number;
  batteryMassKg: number;
  batteryName: string;
  batteryVoltageNominalV: number;
  baseCruise: BaseCruiseCondition;
  bestRangeCommand: JetCondition;
  bestRangeSweep: JetCondition[];
  commandThrust: Array<{ commandPct: number; hybrid: JetCondition; motor: JetCondition }>;
  dryMassKg: number;
  engine: TurbineEngineOption;
  engineCount: number;
  engineMassKg: number;
  basicEmptyWeight: {
    propOnlyKg: number;
    hybridKg: number;
  };
  baseAircraftMassKg: number;
  fuelMassKg: number;
  fuelMinutesAtFullCommand: number;
  fullFuelMassKg: number;
  installedJetPayloadKg: number;
  enduranceAssistBest: EnduranceAssistPoint;
  enduranceAssistSweep: EnduranceAssistPoint[];
  iJetOptimizedCommandCurve: IJetCommandMixPoint[];
  iJetBestRangeCommand: IntelligentJetCondition;
  iJetSweep: IntelligentJetCondition[];
  propOnlyMassKg: number;
  takeoffState: {
    batterySocPct: number;
    fuelPct: number;
    massKg: number;
    propOnlyMassKg: number;
    propOnlyThrustToWeight: number;
    hybridThrustToWeight: number;
    propOnlyExcessMarginPct: number;
    hybridExcessMarginPct: number;
  };
  landing: {
    batterySocPct: number;
    fuelPct: number;
    massKg: number;
    propOnlyMassKg: number;
    propOnlyThrustToWeight: number;
    hybridThrustToWeight: number;
    propOnlyExcessMarginPct: number;
    hybridExcessMarginPct: number;
  };
  feasibility: {
    hybridHoverThrustToWeight: number;
    hybridTakeoffThrustToWeight: number;
    hybridThrustDeficitN: number;
    propOnlyHoverThrustToWeight: number;
    propOnlyThrustDeficitN: number;
    requiredHoverThrustN: number;
    requiredTakeoffThrustN: number;
    targetThrustToWeight: number;
  };
  propFullBatteryThrustN: number;
  propFullPitchSpeedKt: number;
  propNominalThrustN: number;
  propOnlyBestRangeCommand: JetCondition;
  selectedCommand: {
    condition: JetCondition;
    gainsVsBaseCruise: { enduranceMin: RelativeGain; rangeNm: RelativeGain; speedKt: RelativeGain };
    gainsVsMotorReference: { enduranceMin: RelativeGain; rangeNm: RelativeGain; speedKt: RelativeGain };
    motorReference: JetCondition;
  };
  takeoff: { requiredThrustN: number; propOnlyRequiredThrustN: number; withJet: JetCondition; withoutJet: JetCondition };
  thrustCurve: Array<{ batteryPct: number; fuelPct: number; massKg: number; propOnlyTW: number; hybridTW: number }>;
  turbineCurve: Array<{ commandPct: number; fuelFlowPct: number; fuelPerThrustFactor: number }>;
};

export function computeJetComparison(input: JetComparisonInput): JetComparison {
  const rotorDefinition = rotorDefinitionFromSizing(input.sizingProject);
  const motorCount = Math.max(1, rotorDefinition.count);
  const selectedBattery = batterySamples.find((battery) => battery.id === input.propulsionState.selectedBatteryId) ?? batterySamples[0];
  const engine = turbineEngineOptions.find((candidate) => candidate.id === input.sizingProject.mission.turbineEngineId) ?? turbineEngineOptions[0];
  const engineCount = defaultTurbineCount;
  const fuelMinutesAtFullCommand = Math.max(input.sizingProject.mission.turbineFuelMin, 0);
  const fullFuelMassKg = engine.fuelKgPerMin * fuelMinutesAtFullCommand * engineCount;
  const reservePct = Math.max(input.sizingProject.mission.reservePct, 0);
  const usableReserveFraction = Math.max(0, 1 - reservePct / 100);
  const engineMassKg = engine.engineWeightKg * engineCount;
  const baseAircraftMassKg = Math.max(input.aircraftMassKg, 0.1);
  const sizingPayloadKg = Math.max(input.sizingProject.mission.payloadKg, 0);
  const turbinePackageMassKg = engineMassKg + fullFuelMassKg;
  const installedJetPayloadKg = sizingPayloadKg + turbinePackageMassKg;
  const propOnlyMassKg = baseAircraftMassKg;
  const grossMassKg = Math.max(baseAircraftMassKg + turbinePackageMassKg, 0.1);
  const dryMassKg = Math.max(grossMassKg - fullFuelMassKg, 0.1);
  const basicEmptyWeight = {
    propOnlyKg: Math.max(propOnlyMassKg - sizingPayloadKg, 0.1),
    hybridKg: Math.max(baseAircraftMassKg - sizingPayloadKg + engineMassKg, 0.1),
  };
  const propulsion = computeSelectedPropulsion(input, rotorDefinition);
  const aero = computeSketchAerodynamics(input.sizingProject);
  const batteryCapacityAh = Math.max(selectedBattery.capacityAh, 0);
  const batteryUsableEnergyWh = selectedBattery.cells * nominalCellVoltage * batteryCapacityAh * usableReserveFraction;
  const baseCruise = computeBaseCruiseCondition({
    aero,
    aircraftMassKg: propOnlyMassKg,
    cruisePropEfficiency: propulsion.cruisePropEfficiency,
    loadedRpm: propulsion.loadedRpm,
    pitchSpeedMS: propulsion.pitchSpeedMS,
    propFullPowerW: propulsion.fullBatteryPowerPerMotorW * motorCount,
    propeller: propulsion.propeller,
    usableEnergyWh: batteryUsableEnergyWh,
  });
  const takeoffRequiredThrustN = grossMassKg * gravity * Math.max(input.propulsionState.targetThrustToWeight, 0.1);
  const propOnlyTakeoffRequiredThrustN = propOnlyMassKg * gravity * Math.max(input.propulsionState.targetThrustToWeight, 0.1);
  const takeoff = {
    requiredThrustN: takeoffRequiredThrustN,
    propOnlyRequiredThrustN: propOnlyTakeoffRequiredThrustN,
    withoutJet: solveCondition({
      aircraftMassKg: propOnlyMassKg,
      batteryCapacityAh,
      commandSource: "takeoff",
      engine,
      engineCount,
      fuelMassKg: 0,
      motorCount,
      propFullCurrentPerMotorA: propulsion.fullBatteryCurrentPerMotorA,
      propFullPowerPerMotorW: propulsion.fullBatteryPowerPerMotorW,
      propFullThrustN: propulsion.fullBatteryThrustN,
      requiredThrustN: propOnlyTakeoffRequiredThrustN,
      usableReserveFraction,
      speedKt: 0,
      useJet: false,
    }),
    withJet: solveCondition({
      aircraftMassKg: grossMassKg,
      batteryCapacityAh,
      commandSource: "takeoff",
      engine,
      engineCount,
      fuelMassKg: fullFuelMassKg * usableReserveFraction,
      motorCount,
      propFullCurrentPerMotorA: propulsion.fullBatteryCurrentPerMotorA,
      propFullPowerPerMotorW: propulsion.fullBatteryPowerPerMotorW,
      propFullThrustN: propulsion.fullBatteryThrustN,
      requiredThrustN: takeoffRequiredThrustN,
      usableReserveFraction,
      speedKt: 0,
      useJet: true,
    }),
  };
  const hybridCommandConfig = {
    aircraftMassKg: grossMassKg,
    aero,
    batteryCapacityAh,
    engine,
    engineCount,
    fuelMassKg: fullFuelMassKg * usableReserveFraction,
    motorCount,
    cruisePropEfficiency: propulsion.cruisePropEfficiency,
    propFullCurrentPerMotorA: propulsion.fullBatteryCurrentPerMotorA,
    propFullPowerPerMotorW: propulsion.fullBatteryPowerPerMotorW,
    propFullThrustN: propulsion.fullBatteryThrustN,
    loadedPeakEfficiencySpeedMS: propulsion.loadedPeakEfficiencySpeedMS,
    usableReserveFraction,
  };
  const motorCommandConfig = {
    ...hybridCommandConfig,
    aircraftMassKg: propOnlyMassKg,
    fuelMassKg: 0,
  };
  const buildCommandPoint = (command: number) => ({
    commandPct: command * 100,
    motor: solveCommandCondition({
      ...motorCommandConfig,
      command,
      pitchSpeedKt: propulsion.fullPitchSpeedKt,
      useJet: false,
    }),
    hybrid: solveCommandCondition({
      ...hybridCommandConfig,
      command,
      pitchSpeedKt: propulsion.fullPitchSpeedKt,
      useJet: true,
    }),
  });
  const commandThrust = [1, 0.8, 0.5, 0.3, 0.1].map(buildCommandPoint);
  const propOnlyBestRangeCommand = commandThrust.reduce((best, point) => (point.motor.rangeNm > best.rangeNm ? point.motor : best), commandThrust[0].motor);
  const bestRangeSweep = Array.from({ length: 19 }, (_, index) => buildCommandPoint((10 + index * 5) / 100).hybrid);
  const bestRangeCommand = bestRangeSweep.reduce((best, point) => (point.rangeNm > best.rangeNm ? point : best), bestRangeSweep[0]);
  const iJetSweep = Array.from({ length: 10 }, (_, index) =>
    solveIntelligentJetCondition({
      ...hybridCommandConfig,
      propCommand: (10 + index * 10) / 100,
      pitchSpeedKt: propulsion.fullPitchSpeedKt,
    }),
  );
  const iJetBestRangeCommand = iJetSweep.reduce((best, point) => (point.rangeNm > best.rangeNm ? point : best), iJetSweep[0]);
  const enduranceTargetSpeedKt = Math.max(baseCruise.speedKt, stallSpeedForMassKt(aero, grossMassKg) * minimumFlightSpeedMargin);
  const enduranceAssistSweep = Array.from({ length: 21 }, (_, index) =>
    solveEnduranceAssistPoint({
      ...hybridCommandConfig,
      fuelMassKg: fullFuelMassKg * usableReserveFraction,
      jetCommand: index / 20,
      pitchSpeedKt: propulsion.fullPitchSpeedKt,
      propFullPowerW: propulsion.fullBatteryPowerPerMotorW * motorCount,
      speedKt: enduranceTargetSpeedKt,
    }),
  );
  const enduranceAssistBest = enduranceAssistSweep.reduce(
    (best, point) => (point.enduranceMin > best.enduranceMin ? point : best),
    enduranceAssistSweep[0],
  );
  const fullPropCurrentTotalA = propulsion.fullBatteryCurrentPerMotorA * motorCount;
  const batteryCurrentLimitA = batteryCapacityAh * selectedBattery.cRating;
  const propCapCommand = fullPropCurrentTotalA > 0 ? Math.min(1, Math.cbrt(Math.min(fullPropCurrentTotalA, batteryCurrentLimitA) / fullPropCurrentTotalA)) : 1;
  const enduranceSplitRatio = enduranceAssistBest.propCommandPct > 0 ? enduranceAssistBest.commandPct / enduranceAssistBest.propCommandPct : 0;
  const iJetRawOptimizedCommandCurve = Array.from({ length: 11 }, (_, index) =>
    solveOptimizedIJetCommandPoint({
      ...hybridCommandConfig,
      baselineSplitRatio: enduranceSplitRatio,
      masterCommand: index / 10,
      pitchSpeedKt: propulsion.fullPitchSpeedKt,
      propCapCommand,
    }),
  );
  const iJetOptimizedCommandCurve = smoothIJetCommandCurve({
    ...hybridCommandConfig,
    points: iJetRawOptimizedCommandCurve,
    pitchSpeedKt: propulsion.fullPitchSpeedKt,
  });
  const selectedCommandPct = input.commandPct ?? baseCruise.commandPct;
  const selectedCommandValue = Math.min(1, Math.max(0, selectedCommandPct / 100));
  const selectedCommandPoint = buildCommandPoint(selectedCommandValue);
  const selectedCommand = {
    condition: selectedCommandPoint.hybrid,
    gainsVsBaseCruise: {
      enduranceMin: relativeGain(selectedCommandPoint.hybrid.enduranceMin, baseCruise.enduranceMin),
      rangeNm: relativeGain(selectedCommandPoint.hybrid.rangeNm, baseCruise.rangeNm),
      speedKt: relativeGain(selectedCommandPoint.hybrid.speedKt, baseCruise.speedKt),
    },
    gainsVsMotorReference: {
      enduranceMin: relativeGain(selectedCommandPoint.hybrid.enduranceMin, selectedCommandPoint.motor.enduranceMin),
      rangeNm: relativeGain(selectedCommandPoint.hybrid.rangeNm, selectedCommandPoint.motor.rangeNm),
      speedKt: relativeGain(selectedCommandPoint.hybrid.speedKt, selectedCommandPoint.motor.speedKt),
    },
    motorReference: selectedCommandPoint.motor,
  };
  const takeoffBatteryPct = 100;
  const takeoffFuelPct = 100;
  const takeoffMassKg = grossMassKg;
  const takeoffFullPropThrustN = propulsion.fullBatteryThrustN;
  const takeoffFullJetThrustN = turbinePerformanceAtCommand(engine, 1).thrustN * engineCount;
  const takeoffTargetTW = Math.max(input.propulsionState.targetThrustToWeight, 0.1);
  const takeoffPropOnlyThrustToWeight = takeoffFullPropThrustN / Math.max(propOnlyMassKg * gravity, 0.001);
  const takeoffHybridThrustToWeight = (takeoffFullPropThrustN + takeoffFullJetThrustN) / Math.max(takeoffMassKg * gravity, 0.001);
  const requiredHoverThrustN = takeoffMassKg * gravity;
  const requiredTakeoffThrustN = takeoffMassKg * gravity * takeoffTargetTW;
  const maxHybridThrustN = takeoffFullPropThrustN + takeoffFullJetThrustN;
  const landingBatteryPct = reservePct;
  const landingFuelPct = reservePct;
  const landingMassKg = dryMassKg + fullFuelMassKg * (landingFuelPct / 100);
  const propOnlyLandingMassKg = propOnlyMassKg;
  const landingPropThrustN = propAvailableThrustAtBattery(propulsion.nominalThrustN, landingBatteryPct);
  const landingJetThrustN = landingFuelPct > 0 ? turbinePerformanceAtCommand(engine, 1).thrustN * engineCount : 0;
  const landingTargetTW = Math.max(input.propulsionState.targetThrustToWeight, 0.1);
  const propOnlyThrustToWeight = landingPropThrustN / Math.max(propOnlyLandingMassKg * gravity, 0.001);
  const hybridThrustToWeight = (landingPropThrustN + landingJetThrustN) / Math.max(landingMassKg * gravity, 0.001);
  return {
    aircraftMassKg: grossMassKg,
    batteryCapacityAh,
    batteryMassKg: selectedBattery.massKg,
    batteryName: selectedBattery.name,
    batteryVoltageNominalV: selectedBattery.cells * nominalCellVoltage,
    baseCruise,
    bestRangeCommand,
    bestRangeSweep,
    commandThrust,
    dryMassKg,
    engine,
    engineCount,
    engineMassKg,
    basicEmptyWeight,
    baseAircraftMassKg,
    fuelMassKg: fullFuelMassKg,
    fuelMinutesAtFullCommand,
    fullFuelMassKg,
    installedJetPayloadKg,
    enduranceAssistBest,
    enduranceAssistSweep,
    iJetOptimizedCommandCurve,
    iJetBestRangeCommand,
    iJetSweep,
    propOnlyMassKg,
    takeoffState: {
      batterySocPct: takeoffBatteryPct,
      fuelPct: takeoffFuelPct,
      massKg: takeoffMassKg,
      propOnlyMassKg,
      propOnlyThrustToWeight: takeoffPropOnlyThrustToWeight,
      hybridThrustToWeight: takeoffHybridThrustToWeight,
      propOnlyExcessMarginPct: (takeoffPropOnlyThrustToWeight / takeoffTargetTW - 1) * 100,
      hybridExcessMarginPct: (takeoffHybridThrustToWeight / takeoffTargetTW - 1) * 100,
    },
    landing: {
      batterySocPct: landingBatteryPct,
      fuelPct: landingFuelPct,
      massKg: landingMassKg,
      propOnlyMassKg: propOnlyLandingMassKg,
      propOnlyThrustToWeight,
      hybridThrustToWeight,
      propOnlyExcessMarginPct: (propOnlyThrustToWeight / landingTargetTW - 1) * 100,
      hybridExcessMarginPct: (hybridThrustToWeight / landingTargetTW - 1) * 100,
    },
    feasibility: {
      hybridHoverThrustToWeight: maxHybridThrustN / Math.max(requiredHoverThrustN, 0.001),
      hybridTakeoffThrustToWeight: maxHybridThrustN / Math.max(takeoffMassKg * gravity, 0.001),
      hybridThrustDeficitN: Math.max(0, requiredTakeoffThrustN - maxHybridThrustN),
      propOnlyHoverThrustToWeight: takeoffFullPropThrustN / Math.max(propOnlyMassKg * gravity, 0.001),
      propOnlyThrustDeficitN: Math.max(0, propOnlyTakeoffRequiredThrustN - takeoffFullPropThrustN),
      requiredHoverThrustN,
      requiredTakeoffThrustN,
      targetThrustToWeight: takeoffTargetTW,
    },
    propFullBatteryThrustN: propulsion.fullBatteryThrustN,
    propFullPitchSpeedKt: propulsion.fullPitchSpeedKt,
    propNominalThrustN: propulsion.nominalThrustN,
    propOnlyBestRangeCommand,
    selectedCommand,
    takeoff,
    thrustCurve: Array.from({ length: 10 }, (_, index) => {
      const pct = 100 - index * 10;
      const hybridMassKg = dryMassKg + fullFuelMassKg * (pct / 100);
      const propOnlyThrustN = propAvailableThrustAtBattery(propulsion.nominalThrustN, pct);
      const hybridJetThrustN = pct > 0 ? turbinePerformanceAtCommand(engine, 1).thrustN * engineCount : 0;
      return {
        batteryPct: pct,
        fuelPct: pct,
        massKg: hybridMassKg,
        propOnlyTW: propOnlyThrustN / Math.max(propOnlyMassKg * gravity, 0.001),
        hybridTW: (propOnlyThrustN + hybridJetThrustN) / Math.max(hybridMassKg * gravity, 0.001),
      };
    }),
    turbineCurve: Array.from({ length: 11 }, (_, index) => {
      const command = index / 10;
      const performance = turbinePerformanceAtCommand(engine, command);
      const maxFuelKgPerMin = Math.max(engine.fuelKgPerMin, 0.001);
      const maxThrustN = Math.max(engine.thrustN, 0.001);
      return {
        commandPct: command * 100,
        fuelFlowPct: (performance.fuelKgPerMin / maxFuelKgPerMin) * 100,
        fuelPerThrustFactor: performance.thrustN > 0 ? (performance.fuelKgPerMin / maxFuelKgPerMin) / (performance.thrustN / maxThrustN) : 0,
      };
    }),
  };
}

function computeSelectedPropulsion(input: JetComparisonInput, rotorDefinition: RotorDefinition) {
  const selectedMotor = motorSamples.find((motor) => motor.id === input.propulsionState.selectedMotorId) ?? motorSamples[0];
  const selectedPropeller = propellerSamples.find((propeller) => propeller.id === input.propulsionState.selectedPropellerId) ?? propellerSamples[0];
  const selectedBattery = batterySamples.find((battery) => battery.id === input.propulsionState.selectedBatteryId) ?? batterySamples[0];
  const result = computePropulsionSizing(
    input.aircraftMassKg,
    Math.max(1, rotorDefinition.count),
    Math.max(1, rotorDefinition.bladeCount),
    rotorDefinition.diameterM,
    { rotorPitchIn: selectedPropeller.pitchIn },
    { cells: selectedBattery.cells, cRating: selectedBattery.cRating },
    selectedBattery.massKg,
    input.batteryEnergyDensityWhKg,
    selectedPropeller,
    selectedMotor,
    selectedBattery,
  );
  return {
    fullBatteryCurrentPerMotorA: result.currentPerMotorA,
    fullBatteryPowerPerMotorW: result.powerPerMotorW,
    fullBatteryThrustN: result.adjustedTakeoffThrustTotalN,
    fullPitchSpeedKt: result.pitchSpeedMS / metersPerSecondPerKnot,
    cruisePropEfficiency: result.cruisePropEfficiency,
    loadedPeakEfficiencySpeedMS: peakEfficiencySpeedMS(selectedPropeller, result.motorLoadedRpm),
    loadedRpm: result.motorLoadedRpm,
    nominalThrustN: result.adjustedTakeoffThrustTotalN,
    pitchSpeedMS: result.pitchSpeedMS,
    propeller: selectedPropeller,
    totalPowerW: result.totalPowerW,
  };
}

function computeBaseCruiseCondition({
  aero,
  aircraftMassKg,
  cruisePropEfficiency,
  loadedRpm,
  pitchSpeedMS,
  propFullPowerW,
  propeller,
  usableEnergyWh,
}: {
  aero: SketchAeroComputation;
  aircraftMassKg: number;
  cruisePropEfficiency: number;
  loadedRpm: number;
  pitchSpeedMS: number;
  propFullPowerW: number;
  propeller: PropellerSample;
  usableEnergyWh: number;
}): BaseCruiseCondition {
  const loadedPeakEfficiencySpeedMS = peakEfficiencySpeedMS(propeller, loadedRpm);
  const pitchLimitedSpeedMS = pitchSpeedMS > 0 ? Math.max(pitchSpeedMS * 0.95, 1) : loadedPeakEfficiencySpeedMS;
  const propLimitedSpeedMS = Math.max(Math.min(loadedPeakEfficiencySpeedMS, pitchLimitedSpeedMS), 1);
  const stallSpeedMS = (stallSpeedForMassKt(aero, aircraftMassKg) * metersPerSecondPerKnot);
  const minimumFlyableSpeedMS = Math.max(stallSpeedMS * minimumFlightSpeedMargin, 1);
  if (!aero.validity.drag || !aero.validity.lift || propLimitedSpeedMS < minimumFlyableSpeedMS) {
    return {
      commandPct: 0,
      enduranceMin: 0,
      flyable: false,
      minimumFlyableSpeedKt: minimumFlyableSpeedMS / metersPerSecondPerKnot,
      powerPct: 0,
      powerW: 0,
      rangeNm: 0,
      speedKt: propLimitedSpeedMS / metersPerSecondPerKnot,
    };
  }
  const rhoKgM3 = aero.assumptions.rhoKgM3;
  const wingAreaM2 = Math.max(aero.geometry.wingAreaM2, 0.001);
  const aspectRatio = Math.max(aero.geometry.aspectRatio, 0.1);
  const oswaldEfficiency = Math.max(aero.assumptions.oswaldEfficiency, 0.1);
  const parasiteCd = Math.max(aero.aerodynamics.parasiteDragCoefficient, 0.001);
  const weightN = Math.max(aircraftMassKg, 0.001) * gravity;
  const sampleCount = 30;
  let best = cruisePowerAtSpeed({
    aero,
    aspectRatio,
    cruisePropEfficiency,
    loadedPeakEfficiencySpeedMS,
    oswaldEfficiency,
    parasiteCd,
    rhoKgM3,
    speedMS: minimumFlyableSpeedMS,
    weightN,
    wingAreaM2,
  });
  for (let index = 0; index <= sampleCount; index += 1) {
    const t = sampleCount > 0 ? index / sampleCount : 0;
    const speedMS = minimumFlyableSpeedMS + (propLimitedSpeedMS - minimumFlyableSpeedMS) * t;
    const candidate = cruisePowerAtSpeed({
      aero,
      aspectRatio,
      cruisePropEfficiency,
      loadedPeakEfficiencySpeedMS,
      oswaldEfficiency,
      parasiteCd,
      rhoKgM3,
      speedMS,
      weightN,
      wingAreaM2,
    });
    if (candidate.powerW < best.powerW) best = candidate;
  }
  const enduranceMin = best.powerW > 0 ? (usableEnergyWh / best.powerW) * 60 : 0;
  const speedKt = best.speedMS / metersPerSecondPerKnot;
  const powerPct = propFullPowerW > 0 ? (best.powerW / propFullPowerW) * 100 : 0;
  const commandPct = Math.cbrt(Math.max(powerPct, 0) / 100) * 100;
  return {
    commandPct,
    enduranceMin,
    flyable: true,
    minimumFlyableSpeedKt: minimumFlyableSpeedMS / metersPerSecondPerKnot,
    powerPct,
    powerW: best.powerW,
    rangeNm: speedKt * (enduranceMin / 60),
    speedKt,
  };
}

function cruisePowerAtSpeed({
  aero,
  aspectRatio,
  cruisePropEfficiency,
  loadedPeakEfficiencySpeedMS,
  oswaldEfficiency,
  parasiteCd,
  rhoKgM3,
  speedMS,
  weightN,
  wingAreaM2,
}: {
  aero: SketchAeroComputation;
  aspectRatio: number;
  cruisePropEfficiency: number;
  loadedPeakEfficiencySpeedMS: number;
  oswaldEfficiency: number;
  parasiteCd: number;
  rhoKgM3: number;
  speedMS: number;
  weightN: number;
  wingAreaM2: number;
}) {
  const demand = flightDemandAtSpeed({
    aero,
    aspectRatio,
    cruisePropEfficiency,
    loadedPeakEfficiencySpeedMS,
    oswaldEfficiency,
    parasiteCd,
    rhoKgM3,
    speedMS,
    weightN,
    wingAreaM2,
  });
  return {
    powerW: demand.propElectricPowerW,
    speedMS,
  };
}

function flightDemandAtSpeed({
  aero,
  aspectRatio,
  cruisePropEfficiency,
  loadedPeakEfficiencySpeedMS,
  oswaldEfficiency,
  parasiteCd,
  rhoKgM3,
  speedMS,
  weightN,
  wingAreaM2,
}: {
  aero: SketchAeroComputation;
  aspectRatio: number;
  cruisePropEfficiency: number;
  loadedPeakEfficiencySpeedMS: number;
  oswaldEfficiency: number;
  parasiteCd: number;
  rhoKgM3: number;
  speedMS: number;
  weightN: number;
  wingAreaM2: number;
}) {
  const dynamicPressurePa = 0.5 * rhoKgM3 * speedMS * speedMS;
  const cl = weightN / Math.max(dynamicPressurePa * wingAreaM2, 0.001);
  const inducedCd = (cl * cl) / (Math.PI * aspectRatio * oswaldEfficiency);
  const cd = parasiteCd + inducedCd;
  const dragN = dynamicPressurePa * aero.geometry.dragReferenceAreaM2 * cd;
  const speedMismatch = loadedPeakEfficiencySpeedMS > 0 ? Math.abs(speedMS - loadedPeakEfficiencySpeedMS) / loadedPeakEfficiencySpeedMS : 0;
  const speedEfficiencyPenalty = 1 - Math.min(0.45, speedMismatch * 0.45);
  const propEfficiency = Math.max(0.18, Math.min(0.9, cruisePropEfficiency * speedEfficiencyPenalty));
  return {
    dragN,
    propEfficiency,
    propElectricPowerW: (dragN * speedMS) / propEfficiency,
  };
}

function peakEfficiencySpeedMS(propeller: PropellerSample, loadedRpm: number) {
  const loadedRpmRatio = propeller.peakEfficiencyRpm > 0 && loadedRpm > 0 ? loadedRpm / propeller.peakEfficiencyRpm : 1;
  return Math.max(propeller.peakEfficiencyMph * 0.44704 * loadedRpmRatio, 1);
}

function solveCommandCondition({
  aircraftMassKg,
  aero,
  batteryCapacityAh,
  command,
  cruisePropEfficiency,
  engine,
  engineCount,
  fuelMassKg,
  loadedPeakEfficiencySpeedMS,
  motorCount,
  propFullCurrentPerMotorA,
  propFullPowerPerMotorW,
  propFullThrustN,
  usableReserveFraction,
  pitchSpeedKt,
  useJet,
}: {
  aircraftMassKg: number;
  aero: SketchAeroComputation;
  batteryCapacityAh: number;
  command: number;
  cruisePropEfficiency: number;
  engine: TurbineEngineOption;
  engineCount: number;
  fuelMassKg: number;
  loadedPeakEfficiencySpeedMS: number;
  motorCount: number;
  propFullCurrentPerMotorA: number;
  propFullPowerPerMotorW: number;
  propFullThrustN: number;
  usableReserveFraction: number;
  pitchSpeedKt: number;
  useJet: boolean;
}): JetCondition {
  const safeCommand = Math.min(1, Math.max(0, command));
  const propThrustN = propFullThrustN * Math.pow(safeCommand, 2);
  const turbinePerformance = turbinePerformanceAtCommand(engine, safeCommand);
  const jetThrustN = useJet ? turbinePerformance.thrustN * engineCount : 0;
  const motorCurrentA = propFullCurrentPerMotorA * Math.pow(safeCommand, 3);
  const batteryCurrentA = motorCurrentA * motorCount;
  const motorPowerW = propFullPowerPerMotorW * Math.pow(safeCommand, 3);
  const batteryPowerW = motorPowerW * motorCount;
  const fuelBurnKgMin = useJet ? turbinePerformance.fuelKgPerMin * engineCount : 0;
  const totalThrustN = propThrustN + jetThrustN;
  const speedEstimate = estimateCommandSpeedKt({
    aero,
    aircraftMassKg,
    batteryPowerW,
    cruisePropEfficiency,
    jetThrustN,
    loadedPeakEfficiencySpeedMS,
    pitchSpeedKt,
    propThrustN,
  });
  const batteryEnduranceMin = speedEstimate.flyable && batteryCurrentA > 0 ? (batteryCapacityAh * usableReserveFraction / batteryCurrentA) * 60 : Number.POSITIVE_INFINITY;
  const fuelEnduranceMin = fuelBurnKgMin > 0 ? fuelMassKg / fuelBurnKgMin : Number.POSITIVE_INFINITY;
  const enduranceMin = speedEstimate.flyable ? Math.min(batteryEnduranceMin, fuelEnduranceMin) : 0;
  return {
    aircraftMassKg,
    batteryCurrentA,
    batteryPowerW,
    batteryEnduranceMin,
    commandPct: safeCommand * 100,
    enduranceMin,
    enduranceLimiter: enduranceLimiter(batteryEnduranceMin, fuelEnduranceMin),
    fuelBurnKgMin,
    flyable: speedEstimate.flyable,
    fuelEfficiencyFactor: useJet ? turbineFuelPerThrustFactor(engine, turbinePerformance) : 0,
    fuelEnduranceMin,
    jetThrustN,
    minimumFlyableSpeedKt: speedEstimate.minimumFlyableSpeedKt,
    motorCurrentA,
    motorPowerW,
    pitchOverspeedPct: speedEstimate.pitchOverspeedPct,
    pitchSpeedKt,
    propThrustN,
    rangeNm: speedEstimate.flyable && Number.isFinite(enduranceMin) ? speedEstimate.speedKt * (enduranceMin / 60) : 0,
    speedKt: speedEstimate.speedKt,
    totalThrustN,
  };
}

function solveIntelligentJetCondition({
  aircraftMassKg,
  aero,
  batteryCapacityAh,
  cruisePropEfficiency,
  engine,
  engineCount,
  fuelMassKg,
  loadedPeakEfficiencySpeedMS,
  motorCount,
  propCommand,
  propFullCurrentPerMotorA,
  propFullPowerPerMotorW,
  propFullThrustN,
  usableReserveFraction,
  pitchSpeedKt,
}: {
  aircraftMassKg: number;
  aero: SketchAeroComputation;
  batteryCapacityAh: number;
  cruisePropEfficiency: number;
  engine: TurbineEngineOption;
  engineCount: number;
  fuelMassKg: number;
  loadedPeakEfficiencySpeedMS: number;
  motorCount: number;
  propCommand: number;
  propFullCurrentPerMotorA: number;
  propFullPowerPerMotorW: number;
  propFullThrustN: number;
  usableReserveFraction: number;
  pitchSpeedKt: number;
}): IntelligentJetCondition {
  const safePropCommand = Math.min(1, Math.max(0, propCommand));
  const motorCurrentA = propFullCurrentPerMotorA * Math.pow(safePropCommand, 3);
  const batteryCurrentA = motorCurrentA * motorCount;
  const motorPowerW = propFullPowerPerMotorW * Math.pow(safePropCommand, 3);
  const batteryPowerW = motorPowerW * motorCount;
  const batteryEnduranceMin = batteryCurrentA > 0 ? (batteryCapacityAh * usableReserveFraction / batteryCurrentA) * 60 : Number.POSITIVE_INFINITY;
  const desiredFuelBurnKgMin = Number.isFinite(batteryEnduranceMin) && batteryEnduranceMin > 0 ? fuelMassKg / batteryEnduranceMin : 0;
  const fuelCommand = solveTurbineCommandForFuelBurn(engine, engineCount, desiredFuelBurnKgMin);
  const turbinePerformance = turbinePerformanceAtCommand(engine, fuelCommand);
  const fuelBurnKgMin = turbinePerformance.fuelKgPerMin * engineCount;
  const fuelEnduranceMin = fuelBurnKgMin > 0 ? fuelMassKg / fuelBurnKgMin : Number.POSITIVE_INFINITY;
  const propThrustN = propFullThrustN * Math.pow(safePropCommand, 2);
  const jetThrustN = turbinePerformance.thrustN * engineCount;
  const totalThrustN = propThrustN + jetThrustN;
  const speedEstimate = estimateCommandSpeedKt({
    aero,
    aircraftMassKg,
    batteryPowerW,
    cruisePropEfficiency,
    jetThrustN,
    loadedPeakEfficiencySpeedMS,
    pitchSpeedKt,
    propThrustN,
  });
  const enduranceMin = speedEstimate.flyable ? Math.min(batteryEnduranceMin, fuelEnduranceMin) : 0;
  const balanceErrorPct = Number.isFinite(batteryEnduranceMin) && batteryEnduranceMin > 0
    ? ((fuelEnduranceMin - batteryEnduranceMin) / batteryEnduranceMin) * 100
    : 0;
  const balanceStatus = batteryCurrentA <= 0
    ? "no-battery-draw"
    : fuelCommand <= 0.0001 && Math.abs(fuelBurnKgMin - desiredFuelBurnKgMin) > 1e-6
      ? "idle-limited"
      : fuelCommand >= 0.9999 && Math.abs(fuelBurnKgMin - desiredFuelBurnKgMin) > 1e-6
        ? "max-limited"
        : "matched";

  return {
    aircraftMassKg,
    balanceErrorPct,
    balanceStatus,
    batteryCurrentA,
    batteryEnduranceMin,
    batteryPowerW,
    commandPct: safePropCommand * 100,
    desiredFuelBurnKgMin,
    enduranceLimiter: enduranceLimiter(batteryEnduranceMin, fuelEnduranceMin),
    enduranceMin,
    flyable: speedEstimate.flyable,
    fuelBurnKgMin,
    fuelCommandPct: fuelCommand * 100,
    fuelEfficiencyFactor: turbineFuelPerThrustFactor(engine, turbinePerformance),
    fuelEnduranceMin,
    jetThrustN,
    minimumFlyableSpeedKt: speedEstimate.minimumFlyableSpeedKt,
    motorCurrentA,
    motorPowerW,
    pitchOverspeedPct: speedEstimate.pitchOverspeedPct,
    pitchSpeedKt,
    propCommandPct: safePropCommand * 100,
    propThrustN,
    rangeNm: speedEstimate.flyable && Number.isFinite(enduranceMin) ? speedEstimate.speedKt * (enduranceMin / 60) : 0,
    speedKt: speedEstimate.speedKt,
    totalThrustN,
  };
}

function solveEnduranceAssistPoint({
  aircraftMassKg,
  aero,
  batteryCapacityAh,
  cruisePropEfficiency,
  engine,
  engineCount,
  fuelMassKg,
  jetCommand,
  loadedPeakEfficiencySpeedMS,
  pitchSpeedKt,
  motorCount,
  propFullCurrentPerMotorA,
  propFullPowerW,
  speedKt,
  usableReserveFraction,
}: {
  aircraftMassKg: number;
  aero: SketchAeroComputation;
  batteryCapacityAh: number;
  cruisePropEfficiency: number;
  engine: TurbineEngineOption;
  engineCount: number;
  fuelMassKg: number;
  jetCommand: number;
  loadedPeakEfficiencySpeedMS: number;
  pitchSpeedKt: number;
  motorCount: number;
  propFullCurrentPerMotorA: number;
  propFullPowerW: number;
  speedKt: number;
  usableReserveFraction: number;
}): EnduranceAssistPoint {
  const safeJetCommand = Math.min(1, Math.max(0, jetCommand));
  const speedMS = Math.max(speedKt, 0) * metersPerSecondPerKnot;
  const minimumFlyableSpeedKt = stallSpeedForMassKt(aero, aircraftMassKg) * minimumFlightSpeedMargin;
  const turbinePerformance = turbinePerformanceAtCommand(engine, safeJetCommand);
  const jetThrustN = turbinePerformance.thrustN * engineCount;
  const fuelBurnKgMin = turbinePerformance.fuelKgPerMin * engineCount;
  const canEvaluate = aero.validity.drag && aero.validity.lift && speedKt >= minimumFlyableSpeedKt && speedKt <= pitchSpeedKt && speedMS > 0;
  if (!canEvaluate) {
    return {
      batteryEnduranceMin: Number.POSITIVE_INFINITY,
      batteryPowerW: 0,
      commandPct: safeJetCommand * 100,
      enduranceLimiter: "none",
      enduranceMin: 0,
      flyable: false,
      fuelBurnKgMin,
      fuelEnduranceMin: fuelBurnKgMin > 0 ? fuelMassKg / fuelBurnKgMin : Number.POSITIVE_INFINITY,
      jetThrustN,
      minimumFlyableSpeedKt,
      propCommandPct: 0,
      propPowerW: 0,
      propThrustN: 0,
      rangeNm: 0,
      speedKt,
    };
  }
  const demand = flightDemandAtSpeed({
    aero,
    aspectRatio: Math.max(aero.geometry.aspectRatio, 0.1),
    cruisePropEfficiency,
    loadedPeakEfficiencySpeedMS,
    oswaldEfficiency: Math.max(aero.assumptions.oswaldEfficiency, 0.1),
    parasiteCd: Math.max(aero.aerodynamics.parasiteDragCoefficient, 0.001),
    rhoKgM3: aero.assumptions.rhoKgM3,
    speedMS,
    weightN: Math.max(aircraftMassKg, 0.001) * gravity,
    wingAreaM2: Math.max(aero.geometry.wingAreaM2, 0.001),
  });
  const propThrustN = Math.max(0, demand.dragN - jetThrustN);
  const propPowerW = (propThrustN * speedMS) / Math.max(demand.propEfficiency, 0.001);
  const propPowerFraction = propFullPowerW > 0 ? propPowerW / propFullPowerW : 0;
  const propCommand = Math.cbrt(Math.max(0, propPowerFraction));
  const propCommandPct = propCommand * 100;
  const batteryCurrentA = propFullCurrentPerMotorA * Math.pow(propCommand, 3) * motorCount;
  const batteryPowerW = propPowerW;
  const batteryEnduranceMin = batteryCurrentA > 0 ? (batteryCapacityAh * usableReserveFraction / batteryCurrentA) * 60 : Number.POSITIVE_INFINITY;
  const fuelEnduranceMin = fuelBurnKgMin > 0 ? fuelMassKg / fuelBurnKgMin : Number.POSITIVE_INFINITY;
  const flyable = propPowerFraction <= 1 + 1e-6;
  const enduranceMin = flyable ? Math.min(batteryEnduranceMin, fuelEnduranceMin) : 0;
  return {
    batteryEnduranceMin,
    batteryPowerW,
    commandPct: safeJetCommand * 100,
    enduranceLimiter: flyable ? enduranceLimiter(batteryEnduranceMin, fuelEnduranceMin) : "none",
    enduranceMin,
    flyable,
    fuelBurnKgMin,
    fuelEnduranceMin,
    jetThrustN,
    minimumFlyableSpeedKt,
    propCommandPct,
    propPowerW,
    propThrustN,
    rangeNm: flyable && Number.isFinite(enduranceMin) ? speedKt * (enduranceMin / 60) : 0,
    speedKt,
  };
}

function solveOptimizedIJetCommandPoint({
  aircraftMassKg,
  aero,
  baselineSplitRatio,
  batteryCapacityAh,
  cruisePropEfficiency,
  engine,
  engineCount,
  fuelMassKg,
  loadedPeakEfficiencySpeedMS,
  masterCommand,
  motorCount,
  pitchSpeedKt,
  propCapCommand,
  propFullCurrentPerMotorA,
  propFullPowerPerMotorW,
  propFullThrustN,
  usableReserveFraction,
}: {
  aircraftMassKg: number;
  aero: SketchAeroComputation;
  baselineSplitRatio: number;
  batteryCapacityAh: number;
  cruisePropEfficiency: number;
  engine: TurbineEngineOption;
  engineCount: number;
  fuelMassKg: number;
  loadedPeakEfficiencySpeedMS: number;
  masterCommand: number;
  motorCount: number;
  pitchSpeedKt: number;
  propCapCommand: number;
  propFullCurrentPerMotorA: number;
  propFullPowerPerMotorW: number;
  propFullThrustN: number;
  usableReserveFraction: number;
}): IJetCommandMixPoint {
  const safeMaster = Math.min(1, Math.max(0, masterCommand));
  const safePropCap = Math.min(1, Math.max(0, propCapCommand));
  const jetAtPropCap = Math.min(1, safePropCap * Math.max(0, baselineSplitRatio));
  const baselinePropCommand = Math.min(safeMaster, safePropCap);
  const baselineJetCommand = safeMaster > safePropCap
    ? jetAtPropCap + ((safeMaster - safePropCap) / Math.max(1 - safePropCap, 0.001)) * (1 - jetAtPropCap)
    : safeMaster * Math.max(0, baselineSplitRatio);
  const baseline = solveMixedCommandPoint({
    aircraftMassKg,
    aero,
    batteryCapacityAh,
    cruisePropEfficiency,
    engine,
    engineCount,
    fuelMassKg,
    jetCommand: baselineJetCommand,
    loadedPeakEfficiencySpeedMS,
    motorCount,
    pitchSpeedKt,
    propCommand: baselinePropCommand,
    propFullCurrentPerMotorA,
    propFullPowerPerMotorW,
    propFullThrustN,
    usableReserveFraction,
  });
  if (safeMaster <= 0) {
    return {
      ...mixedToIJetCommandPoint({
        baseline,
        masterCommand: safeMaster,
        mode: "idle",
        optimized: baseline,
        targetThrustN: baseline.totalThrustN,
      }),
    };
  }

  const targetThrustN = baseline.totalThrustN;
  const step = 0.025;
  let best = baseline;
  let bestScore = scoreMixedCandidate(baseline, baseline);
  for (let propIndex = 0; propIndex <= Math.round(safePropCap / step); propIndex += 1) {
    const propCommand = Math.min(safePropCap, propIndex * step);
    for (let jetIndex = 0; jetIndex <= 40; jetIndex += 1) {
      const jetCommand = jetIndex * step;
      const candidate = solveMixedCommandPoint({
        aircraftMassKg,
        aero,
        batteryCapacityAh,
        cruisePropEfficiency,
        engine,
        engineCount,
        fuelMassKg,
        jetCommand,
        loadedPeakEfficiencySpeedMS,
        motorCount,
        pitchSpeedKt,
        propCommand,
        propFullCurrentPerMotorA,
        propFullPowerPerMotorW,
        propFullThrustN,
        usableReserveFraction,
      });
      if (candidate.totalThrustN + Math.max(1, targetThrustN * 0.003) < targetThrustN) continue;
      if (candidate.totalThrustN > targetThrustN * 1.03 + 3) continue;
      if (!candidate.flyable && baseline.flyable) continue;
      const score = scoreMixedCandidate(candidate, baseline);
      if (score > bestScore) {
        best = candidate;
        bestScore = score;
      }
    }
  }

  return mixedToIJetCommandPoint({
    baseline,
    masterCommand: safeMaster,
    mode: best.propCommandPct >= safePropCap * 100 - 0.01 ? "prop-capped" : "optimized",
    optimized: best,
    targetThrustN,
  });
}

function scoreMixedCandidate(candidate: JetCondition & { jetCommandPct: number; propCommandPct: number }, baseline: JetCondition) {
  if (!candidate.flyable) return -1e9 + candidate.totalThrustN;
  const enduranceTerm = candidate.enduranceMin;
  const rangeTerm = candidate.rangeNm * 0.55;
  const speedPenalty = Math.max(0, baseline.speedKt - candidate.speedKt) * 0.06;
  const overThrustPenalty = Math.max(0, candidate.totalThrustN - baseline.totalThrustN) / Math.max(baseline.totalThrustN, 1) * 2;
  return enduranceTerm + rangeTerm - speedPenalty - overThrustPenalty;
}

function smoothIJetCommandCurve({
  aircraftMassKg,
  aero,
  batteryCapacityAh,
  cruisePropEfficiency,
  engine,
  engineCount,
  fuelMassKg,
  loadedPeakEfficiencySpeedMS,
  motorCount,
  pitchSpeedKt,
  points,
  propFullCurrentPerMotorA,
  propFullPowerPerMotorW,
  propFullThrustN,
  usableReserveFraction,
}: {
  aircraftMassKg: number;
  aero: SketchAeroComputation;
  batteryCapacityAh: number;
  cruisePropEfficiency: number;
  engine: TurbineEngineOption;
  engineCount: number;
  fuelMassKg: number;
  loadedPeakEfficiencySpeedMS: number;
  motorCount: number;
  pitchSpeedKt: number;
  points: IJetCommandMixPoint[];
  propFullCurrentPerMotorA: number;
  propFullPowerPerMotorW: number;
  propFullThrustN: number;
  usableReserveFraction: number;
}) {
  let previousJetCommand = 0;
  return points.map((point) => {
    if (point.masterCommandPct <= 0) return point;
    const smoothedJetCommandPct = Math.max(previousJetCommand, point.jetCommandPct);
    previousJetCommand = smoothedJetCommandPct;
    if (Math.abs(smoothedJetCommandPct - point.jetCommandPct) < 0.001) return point;

    let lowPropCommand = 0;
    let highPropCommand = Math.max(0, Math.min(1, point.propCommandPct / 100));
    for (let index = 0; index < 24; index += 1) {
      const midPropCommand = (lowPropCommand + highPropCommand) / 2;
      const candidate = solveMixedCommandPoint({
        aircraftMassKg,
        aero,
        batteryCapacityAh,
        cruisePropEfficiency,
        engine,
        engineCount,
        fuelMassKg,
        jetCommand: smoothedJetCommandPct / 100,
        loadedPeakEfficiencySpeedMS,
        motorCount,
        pitchSpeedKt,
        propCommand: midPropCommand,
        propFullCurrentPerMotorA,
        propFullPowerPerMotorW,
        propFullThrustN,
        usableReserveFraction,
      });
      if (candidate.totalThrustN < point.targetThrustN) lowPropCommand = midPropCommand;
      else highPropCommand = midPropCommand;
    }
    const smoothed = solveMixedCommandPoint({
      aircraftMassKg,
      aero,
      batteryCapacityAh,
      cruisePropEfficiency,
      engine,
      engineCount,
      fuelMassKg,
      jetCommand: smoothedJetCommandPct / 100,
      loadedPeakEfficiencySpeedMS,
      motorCount,
      pitchSpeedKt,
      propCommand: highPropCommand,
      propFullCurrentPerMotorA,
      propFullPowerPerMotorW,
      propFullThrustN,
      usableReserveFraction,
    });
    return mixedToIJetCommandPoint({
      baseline: {
        ...point,
        aircraftMassKg,
        batteryCurrentA: 0,
        batteryEnduranceMin: point.baselineEnduranceMin,
        batteryPowerW: 0,
        commandPct: point.baselineJetCommandPct,
        enduranceLimiter: "none",
        enduranceMin: point.baselineEnduranceMin,
        flyable: point.baselineEnduranceMin > 0,
        fuelBurnKgMin: 0,
        fuelEfficiencyFactor: 0,
        fuelEnduranceMin: point.baselineEnduranceMin,
        jetCommandPct: point.baselineJetCommandPct,
        jetThrustN: 0,
        minimumFlyableSpeedKt: 0,
        motorCurrentA: 0,
        motorPowerW: 0,
        pitchOverspeedPct: 0,
        pitchSpeedKt,
        propCommandPct: point.baselinePropCommandPct,
        propThrustN: 0,
        rangeNm: point.baselineRangeNm,
        speedKt: point.baselineSpeedKt,
        totalThrustN: point.targetThrustN,
      },
      masterCommand: point.masterCommandPct / 100,
      mode: "optimized",
      optimized: smoothed,
      targetThrustN: point.targetThrustN,
    });
  });
}

function mixedToIJetCommandPoint({
  baseline,
  masterCommand,
  mode,
  optimized,
  targetThrustN,
}: {
  baseline: JetCondition & { jetCommandPct: number; propCommandPct: number };
  masterCommand: number;
  mode: IJetCommandMixPoint["mode"];
  optimized: JetCondition & { jetCommandPct: number; propCommandPct: number };
  targetThrustN: number;
}): IJetCommandMixPoint {
  return {
    baselineEnduranceMin: baseline.enduranceMin,
    baselineJetCommandPct: baseline.jetCommandPct,
    baselinePropCommandPct: baseline.propCommandPct,
    baselineRangeNm: baseline.rangeNm,
    baselineSpeedKt: baseline.speedKt,
    enduranceGainPct: percentGain(optimized.enduranceMin, baseline.enduranceMin),
    enduranceMin: optimized.enduranceMin,
    jetCommandPct: optimized.jetCommandPct,
    jetThrustN: optimized.jetThrustN,
    masterCommandPct: masterCommand * 100,
    mode,
    propCommandPct: optimized.propCommandPct,
    propThrustN: optimized.propThrustN,
    rangeGainPct: percentGain(optimized.rangeNm, baseline.rangeNm),
    rangeNm: optimized.rangeNm,
    speedGainPct: percentGain(optimized.speedKt, baseline.speedKt),
    speedKt: optimized.speedKt,
    targetThrustN,
    totalThrustN: optimized.totalThrustN,
  };
}

function percentGain(next: number, base: number) {
  return Number.isFinite(base) && Math.abs(base) > 1e-9 ? (next / base - 1) * 100 : null;
}

function solveMixedCommandPoint({
  aircraftMassKg,
  aero,
  batteryCapacityAh,
  cruisePropEfficiency,
  engine,
  engineCount,
  fuelMassKg,
  jetCommand,
  loadedPeakEfficiencySpeedMS,
  motorCount,
  pitchSpeedKt,
  propCommand,
  propFullCurrentPerMotorA,
  propFullPowerPerMotorW,
  propFullThrustN,
  usableReserveFraction,
}: {
  aircraftMassKg: number;
  aero: SketchAeroComputation;
  batteryCapacityAh: number;
  cruisePropEfficiency: number;
  engine: TurbineEngineOption;
  engineCount: number;
  fuelMassKg: number;
  jetCommand: number;
  loadedPeakEfficiencySpeedMS: number;
  motorCount: number;
  pitchSpeedKt: number;
  propCommand: number;
  propFullCurrentPerMotorA: number;
  propFullPowerPerMotorW: number;
  propFullThrustN: number;
  usableReserveFraction: number;
}): JetCondition & { jetCommandPct: number; propCommandPct: number } {
  const safePropCommand = Math.min(1, Math.max(0, propCommand));
  const safeJetCommand = Math.min(1, Math.max(0, jetCommand));
  const propThrustN = propFullThrustN * Math.pow(safePropCommand, 2);
  const turbinePerformance = turbinePerformanceAtCommand(engine, safeJetCommand);
  const jetThrustN = turbinePerformance.thrustN * engineCount;
  const motorCurrentA = propFullCurrentPerMotorA * Math.pow(safePropCommand, 3);
  const batteryCurrentA = motorCurrentA * motorCount;
  const motorPowerW = propFullPowerPerMotorW * Math.pow(safePropCommand, 3);
  const batteryPowerW = motorPowerW * motorCount;
  const fuelBurnKgMin = turbinePerformance.fuelKgPerMin * engineCount;
  const totalThrustN = propThrustN + jetThrustN;
  const speedEstimate = estimateCommandSpeedKt({
    aero,
    aircraftMassKg,
    batteryPowerW,
    cruisePropEfficiency,
    jetThrustN,
    loadedPeakEfficiencySpeedMS,
    pitchSpeedKt,
    propThrustN,
  });
  const batteryEnduranceMin = speedEstimate.flyable && batteryCurrentA > 0 ? (batteryCapacityAh * usableReserveFraction / batteryCurrentA) * 60 : Number.POSITIVE_INFINITY;
  const fuelEnduranceMin = fuelBurnKgMin > 0 ? fuelMassKg / fuelBurnKgMin : Number.POSITIVE_INFINITY;
  const enduranceMin = speedEstimate.flyable ? Math.min(batteryEnduranceMin, fuelEnduranceMin) : 0;
  return {
    aircraftMassKg,
    batteryCurrentA,
    batteryPowerW,
    batteryEnduranceMin,
    commandPct: safeJetCommand * 100,
    enduranceLimiter: speedEstimate.flyable ? enduranceLimiter(batteryEnduranceMin, fuelEnduranceMin) : "none",
    enduranceMin,
    flyable: speedEstimate.flyable,
    fuelBurnKgMin,
    fuelEfficiencyFactor: turbineFuelPerThrustFactor(engine, turbinePerformance),
    fuelEnduranceMin,
    jetCommandPct: safeJetCommand * 100,
    jetThrustN,
    minimumFlyableSpeedKt: speedEstimate.minimumFlyableSpeedKt,
    motorCurrentA,
    motorPowerW,
    pitchOverspeedPct: speedEstimate.pitchOverspeedPct,
    pitchSpeedKt,
    propCommandPct: safePropCommand * 100,
    propThrustN,
    rangeNm: speedEstimate.flyable && Number.isFinite(enduranceMin) ? speedEstimate.speedKt * (enduranceMin / 60) : 0,
    speedKt: speedEstimate.speedKt,
    totalThrustN,
  };
}

function solveCondition({
  aircraftMassKg,
  batteryCapacityAh,
  commandSource,
  engine,
  engineCount,
  fuelMassKg,
  motorCount,
  propFullCurrentPerMotorA,
  propFullPowerPerMotorW,
  propFullThrustN,
  requiredThrustN,
  usableReserveFraction,
  speedKt,
  useJet,
}: {
  aircraftMassKg: number;
  batteryCapacityAh: number;
  commandSource: "takeoff" | "cruise";
  engine: TurbineEngineOption;
  engineCount: number;
  fuelMassKg: number;
  motorCount: number;
  propFullCurrentPerMotorA: number;
  propFullPowerPerMotorW: number;
  propFullThrustN: number;
  requiredThrustN: number;
  usableReserveFraction: number;
  speedKt: number;
  useJet: boolean;
}): JetCondition {
  const command = solveCommandForRequiredThrust({
    engine,
    engineCount,
    propFullThrustN,
    requiredThrustN,
    useJet,
  });
  const turbinePerformance = turbinePerformanceAtCommand(engine, command);
  const propThrustN = propFullThrustN * Math.pow(command, 2);
  const jetThrustN = useJet ? turbinePerformance.thrustN * engineCount : 0;
  const motorCurrentA = propFullCurrentPerMotorA * Math.pow(command, 3);
  const batteryCurrentA = motorCurrentA * motorCount;
  const motorPowerW = propFullPowerPerMotorW * Math.pow(command, 3);
  const batteryPowerW = motorPowerW * motorCount;
  const fuelBurnKgMin = useJet ? turbinePerformance.fuelKgPerMin * engineCount : 0;
  const batteryEnduranceMin = batteryCurrentA > 0 ? (batteryCapacityAh * usableReserveFraction / batteryCurrentA) * 60 : Number.POSITIVE_INFINITY;
  const fuelEnduranceMin = fuelBurnKgMin > 0 ? fuelMassKg / fuelBurnKgMin : Number.POSITIVE_INFINITY;
  const enduranceMin = Math.min(batteryEnduranceMin, fuelEnduranceMin);
  return {
    aircraftMassKg,
    batteryCurrentA,
    batteryPowerW,
    batteryEnduranceMin,
    commandPct: command * 100,
    enduranceMin: commandSource === "takeoff" ? 0 : enduranceMin,
    enduranceLimiter: commandSource === "takeoff" ? "none" : enduranceLimiter(batteryEnduranceMin, fuelEnduranceMin),
    fuelEfficiencyFactor: useJet ? turbineFuelPerThrustFactor(engine, turbinePerformance) : 0,
    fuelBurnKgMin,
    flyable: true,
    fuelEnduranceMin,
    jetThrustN,
    minimumFlyableSpeedKt: 0,
    motorCurrentA,
    motorPowerW,
    pitchOverspeedPct: 0,
    pitchSpeedKt: speedKt,
    propThrustN,
    rangeNm: commandSource === "takeoff" || !Number.isFinite(enduranceMin) ? 0 : speedKt * (enduranceMin / 60),
    speedKt,
    totalThrustN: propThrustN + jetThrustN,
  };
}

function solveTurbineCommandForFuelBurn(engine: TurbineEngineOption, engineCount: number, targetFuelBurnKgMin: number) {
  const safeTarget = Math.max(targetFuelBurnKgMin, 0);
  const idleFuelBurnKgMin = turbinePerformanceAtCommand(engine, 0).fuelKgPerMin * engineCount;
  const maxFuelBurnKgMin = turbinePerformanceAtCommand(engine, 1).fuelKgPerMin * engineCount;
  if (safeTarget <= idleFuelBurnKgMin) return 0;
  if (safeTarget >= maxFuelBurnKgMin) return 1;
  let low = 0;
  let high = 1;
  for (let index = 0; index < 30; index += 1) {
    const mid = (low + high) / 2;
    const fuelBurnKgMin = turbinePerformanceAtCommand(engine, mid).fuelKgPerMin * engineCount;
    if (fuelBurnKgMin < safeTarget) low = mid;
    else high = mid;
  }
  return Math.min(1, Math.max(0, high));
}

function enduranceLimiter(batteryEnduranceMin: number, fuelEnduranceMin: number): "battery" | "fuel" | "none" {
  if (!Number.isFinite(batteryEnduranceMin) && !Number.isFinite(fuelEnduranceMin)) return "none";
  return batteryEnduranceMin <= fuelEnduranceMin ? "battery" : "fuel";
}

function relativeGain(next: number, base: number): RelativeGain {
  return {
    delta: next - base,
    pct: Number.isFinite(base) && Math.abs(base) > 1e-9 ? (next / base - 1) * 100 : null,
  };
}

function estimateCommandSpeedKt({
  aero,
  aircraftMassKg,
  batteryPowerW,
  cruisePropEfficiency,
  jetThrustN,
  loadedPeakEfficiencySpeedMS,
  pitchSpeedKt,
  propThrustN,
}: {
  aero: SketchAeroComputation;
  aircraftMassKg: number;
  batteryPowerW: number;
  cruisePropEfficiency: number;
  jetThrustN: number;
  loadedPeakEfficiencySpeedMS: number;
  pitchSpeedKt: number;
  propThrustN: number;
}) {
  const stallSpeedKt = stallSpeedForMassKt(aero, aircraftMassKg);
  const minimumFlyableSpeedKt = stallSpeedKt * minimumFlightSpeedMargin;
  const totalThrustN = propThrustN + jetThrustN;
  if (totalThrustN <= 0) return { flyable: false, minimumFlyableSpeedKt, pitchOverspeedPct: 0, speedKt: 0 };
  const rhoKgM3 = aero.assumptions.rhoKgM3;
  const pitchLimitKt = Math.max(0, pitchSpeedKt);
  const hasDragModel = aero.validity.drag && aero.validity.lift && aero.geometry.wingAreaM2 > 0.001 && aero.geometry.dragReferenceAreaM2 > 0.001 && rhoKgM3 > 0;
  if (!hasDragModel || pitchLimitKt < minimumFlyableSpeedKt) {
    return { flyable: false, minimumFlyableSpeedKt, pitchOverspeedPct: 0, speedKt: 0 };
  }
  const wingAreaM2 = Math.max(aero.geometry.wingAreaM2, 0.001);
  const aspectRatio = Math.max(aero.geometry.aspectRatio, 0.1);
  const oswaldEfficiency = Math.max(aero.assumptions.oswaldEfficiency, 0.1);
  const parasiteCd = Math.max(aero.aerodynamics.parasiteDragCoefficient, 0.001);
  const weightN = Math.max(aircraftMassKg, 0.001) * gravity;
  const maxSpeedMS = pitchLimitKt * metersPerSecondPerKnot;
  const minSpeedMS = minimumFlyableSpeedKt * metersPerSecondPerKnot;
  const sampleCount = 60;
  let bestSpeedMS = 0;
  for (let index = 0; index <= sampleCount; index += 1) {
    const t = sampleCount > 0 ? index / sampleCount : 0;
    const speedMS = minSpeedMS + (maxSpeedMS - minSpeedMS) * t;
    const demand = flightDemandAtSpeed({
      aero,
      aspectRatio,
      cruisePropEfficiency,
      loadedPeakEfficiencySpeedMS,
      oswaldEfficiency,
      parasiteCd,
      rhoKgM3,
      speedMS,
      weightN,
      wingAreaM2,
    });
    const propThrustRequiredN = Math.max(0, demand.dragN - jetThrustN);
    const propPowerRequiredW = (propThrustRequiredN * speedMS) / Math.max(demand.propEfficiency, 0.001);
    const hasEnoughThrust = demand.dragN <= totalThrustN + 1e-6 && propThrustRequiredN <= propThrustN + 1e-6;
    const hasEnoughPropPower = propPowerRequiredW <= batteryPowerW + Math.max(25, batteryPowerW * 0.02);
    if (hasEnoughThrust && hasEnoughPropPower) bestSpeedMS = speedMS;
  }
  const flyable = bestSpeedMS >= minSpeedMS;
  const speedKt = flyable ? bestSpeedMS / metersPerSecondPerKnot : 0;
  const pitchOverspeedPct = pitchLimitKt > 0 && flyable ? Math.max(0, (speedKt / pitchLimitKt - 1) * 100) : 0;
  return { flyable, minimumFlyableSpeedKt, pitchOverspeedPct, speedKt };
}

function stallSpeedForMassKt(aero: SketchAeroComputation, aircraftMassKg: number) {
  const referenceMassKg = aero.validity.lift ? Math.max(aero.mass.totalMassKg, 0.001) : Math.max(aircraftMassKg, 0.001);
  const referenceStallMS =
    aero.validity.lift && aero.aerodynamics.stallSpeedMS > 0
      ? aero.aerodynamics.stallSpeedMS
      : Math.max(aero.aerodynamics.cruiseSpeedMS * 0.55, 4);
  return (referenceStallMS * Math.sqrt(Math.max(aircraftMassKg, 0.001) / referenceMassKg)) / metersPerSecondPerKnot;
}

function solveCommandForRequiredThrust({
  engine,
  engineCount,
  propFullThrustN,
  requiredThrustN,
  useJet,
}: {
  engine: TurbineEngineOption;
  engineCount: number;
  propFullThrustN: number;
  requiredThrustN: number;
  useJet: boolean;
}) {
  if (!useJet) return Math.min(1, Math.max(0, Math.sqrt(requiredThrustN / Math.max(propFullThrustN, 0.001))));
  let low = 0;
  let high = 1;
  for (let index = 0; index < 28; index += 1) {
    const mid = (low + high) / 2;
    const jetThrustN = turbinePerformanceAtCommand(engine, mid).thrustN * engineCount;
    const totalThrustN = propFullThrustN * Math.pow(mid, 2) + jetThrustN;
    if (totalThrustN < requiredThrustN) low = mid;
    else high = mid;
  }
  return Math.min(1, Math.max(0, high));
}

function turbineFuelPerThrustFactor(engine: TurbineEngineOption, performance: TurbinePerformancePoint) {
  const maxFuelKgPerMin = Math.max(engine.fuelKgPerMin, 0.001);
  const maxThrustN = Math.max(engine.thrustN, 0.001);
  return performance.thrustN > 0 ? (performance.fuelKgPerMin / maxFuelKgPerMin) / (performance.thrustN / maxThrustN) : 0;
}

function turbinePerformanceAtCommand(engine: TurbineEngineOption, command: number): TurbinePerformancePoint {
  const commandPct = Math.min(100, Math.max(0, command * 100));
  const table = [...engine.performanceTable].sort((a, b) => a.commandPct - b.commandPct);
  const first = table[0] ?? { commandPct: 0, thrustN: engine.thrustN * 0.05, fuelKgPerMin: engine.fuelKgPerMin * 0.22 };
  const last = table[table.length - 1] ?? { commandPct: 100, thrustN: engine.thrustN, fuelKgPerMin: engine.fuelKgPerMin };
  if (commandPct <= first.commandPct) return { ...first, commandPct };
  if (commandPct >= last.commandPct) return { ...last, commandPct };
  const upperIndex = table.findIndex((point) => point.commandPct >= commandPct);
  const lower = table[Math.max(0, upperIndex - 1)];
  const upper = table[upperIndex];
  const span = Math.max(upper.commandPct - lower.commandPct, 0.001);
  const t = (commandPct - lower.commandPct) / span;
  return {
    commandPct,
    fuelKgPerMin: lower.fuelKgPerMin + (upper.fuelKgPerMin - lower.fuelKgPerMin) * t,
    thrustN: lower.thrustN + (upper.thrustN - lower.thrustN) * t,
  };
}

function cellVoltageAtSoc(socPct: number) {
  const pct = Math.min(100, Math.max(0, socPct)) / 100;
  return emptyCellVoltage + (fullCellVoltage - emptyCellVoltage) * pct;
}

function voltageThrustScale(socPct: number) {
  return Math.pow(cellVoltageAtSoc(socPct) / nominalCellVoltage, 2);
}

function propAvailableThrustAtBattery(nominalThrustN: number, socPct: number) {
  return nominalThrustN * voltageThrustScale(socPct);
}
