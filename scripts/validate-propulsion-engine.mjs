import assert from "node:assert/strict";
import {
  batteryMassFromSizing,
  batterySamples,
  computePropulsionSizing,
  findBestPropulsionCombo,
  motorSamples,
  propellerMassEstimate,
  propellerSamples,
  rotorDefinitionFromSizing,
} from "../src/propulsionEngine.ts";

const aircraftMassKg = 6;
const motorCount = 2;
const bladeCount = 3;
const rotorDiameterM = 0.6;
const batteryMassKg = 1.2;
const batteryEnergyDensityWhKg = 190;
const inputs = {
  rotorPitchIn: 10,
};
const battery = {
  cells: 8,
  cRating: 20,
};

const result = computePropulsionSizing(
  aircraftMassKg,
  motorCount,
  bladeCount,
  rotorDiameterM,
  inputs,
  battery,
  batteryMassKg,
  batteryEnergyDensityWhKg,
);

const voltage = battery.cells * 3.7;
const totalThrustN = aircraftMassKg * 9.80665 * 1.6;
const thrustPerMotorN = totalThrustN / motorCount;
const diskAreaPerRotorM2 = Math.PI * Math.pow(rotorDiameterM / 2, 2);
const diskLoadingNpm2 = thrustPerMotorN / diskAreaPerRotorM2;
const fallbackRpm = 5200;
const pitchSpeedMS = (inputs.rotorPitchIn * 0.0254 * fallbackRpm) / 60;
const pitchSpeedPenalty = Math.max(0, (pitchSpeedMS - 24) / 400);
const diskLoadingPenalty = Math.max(0, (diskLoadingNpm2 - 80) / 1000);
const effectivePropEfficiency = 0.74 - (bladeCount - 2) * 0.025 - diskLoadingPenalty - pitchSpeedPenalty;
const inducedVelocityMS = Math.sqrt(thrustPerMotorN / (2 * 1.225 * diskAreaPerRotorM2));
const powerPerMotorW = (thrustPerMotorN * inducedVelocityMS) / effectivePropEfficiency;
const totalPowerW = powerPerMotorW * motorCount;
const batteryCapacityAh = (batteryMassKg * batteryEnergyDensityWhKg) / voltage;
const takeoffCurrentA = totalPowerW / voltage;
const cruiseCurrentA = (totalPowerW * 0.45) / voltage;

approx(result.totalThrustN, totalThrustN, "total thrust from mass and thrust-to-weight");
approx(result.thrustPerMotorN, thrustPerMotorN, "thrust split across motors");
approx(result.availableThrustToWeight, 1.6, "fallback thrust-to-weight is computed, not user-entered");
approx(result.diskAreaPerRotorM2, diskAreaPerRotorM2, "disk area from Sizing rotor diameter");
approx(result.effectiveDiskLoadingNpm2, diskLoadingNpm2, "disk loading inferred from disk area");
approx(result.rotorDiameterM, rotorDiameterM, "Sizing rotor diameter is preserved");
approx(result.pitchSpeedMS, pitchSpeedMS, "pitch speed from pitch and RPM");
approx(result.effectivePropEfficiency, effectivePropEfficiency, "efficiency penalty from blade count, disk loading, and pitch speed");
approx(result.powerPerMotorW, powerPerMotorW, "actuator-disk power per motor");
approx(result.recommendedMotorW, powerPerMotorW * 1.25, "motor continuous rating margin");
approx(result.currentPerMotorA, powerPerMotorW / voltage, "current per motor");
approx(result.recommendedEscA, (powerPerMotorW / voltage) * 1.3, "ESC current margin");
approx(result.batteryCapacityAh, batteryCapacityAh, "battery Ah from battery mass and Wh/kg");
approx(result.batteryMaxCurrentA, batteryCapacityAh * battery.cRating, "battery max current from Ah and C rating");
approx(result.takeoffCurrentA, takeoffCurrentA, "takeoff current");
approx(result.cruiseCurrentA, cruiseCurrentA, "cruise current at 45% takeoff power");
approx(
  result.enduranceMin,
  (batteryCapacityAh * 0.2 / takeoffCurrentA) * 60 + (batteryCapacityAh * 0.8 / cruiseCurrentA) * 60,
  "endurance split between 20% takeoff and 80% cruise",
);

