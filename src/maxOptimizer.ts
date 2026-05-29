import type { PropulsionTabState } from "./app/types";
import { computeJetComparison } from "./jetEngine";
import { batterySamples, computePropulsionSizing, motorSamples, propellerMassEstimate, propellerSamples, rotorDefinitionFromSizing } from "./propulsionEngine";
import { defaultTurbineCount, turbineEngineOptions } from "./sketch/constants";
import type { SizingProject } from "./sizing";

const metersPerSecondPerKnot = 0.514444;

export type MaxOptimizationCandidate = {
  batteryName: string;
  batteryMassKg: number;
  batteryTimeMin: number;
  commandPct: number;
  engineName: string;
  engineMassKg: number;
  fuelMassKg: number;
  fuelTimeMin: number;
  energyBalancePct: number;
  limiter: "battery" | "fuel" | "none";
  massKg: number;
  motorName: string;
  motorMassKg: number;
  motorPowerKw: number;
  pitchOverspeedPct: number;
  propellerDiameterM: number;
  propellerMassKg: number;
  propellerName: string;
  rangeNm: number;
  score: number;
  speedKt: number;
  status: "good" | "caution" | "bad";
  thrustToWeight: number;
  warnings: string[];
};

export type MaxOptimizationResult = {
  baseAircraftMassKg: number;
  evaluatedCount: number;
  fixedPayloadKg: number;
  minimumBatteryMassKg: number;
  results: MaxOptimizationCandidate[];
  rotorDiameterM: number;
  variableMassBaselineKg: number;
};

