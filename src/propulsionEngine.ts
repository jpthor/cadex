import { batteryMassEstimate, rotorDiameterEstimate, rotorInstanceCount } from "./sizing/auditedSizingEngine.ts";
import type { SizingProject } from "./sizing";

const fixedRotorCount = 2;

export type PropulsionInputs = {
  rotorPitchIn: number;
};

export type MotorSample = {
  continuousPowerW: number;
  id: string;
  kvRpmV: number;
  massG: number;
  maxCurrentA: number;
  name: string;
};

export const motorSamples: MotorSample[] = [
  { id: "motor-2212-920kv", name: "2212 920 Kv", kvRpmV: 920, continuousPowerW: 180, maxCurrentA: 18, massG: 56 },
  { id: "motor-2814-700kv", name: "2814 700 Kv", kvRpmV: 700, continuousPowerW: 420, maxCurrentA: 35, massG: 115 },
  { id: "motor-3515-650kv", name: "3515 650 Kv", kvRpmV: 650, continuousPowerW: 650, maxCurrentA: 48, massG: 165 },
  { id: "motor-3520-520kv", name: "3520 520 Kv", kvRpmV: 520, continuousPowerW: 850, maxCurrentA: 55, massG: 210 },
  { id: "motor-4120-465kv", name: "4120 465 Kv", kvRpmV: 465, continuousPowerW: 1100, maxCurrentA: 65, massG: 295 },
  { id: "motor-4225-390kv", name: "4225 390 Kv", kvRpmV: 390, continuousPowerW: 1450, maxCurrentA: 75, massG: 390 },
  { id: "motor-5020-340kv", name: "5020 340 Kv", kvRpmV: 340, continuousPowerW: 1900, maxCurrentA: 85, massG: 520 },
  { id: "motor-5325-280kv", name: "5325 280 Kv", kvRpmV: 280, continuousPowerW: 2400, maxCurrentA: 95, massG: 650 },
  { id: "motor-6310-250kv", name: "6310 250 Kv", kvRpmV: 250, continuousPowerW: 3200, maxCurrentA: 110, massG: 820 },
  { id: "motor-8017-170kv", name: "8017 170 Kv", kvRpmV: 170, continuousPowerW: 5200, maxCurrentA: 140, massG: 1280 },
  { id: "motor-9225-150kv", name: "9225 150 Kv", kvRpmV: 150, continuousPowerW: 7600, maxCurrentA: 170, massG: 1780 },
  { id: "motor-10020-120kv", name: "10020 120 Kv", kvRpmV: 120, continuousPowerW: 9800, maxCurrentA: 210, massG: 2400 },
  { id: "motor-af120-100kv-10kw", name: "Axial flux 120 100 Kv", kvRpmV: 100, continuousPowerW: 10000, maxCurrentA: 180, massG: 3200 },
  { id: "motor-af140-90kv-12kw", name: "Axial flux 140 90 Kv", kvRpmV: 90, continuousPowerW: 12000, maxCurrentA: 220, massG: 3900 },
  { id: "motor-af160-75kv-15kw", name: "Axial flux 160 75 Kv", kvRpmV: 75, continuousPowerW: 15000, maxCurrentA: 260, massG: 4800 },
  { id: "motor-12030-90kv", name: "12030 90 Kv", kvRpmV: 90, continuousPowerW: 14500, maxCurrentA: 260, massG: 3900 },
  { id: "motor-16035-70kv", name: "16035 70 Kv", kvRpmV: 70, continuousPowerW: 22000, maxCurrentA: 320, massG: 6200 },
  { id: "motor-20040-55kv", name: "20040 55 Kv", kvRpmV: 55, continuousPowerW: 32000, maxCurrentA: 420, massG: 9200 },
];

export type PropellerSample = {
  diameterIn: number;
  id: string;
  name: string;
  peakEfficiency: number;
  peakEfficiencyMph: number;
  peakEfficiencyRpm: number;
  peakPowerW: number;
  peakThrustN: number;
  pitchIn: number;
  source: string;
  staticPowerW: number;
  staticRpm: number;
  staticThrustN: number;
};