const twoBlade = computePropulsionSizing(aircraftMassKg, motorCount, 2, rotorDiameterM, inputs, battery, batteryMassKg, batteryEnergyDensityWhKg);
const fourBlade = computePropulsionSizing(aircraftMassKg, motorCount, 4, rotorDiameterM, inputs, battery, batteryMassKg, batteryEnergyDensityWhKg);
assert.ok(twoBlade.effectivePropEfficiency > result.effectivePropEfficiency, "2-blade comparison is more efficient than 3-blade");
assert.ok(result.effectivePropEfficiency > fourBlade.effectivePropEfficiency, "3-blade comparison is more efficient than 4-blade");
approx(twoBlade.effectiveDiskLoadingNpm2, fourBlade.effectiveDiskLoadingNpm2, "blade comparisons keep inferred disk loading fixed when Sizing diameter is fixed");

const fallback = computePropulsionSizing(aircraftMassKg, motorCount, 4, 0, inputs, battery, batteryMassKg, batteryEnergyDensityWhKg);
approx(fallback.effectiveDiskLoadingNpm2, 85 * Math.sqrt(4 / 2), "missing rotor geometry falls back to blade-count disk loading");
assert.ok(fallback.rotorDiameterM > 0, "missing rotor geometry still produces a rotor diameter estimate");

assert.ok(propellerSamples.length >= 10, "sample propeller dropdown has broad APC-style designs");
assert.ok(motorSamples.length >= 10, "sample motor dropdown has broad representative motor sizes");
assert.ok(batterySamples.length >= 10, "sample battery dropdown has broad representative packs");
const samplePropeller = propellerSamples.find((propeller) => propeller.id === "apc-20x10e");
const sampleMotor = motorSamples.find((motor) => motor.id === "motor-4225-390kv");
const sampleBattery = batterySamples.find((batteryPack) => batteryPack.id === "pack-8s-8ah-25c");
assert.ok(samplePropeller, "APC 20x10E sample exists");
assert.ok(sampleMotor, "4225 390 Kv sample motor exists");
assert.ok(sampleBattery, "8S sample battery exists");
const sampleResult = computePropulsionSizing(
  aircraftMassKg,
  motorCount,
  bladeCount,
  rotorDiameterM,
  inputs,
  battery,
  batteryMassKg,
  batteryEnergyDensityWhKg,
  samplePropeller,
  sampleMotor,
);
const sampleDiameterM = samplePropeller.diameterIn * 0.0254;
const sampleDiskAreaM2 = Math.PI * Math.pow(sampleDiameterM / 2, 2);
const sampleNoLoadRpm = sampleMotor.kvRpmV * voltage;
const sampleMotorVoltageLoadedRpm = sampleNoLoadRpm * 0.82;
const sampleMotorPowerLimitedRpm = samplePropeller.staticRpm * Math.pow(sampleMotor.continuousPowerW / samplePropeller.staticPowerW, 1 / 3);
const sampleLoadedRpm = Math.min(sampleMotorVoltageLoadedRpm, sampleMotorPowerLimitedRpm);
const samplePitchSpeedMS = (samplePropeller.pitchIn * 0.0254 * sampleLoadedRpm) / 60;
const sampleRpmRatio = sampleLoadedRpm / samplePropeller.staticRpm;
const sampleThrustPerMotorN = samplePropeller.staticThrustN * Math.pow(sampleRpmRatio, 2);
const sampleTotalThrustN = sampleThrustPerMotorN * motorCount;
const samplePowerPerMotorW = samplePropeller.staticPowerW * Math.pow(sampleRpmRatio, 3);
approx(sampleResult.rotorDiameterM, sampleDiameterM, "selected propeller diameter overrides the Sizing rotor diameter for propulsion calculations");
approx(sampleResult.diskAreaPerRotorM2, sampleDiskAreaM2, "selected propeller disk area comes from real sample diameter");
approx(sampleResult.motorNoLoadRpm, sampleNoLoadRpm, "selected motor no-load rpm comes from Kv and pack voltage");
approx(sampleResult.motorPowerLimitedRpm, sampleMotorPowerLimitedRpm, "selected motor power limit constrains propeller rpm");
approx(sampleResult.motorLoadedRpm, sampleLoadedRpm, "operating rpm is computed from motor Kv, voltage, and propeller load");
approx(sampleResult.pitchSpeedMS, samplePitchSpeedMS, "selected propeller pitch comes from real sample data");
approx(sampleResult.effectivePropEfficiency, samplePropeller.peakEfficiency, "selected propeller efficiency comes from APC peak efficiency data");
approx(sampleResult.thrustPerMotorN, sampleThrustPerMotorN, "selected propeller thrust per motor is computed from APC static thrust");
approx(sampleResult.totalThrustN, sampleTotalThrustN, "selected propeller total thrust is computed from propeller data and rotor count");
approx(sampleResult.availableThrustToWeight, sampleTotalThrustN / (aircraftMassKg * 9.80665), "selected propeller thrust-to-weight is computed from available thrust");
approx(sampleResult.powerPerMotorW, samplePowerPerMotorW, "selected propeller power scales from APC static data");
approx(sampleResult.propellerStaticThrustPerMotorN, sampleThrustPerMotorN, "selected propeller static thrust scales with rpm squared");
approx(sampleResult.propellerStaticPowerPerMotorW, samplePowerPerMotorW, "selected propeller static power scales with rpm cubed");
const samplePackResult = computePropulsionSizing(
  aircraftMassKg,
  motorCount,
  bladeCount,
  rotorDiameterM,
  inputs,
  { cells: sampleBattery.cells, cRating: sampleBattery.cRating },
  batteryMassKg,
  batteryEnergyDensityWhKg,
  samplePropeller,
  sampleMotor,
  sampleBattery,
);
approx(samplePackResult.batteryCapacityAh, sampleBattery.capacityAh, "selected battery pack supplies capacity directly");
approx(samplePackResult.batteryMassKg, sampleBattery.massKg, "selected battery pack supplies mass directly");
approx(samplePackResult.batteryMaxCurrentA, sampleBattery.capacityAh * sampleBattery.cRating, "selected battery pack supplies current limit");