export function computeMaxOptimization({
  aircraftMassKg,
  batteryEnergyDensityWhKg,
  propulsionState,
  sizingProject,
}: {
  aircraftMassKg: number;
  batteryEnergyDensityWhKg: number;
  propulsionState: PropulsionTabState;
  sizingProject: SizingProject;
}): MaxOptimizationResult {
  const rotorDefinition = rotorDefinitionFromSizing(sizingProject);
  const rotorCount = Math.max(1, rotorDefinition.count);
  const bladeCount = Math.max(1, rotorDefinition.bladeCount);
  const targetThrustToWeight = Math.max(propulsionState.targetThrustToWeight, 0.1);
  const variableMassBaselineKg = selectedVariableMassKg(propulsionState, rotorCount);
  const baseAircraftMassKg = Math.max(0.1, aircraftMassKg - variableMassBaselineKg);
  const currentBattery = batterySamples.find((candidate) => candidate.id === propulsionState.selectedBatteryId) ?? batterySamples[0];
  const currentComparison = computeJetComparison({
    aircraftMassKg,
    batteryEnergyDensityWhKg,
    propulsionState,
    sizingProject,
  });
  const currentBatteryLimited = currentComparison.bestRangeCommand.enduranceLimiter === "battery";
  const minimumBatteryMassKg = currentBatteryLimited ? currentBattery.massKg : 0;
  const fuelMinutes = uniqueSorted([5, 10, 15, 20, 30, 45, 60, sizingProject.mission.turbineFuelMin]).filter((value) => value > 0);
  const propulsionCandidates = prefilterPropulsionCandidates({
    baseAircraftMassKg,
    batteryEnergyDensityWhKg,
    bladeCount,
    minimumBatteryMassKg,
    rotorCount,
    rotorDiameterM: rotorDefinition.diameterM,
    targetThrustToWeight,
  });
  const results: MaxOptimizationCandidate[] = [];
  let evaluatedCount = 0;

  for (const propulsion of propulsionCandidates) {
    for (const engine of turbineEngineOptions) {
      for (const fuelMin of fuelMinutes) {
        evaluatedCount += 1;
        const candidateAircraftMassKg = propulsion.aircraftMassKg;
        const candidateProject: SizingProject = {
          ...sizingProject,
          mission: {
            ...sizingProject.mission,
            turbineEngineId: engine.id,
            turbineFuelMin: fuelMin,
          },
        };
        const candidateState: PropulsionTabState = {
          ...propulsionState,
          selectedBatteryId: propulsion.battery.id,
          selectedMotorId: propulsion.motor.id,
          selectedPropellerId: propulsion.propeller.id,
        };
        const comparison = computeJetComparison({
          aircraftMassKg: candidateAircraftMassKg,
          batteryEnergyDensityWhKg,
          propulsionState: candidateState,
          sizingProject: candidateProject,
        });
        const best = comparison.bestRangeCommand;
        const energyBalancePct = enduranceBalancePct(best.batteryEnduranceMin, best.fuelEnduranceMin);
        const warnings = candidateWarnings({
          batteryCurrentA: best.batteryCurrentA,
          batteryMaxCurrentA: propulsion.sizing.batteryMaxCurrentA,
          energyBalancePct,
          motorPowerW: propulsion.sizing.powerPerMotorW,
          motorLimitW: propulsion.motor.continuousPowerW,
          pitchOverspeedPct: best.pitchOverspeedPct,
          thrustToWeight: comparison.takeoffState.hybridThrustToWeight,
          targetThrustToWeight,
        });
        const status = warnings.some((warning) => warning.startsWith("Fail"))
          ? "bad"
          : warnings.length
            ? "caution"
            : "good";
        const balancePenalty = energyBalancePct * 1.8;
        const limiterPenalty = best.enduranceLimiter === "battery" ? 12 : best.enduranceLimiter === "fuel" ? 4 : 0;
        const score =
          best.rangeNm -
          balancePenalty -
          limiterPenalty -
          best.pitchOverspeedPct * 6 -
          warnings.filter((warning) => warning.startsWith("Fail")).length * 1000 -
          warnings.filter((warning) => !warning.startsWith("Fail")).length * 18;
        results.push({
          batteryName: propulsion.battery.name,
          batteryMassKg: propulsion.battery.massKg,
          batteryTimeMin: best.batteryEnduranceMin,
          commandPct: best.commandPct,
          energyBalancePct,
          engineName: `${engine.maker} ${engine.model}`,
          engineMassKg: engine.engineWeightKg * defaultTurbineCount,
          fuelMassKg: engine.fuelKgPerMin * fuelMin * defaultTurbineCount,
          fuelTimeMin: best.fuelEnduranceMin,
          limiter: best.enduranceLimiter,
          massKg: comparison.aircraftMassKg,
          motorName: propulsion.motor.name,
          motorMassKg: (propulsion.motor.massG / 1000) * rotorCount,
          motorPowerKw: propulsion.motor.continuousPowerW / 1000,
          pitchOverspeedPct: best.pitchOverspeedPct,
          propellerDiameterM: propulsion.propeller.diameterIn * 0.0254,
          propellerMassKg: propellerMassEstimate(propulsion.propeller) * rotorCount,
          propellerName: propulsion.propeller.name,
          rangeNm: best.rangeNm,
          score,
          speedKt: best.speedKt,
          status,
          thrustToWeight: comparison.takeoffState.hybridThrustToWeight,
          warnings,
        });
      }
    }
  }

  return {
    baseAircraftMassKg,
    evaluatedCount,
    fixedPayloadKg: Math.max(sizingProject.mission.payloadKg, 0),
    minimumBatteryMassKg,
    results: sortCandidates(results).slice(0, 24),
    rotorDiameterM: rotorDefinition.diameterM,
    variableMassBaselineKg,
  };
}