export const propellerSamples: PropellerSample[] = [
  { id: "apc-10x6e", name: "APC 10x6E", diameterIn: 10, pitchIn: 6, staticRpm: 6000, staticThrustN: 5.74, staticPowerW: 57.4, peakEfficiency: 0.764, peakEfficiencyRpm: 20000, peakEfficiencyMph: 107.1, peakPowerW: 1445.6, peakThrustN: 23.08, source: "APC PER3_10x6E.dat" },
  { id: "apc-12x6e", name: "APC 12x6E", diameterIn: 12, pitchIn: 6, staticRpm: 6000, staticThrustN: 9.81, staticPowerW: 103.4, peakEfficiency: 0.738, peakEfficiencyRpm: 16000, peakEfficiencyMph: 84.9, peakPowerW: 1378.7, peakThrustN: 26.8, source: "APC PER3_12x6E.dat" },
  { id: "apc-13x8e", name: "APC 13x8E", diameterIn: 13, pitchIn: 8, staticRpm: 6000, staticThrustN: 14.58, staticPowerW: 176.4, peakEfficiency: 0.79, peakEfficiencyRpm: 15000, peakEfficiencyMph: 106.6, peakPowerW: 2045.3, peakThrustN: 33.89, source: "APC PER3_13x8E.dat" },
  { id: "apc-14x7e", name: "APC 14x7E", diameterIn: 14, pitchIn: 7, staticRpm: 6000, staticThrustN: 16.95, staticPowerW: 198.4, peakEfficiency: 0.751, peakEfficiencyRpm: 14000, peakEfficiencyMph: 86.2, peakPowerW: 1873.6, peakThrustN: 36.5, source: "APC PER3_14x7E.dat" },
  { id: "apc-15x8e", name: "APC 15x8E", diameterIn: 15, pitchIn: 8, staticRpm: 6000, staticThrustN: 23.16, staticPowerW: 293.9, peakEfficiency: 0.769, peakEfficiencyRpm: 13000, peakEfficiencyMph: 94.7, peakPowerW: 2105.1, peakThrustN: 38.23, source: "APC PER3_15x8E.dat" },
  { id: "apc-16x8e", name: "APC 16x8E", diameterIn: 16, pitchIn: 8, staticRpm: 6000, staticThrustN: 28.81, staticPowerW: 376.4, peakEfficiency: 0.757, peakEfficiencyRpm: 12000, peakEfficiencyMph: 84.5, peakPowerW: 2234.9, peakThrustN: 44.8, source: "APC PER3_16x8E.dat" },
  { id: "apc-17x10e", name: "APC 17x10E", diameterIn: 17, pitchIn: 10, staticRpm: 6000, staticThrustN: 39.85, staticPowerW: 586.6, peakEfficiency: 0.793, peakEfficiencyRpm: 11000, peakEfficiencyMph: 99.5, peakPowerW: 2602.5, peakThrustN: 46.39, source: "APC PER3_17x10E.dat" },
  { id: "apc-18x10e", name: "APC 18x10E", diameterIn: 18, pitchIn: 10, staticRpm: 6000, staticThrustN: 48.96, staticPowerW: 738.7, peakEfficiency: 0.786, peakEfficiencyRpm: 11000, peakEfficiencyMph: 100.3, peakPowerW: 3246.2, peakThrustN: 56.89, source: "APC PER3_18x10E.dat" },
  { id: "apc-20x10e", name: "APC 20x10E", diameterIn: 20, pitchIn: 10, staticRpm: 6000, staticThrustN: 69.51, staticPowerW: 1101.5, peakEfficiency: 0.767, peakEfficiencyRpm: 10000, peakEfficiencyMph: 88.4, peakPowerW: 3815.1, peakThrustN: 74.09, source: "APC PER3_20x10E.dat" },
  { id: "apc-22x12e", name: "APC 22x12E", diameterIn: 22, pitchIn: 12, staticRpm: 6000, staticThrustN: 107.74, staticPowerW: 1927, peakEfficiency: 0.792, peakEfficiencyRpm: 9000, peakEfficiencyMph: 98.4, peakPowerW: 4616.4, peakThrustN: 83.11, source: "APC PER3_22x12E.dat" },
  { id: "apc-24x12e", name: "APC 24x12E", diameterIn: 24, pitchIn: 12, staticRpm: 5200, staticThrustN: 136, staticPowerW: 2450, peakEfficiency: 0.78, peakEfficiencyRpm: 7600, peakEfficiencyMph: 86, peakPowerW: 6100, peakThrustN: 112, source: "scaled APC electric reference" },
  { id: "apc-26x13e", name: "APC 26x13E", diameterIn: 26, pitchIn: 13, staticRpm: 4700, staticThrustN: 172, staticPowerW: 3350, peakEfficiency: 0.77, peakEfficiencyRpm: 6900, peakEfficiencyMph: 85, peakPowerW: 7600, peakThrustN: 138, source: "scaled APC electric reference" },
  { id: "apc-28x14e", name: "APC 28x14E", diameterIn: 28, pitchIn: 14, staticRpm: 4200, staticThrustN: 218, staticPowerW: 4700, peakEfficiency: 0.76, peakEfficiencyRpm: 6200, peakEfficiencyMph: 82, peakPowerW: 9800, peakThrustN: 168, source: "scaled APC electric reference" },
  { id: "apc-30x15e", name: "APC 30x15E", diameterIn: 30, pitchIn: 15, staticRpm: 3800, staticThrustN: 270, staticPowerW: 6400, peakEfficiency: 0.75, peakEfficiencyRpm: 5600, peakEfficiencyMph: 79, peakPowerW: 12200, peakThrustN: 202, source: "scaled APC electric reference" },
  { id: "apc-32x16e", name: "APC 32x16E", diameterIn: 32, pitchIn: 16, staticRpm: 3400, staticThrustN: 330, staticPowerW: 8500, peakEfficiency: 0.74, peakEfficiencyRpm: 5100, peakEfficiencyMph: 77, peakPowerW: 15000, peakThrustN: 238, source: "scaled APC electric reference" },
  { id: "uav-40x18", name: "UAV 40x18 CF", diameterIn: 40, pitchIn: 18, staticRpm: 2600, staticThrustN: 520, staticPowerW: 12500, peakEfficiency: 0.76, peakEfficiencyRpm: 3600, peakEfficiencyMph: 64, peakPowerW: 22000, peakThrustN: 410, source: "scaled large UAV carbon prop reference" },
  { id: "uav-48x20", name: "UAV 48x20 CF", diameterIn: 48, pitchIn: 20, staticRpm: 2100, staticThrustN: 760, staticPowerW: 18500, peakEfficiency: 0.77, peakEfficiencyRpm: 3000, peakEfficiencyMph: 62, peakPowerW: 31000, peakThrustN: 590, source: "scaled large UAV carbon prop reference" },
  { id: "uav-52x22", name: "UAV 52x22 CF", diameterIn: 52, pitchIn: 22, staticRpm: 1900, staticThrustN: 910, staticPowerW: 23500, peakEfficiency: 0.77, peakEfficiencyRpm: 2700, peakEfficiencyMph: 62, peakPowerW: 38000, peakThrustN: 700, source: "scaled large UAV carbon prop reference" },
  { id: "uav-56x24", name: "UAV 56x24 CF", diameterIn: 56, pitchIn: 24, staticRpm: 1700, staticThrustN: 1080, staticPowerW: 30000, peakEfficiency: 0.78, peakEfficiencyRpm: 2400, peakEfficiencyMph: 61, peakPowerW: 47000, peakThrustN: 820, source: "scaled large UAV carbon prop reference" },
  { id: "uav-56x30", name: "UAV 56x30 CF", diameterIn: 56, pitchIn: 30, staticRpm: 1900, staticThrustN: 1120, staticPowerW: 31500, peakEfficiency: 0.79, peakEfficiencyRpm: 2700, peakEfficiencyMph: 74, peakPowerW: 52000, peakThrustN: 840, source: "Maytech 56x30 foldable prop reference, scaled performance" },
  { id: "fw-48x48", name: "Fixed-wing 48x48 CF", diameterIn: 48, pitchIn: 48, staticRpm: 3400, staticThrustN: 720, staticPowerW: 26000, peakEfficiency: 0.82, peakEfficiencyRpm: 3600, peakEfficiencyMph: 150, peakPowerW: 36000, peakThrustN: 560, source: "Sensenich/Ultra-Prop fixed-wing UAV high-speed range, estimated" },
  { id: "fw-52x56", name: "Fixed-wing 52x56 CF", diameterIn: 52, pitchIn: 56, staticRpm: 3200, staticThrustN: 820, staticPowerW: 28500, peakEfficiency: 0.82, peakEfficiencyRpm: 3400, peakEfficiencyMph: 165, peakPowerW: 42000, peakThrustN: 620, source: "Sensenich/Ultra-Prop fixed-wing UAV high-speed range, estimated" },
  { id: "fw-56x60", name: "Fixed-wing 56x60 CF", diameterIn: 56, pitchIn: 60, staticRpm: 3000, staticThrustN: 920, staticPowerW: 30000, peakEfficiency: 0.81, peakEfficiencyRpm: 3200, peakEfficiencyMph: 175, peakPowerW: 48000, peakThrustN: 700, source: "Sensenich/Ultra-Prop fixed-wing UAV high-speed range, estimated" },
];