const bestCombo = findBestPropulsionCombo({
  aircraftMassKg,
  batteryEnergyDensityWhKg,
  batteryMassKg,
  bladeCount,
  rotorDefinition: { bladeCount, count: motorCount, diameterM: rotorDiameterM },
  target: { minEnduranceMin: 15, targetThrustToWeight: 1.3 },
});
assert.ok(bestCombo, "best-combo search returns a motor/prop/battery candidate");
assert.ok(bestCombo.result.availableThrustToWeight >= 1.3, "best-combo search meets target thrust-to-weight");
assert.ok(bestCombo.result.enduranceMin >= 15, "best-combo search meets target endurance");
assert.ok(bestCombo.result.currentPerMotorA <= bestCombo.motor.maxCurrentA, "best-combo search respects motor current limit");
assert.ok(bestCombo.result.powerPerMotorW <= bestCombo.motor.continuousPowerW, "best-combo search respects motor continuous power");
assert.ok(bestCombo.result.takeoffCurrentA <= bestCombo.result.batteryMaxCurrentA, "best-combo search respects battery current limit");
assert.ok(bestCombo.propellerMassKg >= propellerMassEstimate(bestCombo.propeller) * motorCount, "best-combo reports installed propeller mass");

const sizingProject = {
  mission: {
    payloadKg: 1,
    cruiseSpeedMS: 17,
    enduranceMin: 20,
    batteryEnergyDensityWhKg,
    motorCount,
  },
  selectedShapeId: "",
  activeRole: "part",
  drawMode: "line",
  shapes: [
    {
      id: "mirror",
      role: "mirrorPlane",
      label: "Mirror",
      drawMode: "line",
      points: [
        { xM: 0.1, yM: 0 },
        { xM: 0.1, yM: 0.4 },
      ],
    },
    {
      id: "battery",
      role: "part",
      partType: "battery",
      label: "Battery",
      drawMode: "line",
      points: [
        { xM: 0, yM: -0.05 },
        { xM: 0.1, yM: -0.05 },
        { xM: 0.1, yM: 0.05 },
        { xM: 0, yM: 0.05 },
      ],
    },
    {
      id: "rotor",
      role: "part",
      partType: "rotor",
      rotorBladeCount: 4,
      label: "Rotor",
      drawMode: "line",
      points: [
        { xM: 0.1, yM: 0.2 },
        { xM: 0.4, yM: 0.2 },
      ],
    },
  ],
};

const expectedBatteryMassKg = 0.02 * 0.028 * 1700;
approx(batteryMassFromSizing(sizingProject), expectedBatteryMassKg, "Propulsion receives inferred battery mass from Sizing");
const rotorDefinition = rotorDefinitionFromSizing(sizingProject);
assert.equal(rotorDefinition.bladeCount, 4, "Propulsion receives blade count from actual sketch rotor");
assert.equal(rotorDefinition.count, 4, "Propulsion receives actual physical rotor count after local and origin mirrors");
approx(rotorDefinition.diameterM, 0.6, "Propulsion receives rotor diameter from actual sketch rotor");
assert.deepEqual(
  rotorDefinitionFromSizing({ ...sizingProject, shapes: [] }),
  { bladeCount: 2, count: motorCount, diameterM: 0 },
  "missing rotor geometry falls back to sizing motor count",
);

console.log("Propulsion engine validation passed.");

function approx(actual, expected, label, tolerance = 1e-9) {
  assert.ok(
    Math.abs(actual - expected) <= tolerance,
    `${label}: expected ${expected}, got ${actual}`,
  );
}