function prefilterPropulsionCandidates({
  baseAircraftMassKg,
  batteryEnergyDensityWhKg,
  bladeCount,
  minimumBatteryMassKg,
  rotorCount,
  rotorDiameterM,
  targetThrustToWeight,
}: {
  baseAircraftMassKg: number;
  batteryEnergyDensityWhKg: number;
  bladeCount: number;
  minimumBatteryMassKg: number;
  rotorCount: number;
  rotorDiameterM: number;
  targetThrustToWeight: number;
}) {
  const candidates = [];
  for (const battery of batterySamples) {
    if (battery.massKg < minimumBatteryMassKg - 0.001) continue;
    for (const motor of motorSamples) {
      for (const propeller of propellerSamples) {
        const propDiameterM = propeller.diameterIn * 0.0254;
        if (rotorDiameterM > 0 && (propDiameterM < rotorDiameterM * 0.75 || propDiameterM > rotorDiameterM * 1.12)) continue;
        const variableMassKg = battery.massKg + (motor.massG / 1000) * rotorCount + propellerMassEstimate(propeller) * rotorCount;
        const aircraftMassKg = Math.max(0.1, baseAircraftMassKg + variableMassKg);
        const sizing = computePropulsionSizing(
          aircraftMassKg,
          rotorCount,
          bladeCount,
          rotorDiameterM || propDiameterM,
          { rotorPitchIn: propeller.pitchIn },
          { cells: battery.cells, cRating: battery.cRating },
          battery.massKg,
          batteryEnergyDensityWhKg,
          propeller,
          motor,
          battery,
        );
        const currentRatio = sizing.currentPerMotorA / Math.max(motor.maxCurrentA, 0.001);
        const powerRatio = sizing.powerPerMotorW / Math.max(motor.continuousPowerW, 0.001);
        const batteryRatio = sizing.takeoffCurrentA / Math.max(sizing.batteryMaxCurrentA, 0.001);
        if (currentRatio > 1.25 || powerRatio > 1.25 || batteryRatio > 1.25) continue;
        if (sizing.availableThrustToWeight < targetThrustToWeight * 0.72) continue;
        const pitchSpeedKt = sizing.pitchSpeedMS / metersPerSecondPerKnot;
        const score =
          sizing.availableThrustToWeight * 150 +
          pitchSpeedKt * 1.2 +
          battery.massKg * 3.2 +
          Math.max(0, currentRatio - 0.85) * 80 -
          Math.max(0, powerRatio - 0.85) * 80 -
          Math.abs(propDiameterM - (rotorDiameterM || propDiameterM)) * 10;
        candidates.push({ aircraftMassKg, battery, motor, propeller, score, sizing });
      }
    }
  }
  return candidates.sort((a, b) => b.score - a.score).slice(0, 90);
}

function sortCandidates(candidates: MaxOptimizationCandidate[]) {
  return [...candidates].sort((a, b) => {
    const statusRank = statusScore(b.status) - statusScore(a.status);
    if (statusRank) return statusRank;
    return b.score - a.score;
  });
}

function statusScore(status: MaxOptimizationCandidate["status"]) {
  if (status === "good") return 2;
  if (status === "caution") return 1;
  return 0;
}

function selectedVariableMassKg(propulsionState: PropulsionTabState, rotorCount: number) {
  const battery = batterySamples.find((candidate) => candidate.id === propulsionState.selectedBatteryId) ?? batterySamples[0];
  const motor = motorSamples.find((candidate) => candidate.id === propulsionState.selectedMotorId) ?? motorSamples[0];
  const propeller = propellerSamples.find((candidate) => candidate.id === propulsionState.selectedPropellerId) ?? propellerSamples[0];
  return battery.massKg + (motor.massG / 1000) * rotorCount + propellerMassEstimate(propeller) * rotorCount;
}

function candidateWarnings({
  batteryCurrentA,
  batteryMaxCurrentA,
  energyBalancePct,
  motorLimitW,
  motorPowerW,
  pitchOverspeedPct,
  targetThrustToWeight,
  thrustToWeight,
}: {
  batteryCurrentA: number;
  batteryMaxCurrentA: number;
  energyBalancePct: number;
  motorLimitW: number;
  motorPowerW: number;
  pitchOverspeedPct: number;
  targetThrustToWeight: number;
  thrustToWeight: number;
}) {
  const warnings: string[] = [];
  if (thrustToWeight < targetThrustToWeight) warnings.push("Fail takeoff T/W");
  if (batteryCurrentA > batteryMaxCurrentA) warnings.push("Fail battery current");
  if (motorPowerW > motorLimitW) warnings.push("Fail motor power");
  if (pitchOverspeedPct > 0.5) warnings.push("Fail prop pitch overspeed");
  if (energyBalancePct > 45) warnings.push("Poor fuel/battery match");
  else if (energyBalancePct > 20) warnings.push("Loose fuel/battery match");
  return warnings;
}

function uniqueSorted(values: number[]) {
  return [...new Set(values.map((value) => Math.round(value * 10) / 10))].sort((a, b) => a - b);
}

function enduranceBalancePct(batteryTimeMin: number, fuelTimeMin: number) {
  if (!Number.isFinite(batteryTimeMin) || !Number.isFinite(fuelTimeMin) || batteryTimeMin <= 0 || fuelTimeMin <= 0) return 0;
  return (Math.abs(batteryTimeMin - fuelTimeMin) / Math.max(Math.min(batteryTimeMin, fuelTimeMin), 0.001)) * 100;
}