export type BatteryInputs = {
  cells: number;
  cRating: number;
};

export const batteryCellOptions = [4, 6, 8, 10, 12] as const;
export const batteryCRatingOptions = [15, 20, 25, 30, 40, 60, 80, 100, 120, 150] as const;

export type BatterySample = {
  capacityAh: number;
  cRating: number;
  cells: number;
  id: string;
  massKg: number;
  name: string;
};

export const batterySamples: BatterySample[] = [
  { id: "pack-4s-5ah-35c", name: "4S 5.0Ah 35C", cells: 4, capacityAh: 5, cRating: 35, massKg: 0.48 },
  { id: "pack-4s-8ah-25c", name: "4S 8.0Ah 25C", cells: 4, capacityAh: 8, cRating: 25, massKg: 0.72 },
  { id: "pack-6s-5ah-35c", name: "6S 5.0Ah 35C", cells: 6, capacityAh: 5, cRating: 35, massKg: 0.73 },
  { id: "pack-6s-8ah-25c", name: "6S 8.0Ah 25C", cells: 6, capacityAh: 8, cRating: 25, massKg: 1.1 },
  { id: "pack-8s-5ah-35c", name: "8S 5.0Ah 35C", cells: 8, capacityAh: 5, cRating: 35, massKg: 0.96 },
  { id: "pack-8s-8ah-25c", name: "8S 8.0Ah 25C", cells: 8, capacityAh: 8, cRating: 25, massKg: 1.46 },
  { id: "pack-10s-5ah-35c", name: "10S 5.0Ah 35C", cells: 10, capacityAh: 5, cRating: 35, massKg: 1.2 },
  { id: "pack-10s-8ah-25c", name: "10S 8.0Ah 25C", cells: 10, capacityAh: 8, cRating: 25, massKg: 1.82 },
  { id: "pack-12s-5ah-35c", name: "12S 5.0Ah 35C", cells: 12, capacityAh: 5, cRating: 35, massKg: 1.44 },
  { id: "pack-12s-10ah-20c", name: "12S 10Ah 20C", cells: 12, capacityAh: 10, cRating: 20, massKg: 2.75 },
  { id: "pack-12s-16ah-20c", name: "12S 16Ah 20C", cells: 12, capacityAh: 16, cRating: 20, massKg: 4.2 },
  { id: "pack-12s-22ah-15c", name: "12S 22Ah 15C", cells: 12, capacityAh: 22, cRating: 15, massKg: 5.8 },
  { id: "pack-14s-16ah-20c", name: "14S 16Ah 20C", cells: 14, capacityAh: 16, cRating: 20, massKg: 4.9 },
  { id: "pack-14s-24ah-15c", name: "14S 24Ah 15C", cells: 14, capacityAh: 24, cRating: 15, massKg: 7.4 },
  { id: "pack-16s-20ah-20c", name: "16S 20Ah 20C", cells: 16, capacityAh: 20, cRating: 20, massKg: 7.1 },
  { id: "pack-16s-30ah-12c", name: "16S 30Ah 12C", cells: 16, capacityAh: 30, cRating: 12, massKg: 10.2 },
  { id: "pack-18s-40ah-12c", name: "18S 40Ah 12C", cells: 18, capacityAh: 40, cRating: 12, massKg: 13.8 },
  { id: "pack-20s-45ah-10c", name: "20S 45Ah 10C", cells: 20, capacityAh: 45, cRating: 10, massKg: 17.5 },
  { id: "pack-24s-50ah-10c", name: "24S 50Ah 10C", cells: 24, capacityAh: 50, cRating: 10, massKg: 23.4 },
  { id: "pack-24s-65ah-8c", name: "24S 65Ah 8C", cells: 24, capacityAh: 65, cRating: 8, massKg: 30.0 },
  { id: "pack-24s-80ah-6c", name: "24S 80Ah 6C", cells: 24, capacityAh: 80, cRating: 6, massKg: 37.5 },
];

