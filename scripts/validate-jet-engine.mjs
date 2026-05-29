import assert from "node:assert/strict";
import { computeJetComparison } from "../src/jetEngine.ts";
import { defaultSizingProject } from "../src/sizing/projectModel.ts";
import { turbineEngineOptions } from "../src/sketch/constants.ts";

for (const engine of turbineEngineOptions) {
  assert.equal(engine.performanceTable.length, 2, `${engine.model} uses only idle and max turbine endpoints`);
  const first = engine.performanceTable[0];
  const last = engine.performanceTable.at(-1);
  assert.equal(first.commandPct, 0, `${engine.model} table starts at idle command`);
  assert.equal(last.commandPct, 100, `${engine.model} table reaches full command`);
  assert.ok(Math.abs(last.thrustN - engine.thrustN) < 1e-9, `${engine.model} max table thrust matches database thrust`);
  assert.ok(Math.abs(last.fuelKgPerMin - engine.fuelKgPerMin) < 1e-9, `${engine.model} max table fuel matches database fuel`);
  assert.ok(first.fuelKgPerMin > 0, `${engine.model} has nonzero idle fuel burn`);
  assert.ok(last.thrustN >= first.thrustN, `${engine.model} thrust rises with command`);
  assert.ok(last.fuelKgPerMin >= first.fuelKgPerMin, `${engine.model} fuel flow rises with command`);
}

const sizingProject = {
  ...defaultSizingProject(),
  mission: {
    ...defaultSizingProject().mission,
    cruiseSpeedMS: 17,
    turbineEngineId: "swiwin-sw60b",
    turbineFuelMin: 20,
  },
};

const comparison = computeJetComparison({
  aircraftMassKg: 28.63,
  batteryEnergyDensityWhKg: 190,
  propulsionState: {
    selectedBatteryId: "pack-16s-20ah-20c",
    selectedMotorId: "motor-9225-150kv",
    selectedPropellerId: "apc-22x12e",
    targetEnduranceMin: 20,
    targetThrustToWeight: 1.3,
  },
  sizingProject,
});
const missionReservePct = sizingProject.mission.reservePct;

