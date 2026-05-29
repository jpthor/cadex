import type { PropulsionTabState } from "./app/types";
import { batterySamples, computePropulsionSizing, motorSamples, propellerSamples, rotorDefinitionFromSizing } from "./propulsionEngine.ts";
import type { RotorDefinition } from "./propulsionEngine";
import { defaultTurbineCount, turbineEngineOptions } from "./sketch/constants.ts";
import type { TurbineEngineOption, TurbinePerformancePoint } from "./sketch/constants";
import { computeSketchAerodynamics } from "./sizing/index.ts";
import type { SizingProject, SketchAeroComputation } from "./sizing";

const gravity = 9.80665;
const metersPerSecondPerKnot = 0.514444;
const fullCellVoltage = 4.2;
const nominalCellVoltage = 3.7;
const emptyCellVoltage = 3.3;

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
  jetThrustN: number;
  motorCurrentA: number;
  motorPowerW: number;
  pitchOverspeedPct: number;
  pitchSpeedKt: number;
  propThrustN: number;
  rangeNm: number;
  speedKt: number;
  totalThrustN: number;
};

export type JetComparison = {
  aircraftMassKg: number;
  batteryCapacityAh: number;
  batteryMassKg: number;
  batteryName: string;
  batteryVoltageNominalV: number;
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
  propFullBatteryThrustN: number;
  propFullPitchSpeedKt: number;
  propNominalThrustN: number;
  selectedCommand: { condition: JetCondition; motorReference: JetCondition };
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
    propFullCurrentPerMotorA: propulsion.fullBatteryCurrentPerMotorA,
    propFullPowerPerMotorW: propulsion.fullBatteryPowerPerMotorW,
    propFullThrustN: propulsion.fullBatteryThrustN,
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
  const bestRangeSweep = Array.from({ length: 19 }, (_, index) => buildCommandPoint((10 + index * 5) / 100).hybrid);
  const bestRangeCommand = bestRangeSweep.reduce((best, point) => (point.rangeNm > best.rangeNm ? point : best), bestRangeSweep[0]);
  const selectedCommandValue = Math.min(1, Math.max(0, (input.commandPct ?? 80) / 100));
  const selectedCommandPoint = buildCommandPoint(selectedCommandValue);
  const selectedCommand = {
    condition: selectedCommandPoint.hybrid,
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
    propFullBatteryThrustN: propulsion.fullBatteryThrustN,
    propFullPitchSpeedKt: propulsion.fullPitchSpeedKt,
    propNominalThrustN: propulsion.nominalThrustN,
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
  const fullBatteryThrustN = propAvailableThrustAtBattery(result.staticThrustTotalN, 100);
  return {
    fullBatteryCurrentPerMotorA: result.currentPerMotorA * voltageThrustScale(100),
    fullBatteryPowerPerMotorW: result.powerPerMotorW * Math.pow(cellVoltageAtSoc(100) / nominalCellVoltage, 3),
    fullBatteryThrustN,
    fullPitchSpeedKt: (result.pitchSpeedMS * (fullCellVoltage / nominalCellVoltage)) / metersPerSecondPerKnot,
    nominalThrustN: result.staticThrustTotalN,
    totalPowerW: result.totalPowerW,
  };
}

function solveCommandCondition({
  aircraftMassKg,
  aero,
  batteryCapacityAh,
  command,
  engine,
  engineCount,
  fuelMassKg,
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
  engine: TurbineEngineOption;
  engineCount: number;
  fuelMassKg: number;
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
    pitchSpeedKt: pitchSpeedKt * safeCommand,
    totalThrustN,
  });
  const batteryEnduranceMin = batteryCurrentA > 0 ? (batteryCapacityAh * usableReserveFraction / batteryCurrentA) * 60 : Number.POSITIVE_INFINITY;
  const fuelEnduranceMin = fuelBurnKgMin > 0 ? fuelMassKg / fuelBurnKgMin : Number.POSITIVE_INFINITY;
  const enduranceMin = Math.min(batteryEnduranceMin, fuelEnduranceMin);
  return {
    aircraftMassKg,
    batteryCurrentA,
    batteryPowerW,
    batteryEnduranceMin,
    commandPct: safeCommand * 100,
    enduranceMin,
    enduranceLimiter: enduranceLimiter(batteryEnduranceMin, fuelEnduranceMin),
    fuelBurnKgMin,
    fuelEfficiencyFactor: useJet ? turbineFuelPerThrustFactor(engine, turbinePerformance) : 0,
    fuelEnduranceMin,
    jetThrustN,
    motorCurrentA,
    motorPowerW,
    pitchOverspeedPct: speedEstimate.pitchOverspeedPct,
    pitchSpeedKt,
    propThrustN,
    rangeNm: Number.isFinite(enduranceMin) ? speedEstimate.speedKt * (enduranceMin / 60) : 0,
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
    fuelEnduranceMin,
    jetThrustN,
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

function enduranceLimiter(batteryEnduranceMin: number, fuelEnduranceMin: number): "battery" | "fuel" | "none" {
  if (!Number.isFinite(batteryEnduranceMin) && !Number.isFinite(fuelEnduranceMin)) return "none";
  return batteryEnduranceMin <= fuelEnduranceMin ? "battery" : "fuel";
}

function estimateCommandSpeedKt({
  aero,
  pitchSpeedKt,
  totalThrustN,
}: {
  aero: SketchAeroComputation;
  pitchSpeedKt: number;
  totalThrustN: number;
}) {
  if (totalThrustN <= 0) return { pitchOverspeedPct: 0, speedKt: 0 };
  const dragReferenceAreaM2 = aero.geometry.dragReferenceAreaM2;
  const dragCoefficient = aero.aerodynamics.dragCoefficient;
  const rhoKgM3 = aero.assumptions.rhoKgM3;
  const hasDragModel = aero.validity.drag && dragReferenceAreaM2 > 0.001 && dragCoefficient > 0.001 && rhoKgM3 > 0;
  const dragLimitedKt = hasDragModel
    ? Math.sqrt((2 * totalThrustN) / Math.max(rhoKgM3 * dragReferenceAreaM2 * dragCoefficient, 0.001)) / metersPerSecondPerKnot
    : pitchSpeedKt;
  const pitchLimitKt = Math.max(0, pitchSpeedKt);
  const speedKt = Math.max(0, dragLimitedKt);
  const pitchOverspeedPct = pitchLimitKt > 0 ? Math.max(0, (speedKt / pitchLimitKt - 1) * 100) : 0;
  return { pitchOverspeedPct, speedKt };
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