export type RotorDefinition = {
  bladeCount: number;
  diameterM: number;
  count: number;
};

export type ComboSearchTarget = {
  minEnduranceMin: number;
  targetThrustToWeight: number;
};

export function propellerMassEstimate(propeller: PropellerSample) {
  return Math.max(0.018, 0.00019 * Math.pow(propeller.diameterIn, 2.15));
}

export function findBestPropulsionCombo({
  aircraftMassKg,
  batteryEnergyDensityWhKg,
  batteryMassKg,
  bladeCount,
  rotorDefinition,
  target,
}: {
  aircraftMassKg: number;
  batteryEnergyDensityWhKg: number;
  batteryMassKg: number;
  bladeCount: number;
  rotorDefinition: RotorDefinition;
  target: ComboSearchTarget;
}) {
  const rotorCount = Math.max(1, rotorDefinition.count);
  const candidates = motorSamples.flatMap((motor) =>
    propellerSamples.flatMap((propeller) =>
      batterySamples.map((batteryPack) => {
        const battery = { cells: batteryPack.cells, cRating: batteryPack.cRating };
        const result = computePropulsionSizing(
          aircraftMassKg,
          rotorCount,
          bladeCount,
          rotorDefinition.diameterM,
          { rotorPitchIn: propeller.pitchIn },
          battery,
          batteryPack.massKg,
          batteryEnergyDensityWhKg,
          propeller,
          motor,
          batteryPack,
        );
        const selectedPropellerMassKg = propellerMassEstimate(propeller) * rotorCount;
        const propulsionMassKg = batteryPack.massKg + (motor.massG / 1000) * rotorCount + selectedPropellerMassKg;
        const fitsSizingDiameter = rotorDefinition.diameterM <= 0 || propeller.diameterIn * 0.0254 <= rotorDefinition.diameterM * 1.08;
        const passes =
          fitsSizingDiameter &&
          result.availableThrustToWeight >= target.targetThrustToWeight &&
          result.enduranceMin >= target.minEnduranceMin &&
          result.currentPerMotorA <= motor.maxCurrentA &&
          result.powerPerMotorW <= motor.continuousPowerW &&
          result.takeoffCurrentA <= result.batteryMaxCurrentA;
        const score =
          propulsionMassKg * 1000 +
          Math.max(0, result.availableThrustToWeight - target.targetThrustToWeight) * 80 +
          Math.max(0, result.enduranceMin - target.minEnduranceMin) * 2;
        return { battery, batteryPack, motor, passes, propeller, propellerMassKg: selectedPropellerMassKg, result, score };
      }),
    ),
  );
  const passing = candidates.filter((candidate) => candidate.passes).sort((a, b) => a.score - b.score);
  return passing[0] ?? candidates.sort((a, b) => b.result.availableThrustToWeight - a.result.availableThrustToWeight)[0];
}