assert.equal(comparison.engineCount, 2, "jet model uses two selected turbine engines");
assert.equal(comparison.batteryName, "16S 20Ah 20C", "jet model uses the Propulsion-selected battery pack");
assert.equal(comparison.propOnlyMassKg, 28.63, "prop-only comparison uses the sketch aircraft mass directly");
assert.ok(Math.abs(comparison.aircraftMassKg - (28.63 + comparison.engineMassKg + comparison.fullFuelMassKg)) < 1e-9, "hybrid comparison adds engines and fuel on top of sketch mass");
assert.ok(Math.abs(comparison.basicEmptyWeight.propOnlyKg - (28.63 - sizingProject.mission.payloadKg)) < 1e-9, "prop-only BEW removes payload from sketch mass");
assert.ok(Math.abs(comparison.basicEmptyWeight.hybridKg - (28.63 - sizingProject.mission.payloadKg + comparison.engineMassKg)) < 1e-9, "hybrid BEW removes payload and keeps engines installed");
assert.equal(comparison.takeoffState.batterySocPct, 100, "takeoff state uses full battery");
assert.equal(comparison.takeoffState.fuelPct, 100, "takeoff state uses full fuel");
assert.equal(comparison.takeoffState.massKg, comparison.aircraftMassKg, "takeoff state uses full analysis mass");
assert.ok(comparison.takeoffState.propOnlyThrustToWeight > comparison.landing.propOnlyThrustToWeight * 0.5, "takeoff prop-only T/W is finite and nonzero");
assert.ok(comparison.takeoff.withoutJet.aircraftMassKg < comparison.takeoff.withJet.aircraftMassKg, "prop-only takeoff deletes turbine package mass");
const command80 = comparison.commandThrust.find((point) => point.commandPct === 80);
assert.ok(command80, "80% command point exists");
assert.equal(command80.motor.fuelBurnKgMin, 0, "motor-only comparison deletes turbine fuel burn");
assert.equal(command80.motor.jetThrustN, 0, "motor-only comparison deletes turbine thrust");
assert.equal(command80.motor.aircraftMassKg, comparison.propOnlyMassKg, "motor-only comparison uses prop-only mass");
assert.equal(command80.hybrid.motorCurrentA, command80.motor.motorCurrentA, "same command keeps motor current fixed");
assert.ok(command80.hybrid.totalThrustN > command80.motor.totalThrustN, "hybrid command adds jet thrust");
assert.ok(command80.hybrid.fuelBurnKgMin > 0, "hybrid command burns kerosene");
const command100 = comparison.commandThrust.find((point) => point.commandPct === 100);
assert.ok(command100, "100% command point exists");
assert.ok(Math.abs(command100.hybrid.fuelBurnKgMin - comparison.engine.fuelKgPerMin * comparison.engineCount) < 1e-9, "full-command hybrid fuel burn includes both turbine engines");
assert.ok(command80.hybrid.rangeNm > 0, "hybrid command produces a range estimate");
assert.equal(command80.hybrid.motorCurrentA, command80.motor.motorCurrentA, "hybrid command drives motor at the same command as the motor reference");
assert.ok(command80.hybrid.speedKt >= command80.motor.speedKt, "hybrid command does not reduce speed at the same command");
assert.ok(Number.isFinite(command80.hybrid.batteryEnduranceMin), "hybrid command reports battery time");
assert.ok(Number.isFinite(command80.hybrid.fuelEnduranceMin), "hybrid command reports fuel time");
assert.ok(["battery", "fuel"].includes(command80.hybrid.enduranceLimiter), "hybrid command reports the endurance limiter");
assert.ok(command80.hybrid.enduranceMin <= (comparison.fullFuelMassKg * (1 - missionReservePct / 100)) / command80.hybrid.fuelBurnKgMin + 0.001, "hybrid endurance keeps mission fuel reserve");
assert.ok(command80.motor.speedKt > 0, "motor command computes a drag-limited speed");
assert.ok(command80.hybrid.speedKt > 0, "hybrid command computes a drag-limited speed");
assert.equal(command80.motor.pitchOverspeedPct > 0, command80.motor.speedKt > command80.motor.pitchSpeedKt, "motor pitch overspeed flag follows computed speed");
assert.equal(command80.hybrid.pitchOverspeedPct > 0, command80.hybrid.speedKt > command80.hybrid.pitchSpeedKt, "hybrid pitch overspeed flag follows computed speed");
const command30 = comparison.commandThrust.find((point) => point.commandPct === 30);
assert.equal(command30.motor.pitchSpeedKt, command100.motor.pitchSpeedKt, "pitch limit is absolute and does not scale with command");
assert.equal(command30.hybrid.pitchSpeedKt, command100.hybrid.pitchSpeedKt, "hybrid pitch limit is absolute and does not scale with command");
assert.ok(command30.hybrid.fuelEfficiencyFactor > command80.hybrid.fuelEfficiencyFactor, "low jet command is less fuel efficient per thrust");
assert.equal(comparison.bestRangeSweep.length, 19, "hybrid best-range sweep covers 10% to 100% command in 5% steps");
assert.ok(comparison.bestRangeCommand.rangeNm >= Math.max(...comparison.bestRangeSweep.map((point) => point.rangeNm)), "best range command is the range maximum");
assert.ok(comparison.bestRangeSweep.some((point) => point.enduranceLimiter === "battery"), "best-range sweep includes battery-limited points");
assert.ok(comparison.landing.massKg < comparison.aircraftMassKg, "landing mass is lower after fuel burn");
assert.ok(comparison.dryMassKg > 1, "dry mass does not collapse below the selected fuel mass");
assert.equal(comparison.landing.fuelPct, missionReservePct, "landing keeps mission fuel reserve");
assert.equal(comparison.thrustCurve.at(-1).fuelPct, 10, "curve still samples down to 10% fuel for the visual sweep");
assert.equal(comparison.thrustCurve.at(-1).batteryPct, 10, "curve still samples down to 10% battery for the visual sweep");
assert.ok(comparison.thrustCurve[0].massKg > comparison.thrustCurve.at(-1).massKg, "curve burns fuel mass from full to reserve");
assert.ok(comparison.thrustCurve[0].propOnlyTW > comparison.thrustCurve.at(-1).propOnlyTW, "prop-only T/W drops as battery voltage sags");
for (const point of comparison.thrustCurve) {
  for (const value of Object.values(point)) {
    assert.ok(Number.isFinite(value), "curve contains finite values");
  }
}

console.log("Jet engine validation passed.");