export function computePropulsionSizing(
  aircraftMassKg: number,
  motorCount: number,
  bladeCount: number,
  sizingRotorDiameterM: number,
  inputs: PropulsionInputs,
  battery: BatteryInputs,
  batteryMassKg: number,
  batteryEnergyDensityWhKg: number,
  propeller?: PropellerSample,
  motor?: MotorSample,
  batteryPack?: BatterySample,
) {
  const safeMassKg = Math.max(aircraftMassKg, 0);
  const safeMotorCount = Math.max(1, Math.round(motorCount));
  const safeBladeCount = Math.max(2, Math.round(bladeCount));
  const safeVoltage = Math.max(battery.cells * 3.7, 1);
  const safeBatteryMassKg = Math.max(batteryPack?.massKg ?? batteryMassKg, 0);
  const safeBatteryEnergyDensityWhKg = Math.max(batteryEnergyDensityWhKg, 0);
  const safeCapacityAh = batteryPack ? Math.max(batteryPack.capacityAh, 0) : (safeBatteryMassKg * safeBatteryEnergyDensityWhKg) / safeVoltage;
  const safeCRating = Math.max(batteryPack?.cRating ?? battery.cRating, 0);
  const rotorPitchM = Math.max(propeller?.pitchIn ?? inputs.rotorPitchIn, 0) * 0.0254;
  const propellerDiameterM = propeller ? propeller.diameterIn * 0.0254 : 0;
  const noLoadRpm = motor ? motor.kvRpmV * safeVoltage : 5200;
  const motorVoltageLoadedRpm = motor ? noLoadRpm * 0.82 : noLoadRpm;
  const motorPowerLimitedRpm =
    motor && propeller && propeller.staticPowerW > 0
      ? propeller.staticRpm * Math.pow(Math.max(motor.continuousPowerW, 1) / propeller.staticPowerW, 1 / 3)
      : motorVoltageLoadedRpm;
  const safeRpm = Math.max(Math.min(motorVoltageLoadedRpm, motorPowerLimitedRpm), 0);
  const rpmRatio = propeller && propeller.staticRpm > 0 ? safeRpm / propeller.staticRpm : 0;
  const availableStaticThrustPerMotorN = propeller ? propeller.staticThrustN * Math.pow(rpmRatio, 2) : 0;
  const fallbackThrustPerMotorN = safeMassKg * 9.80665 * 1.6 / safeMotorCount;
  const thrustPerMotorN = propeller ? availableStaticThrustPerMotorN : fallbackThrustPerMotorN;
  const totalThrustN = thrustPerMotorN * safeMotorCount;
  const availableThrustToWeight = totalThrustN / Math.max(safeMassKg * 9.80665, 0.001);
  const requiredHoverThrustPerMotorN = safeMassKg * 9.80665 / safeMotorCount;
  const referenceRotorDiameterM = propellerDiameterM || sizingRotorDiameterM;
  const sizingRotorAreaM2 = referenceRotorDiameterM > 0 ? Math.PI * Math.pow(referenceRotorDiameterM / 2, 2) : 0;
  const fallbackDiskLoadingNpm2 = 85 * Math.sqrt(safeBladeCount / 2);
  const diskAreaPerRotorM2 = sizingRotorAreaM2 || thrustPerMotorN / fallbackDiskLoadingNpm2;
  const rotorDiameterM = referenceRotorDiameterM > 0 ? referenceRotorDiameterM : 2 * Math.sqrt(diskAreaPerRotorM2 / Math.PI);
  const safeDiskLoading = thrustPerMotorN / Math.max(diskAreaPerRotorM2, 0.001);
  const diskLoadingPenalty = Math.max(0, (safeDiskLoading - 80) / 1000);
  const pitchSpeedMS = (rotorPitchM * safeRpm) / 60;
  const pitchSpeedPenalty = pitchSpeedMS > 0 ? Math.max(0, (pitchSpeedMS - 24) / 400) : 0.08;
  const estimatedEfficiency = 0.74 - (safeBladeCount - 2) * 0.025 - diskLoadingPenalty - pitchSpeedPenalty;
  const safeEfficiency = propeller ? Math.min(0.86, Math.max(0.35, propeller.peakEfficiency)) : Math.min(0.86, Math.max(0.48, estimatedEfficiency));
  const inducedVelocityMS = Math.sqrt(thrustPerMotorN / (2 * 1.225 * Math.max(diskAreaPerRotorM2, 0.001)));
  const availableStaticPowerPerMotorW = propeller ? propeller.staticPowerW * Math.pow(rpmRatio, 3) : 0;
  const powerPerMotorW = propeller ? availableStaticPowerPerMotorW : (thrustPerMotorN * inducedVelocityMS) / safeEfficiency;
  const totalPowerW = powerPerMotorW * safeMotorCount;
  const currentPerMotorA = powerPerMotorW / safeVoltage;
  const takeoffCurrentA = totalPowerW / safeVoltage;
  const cruisePowerW = totalPowerW * 0.45;
  const cruiseCurrentA = cruisePowerW / safeVoltage;
  const batteryMaxCurrentA = safeCapacityAh * safeCRating;
  const takeoffCapacityAh = safeCapacityAh * 0.2;
  const cruiseCapacityAh = safeCapacityAh * 0.8;
  const takeoffMin = takeoffCurrentA > 0 ? (takeoffCapacityAh / takeoffCurrentA) * 60 : 0;
  const cruiseMin = cruiseCurrentA > 0 ? (cruiseCapacityAh / cruiseCurrentA) * 60 : 0;
  const usefulPitchSpeedMS = pitchSpeedMS * safeEfficiency;
  const staticThrustPerMotorN = propeller
    ? availableStaticThrustPerMotorN
    : Math.cbrt(Math.max(0, 2 * 1.225 * diskAreaPerRotorM2 * Math.pow(powerPerMotorW * safeEfficiency, 2)));
  const staticThrustTotalN = staticThrustPerMotorN * safeMotorCount;
  return {
    currentPerMotorA,
    availableThrustToWeight,
    batteryMaxCurrentA,
    batteryCapacityAh: safeCapacityAh,
    batteryMassKg: safeBatteryMassKg,
    cruiseSpeedHighMS: usefulPitchSpeedMS * 0.85,
    cruiseSpeedLowMS: usefulPitchSpeedMS * 0.65,
    cruiseCurrentA,
    diskAreaPerRotorM2,
    effectiveDiskLoadingNpm2: safeDiskLoading,
    effectivePropEfficiency: safeEfficiency,
    motorLoadedRpm: safeRpm,
    motorNoLoadRpm: noLoadRpm,
    motorPowerLimitedRpm,
    propellerDataSource: propeller?.source,
    propellerStaticPowerPerMotorW: availableStaticPowerPerMotorW,
    propellerStaticThrustPerMotorN: availableStaticThrustPerMotorN,
    powerPerMotorW,
    pitchSpeedKmh: pitchSpeedMS * 3.6,
    pitchSpeedMS,
    recommendedEscA: currentPerMotorA * 1.3,
    recommendedMotorW: powerPerMotorW * 1.25,
    rotorDiameterM,
    rotorPitchM,
    staticThrustPerMotorKgf: staticThrustPerMotorN / 9.80665,
    staticThrustPerMotorN,
    staticThrustTotalKgf: staticThrustTotalN / 9.80665,
    staticThrustTotalN,
    takeoffCurrentA,
    enduranceMin: takeoffMin + cruiseMin,
    requiredHoverThrustPerMotorN,
    thrustPerMotorKgf: thrustPerMotorN / 9.80665,
    thrustPerMotorN,
    totalPowerW,
    totalThrustN,
  };
}

export function batteryMassFromSizing(sizing: Pick<SizingProject, "shapes">) {
  return sizing.shapes
    .filter((shape) => shape.role === "part" && shape.partType === "battery")
    .reduce((total, shape) => total + batteryMassEstimate(shape), 0);
}

export function rotorDefinitionFromSizing(sizing: Pick<SizingProject, "mission" | "shapes">): RotorDefinition {
  const rotorShapes = sizing.shapes.filter((shape) => shape.role === "part" && shape.partType === "rotor");
  if (!rotorShapes.length) {
    return { bladeCount: sizing.mission?.rotorBladeCount ?? 2, count: fixedRotorCount, diameterM: 0 };
  }
  const primary = rotorShapes[0];
  return {
    bladeCount: Math.max(1, Math.round(sizing.mission?.rotorBladeCount ?? primary.rotorBladeCount ?? 2)),
    count: rotorShapes.reduce((total, shape) => total + rotorInstanceCount(shape, sizing.shapes), 0),
    diameterM: Math.max(...rotorShapes.map((shape) => rotorDiameterEstimate(shape, sizing.shapes)), 0),
  };
}

function mirroredRotorInstanceCount(shape: SizingProject["shapes"][number]) {
  return shape.points.some((point) => Math.abs(point.xM) <= 0.005) ? 1 : 2;
}
