import type { CanvasView } from "./types";
import type { LiftingSurfaceKind, PartType, SizeShapeRole } from "../sizing";

export type TurbineEngineOption = {
  id: string;
  maker: string;
  model: string;
  thrustN: number;
  engineWeightKg: number;
  fuelKgPerMin: number;
  performanceTable: TurbinePerformancePoint[];
  source: string;
};

export type TurbinePerformancePoint = {
  commandPct: number;
  thrustN: number;
  fuelKgPerMin: number;
};

export const defaultTurbineCount = 2;

const turbineTable = (
  idleThrustN: number,
  idleFuelKgPerMin: number,
  maxThrustN: number,
  maxFuelKgPerMin: number,
): TurbinePerformancePoint[] => [
  { commandPct: 0, thrustN: idleThrustN, fuelKgPerMin: idleFuelKgPerMin },
  { commandPct: 100, thrustN: maxThrustN, fuelKgPerMin: maxFuelKgPerMin },
];

const swiwinTable = (maxThrustN: number, maxFuelKgPerMin: number): TurbinePerformancePoint[] =>
  turbineTable(maxThrustN * 0.05, maxFuelKgPerMin * 0.22, maxThrustN, maxFuelKgPerMin);

export const turbineEngineOptions: TurbineEngineOption[] = [
  { id: "swiwin-sw60b", maker: "Swiwin", model: "SW60B", thrustN: 60, engineWeightKg: 0.783, fuelKgPerMin: 0.2, performanceTable: swiwinTable(60, 0.2), source: "Swiwin SW60B sheet, max flow; idle estimated from class ratio" },
  { id: "swiwin-sw80b", maker: "Swiwin", model: "SW80B", thrustN: 80, engineWeightKg: 0.788, fuelKgPerMin: 0.27, performanceTable: swiwinTable(80, 0.27), source: "Swiwin SW brushless manual, max flow; idle estimated from class ratio" },
  { id: "swiwin-sw120b", maker: "Swiwin", model: "SW120B", thrustN: 120, engineWeightKg: 1.255, fuelKgPerMin: 0.31, performanceTable: swiwinTable(120, 0.31), source: "Swiwin SW brushless manual, max flow; idle estimated from class ratio" },
  { id: "swiwin-sw140b", maker: "Swiwin", model: "SW140B", thrustN: 140, engineWeightKg: 1.255, fuelKgPerMin: 0.325, performanceTable: swiwinTable(140, 0.325), source: "Swiwin SW brushless manual, max flow; idle estimated from class ratio" },
  { id: "swiwin-sw170b", maker: "Swiwin", model: "SW170B", thrustN: 170, engineWeightKg: 1.457, fuelKgPerMin: 0.351, performanceTable: swiwinTable(170, 0.351), source: "Swiwin SW brushless manual, max flow; idle estimated from class ratio" },
  { id: "swiwin-sw190b", maker: "Swiwin", model: "SW190B", thrustN: 190, engineWeightKg: 1.563, fuelKgPerMin: 0.38, performanceTable: swiwinTable(190, 0.38), source: "Swiwin SW brushless manual, max flow; idle estimated from class ratio" },
  { id: "swiwin-sw220b", maker: "Swiwin", model: "SW220B", thrustN: 220, engineWeightKg: 1.7, fuelKgPerMin: 0.66, performanceTable: swiwinTable(220, 0.66), source: "Swiwin SW turbine spec, max flow; idle estimated from class ratio" },
  { id: "swiwin-sw300b", maker: "Swiwin", model: "SW300B", thrustN: 300, engineWeightKg: 2.5, fuelKgPerMin: 0.82, performanceTable: swiwinTable(300, 0.82), source: "Swiwin SW300B sheet, max flow; idle estimated from class ratio" },
  { id: "swiwin-sw400b", maker: "Swiwin", model: "SW400B", thrustN: 400, engineWeightKg: 3, fuelKgPerMin: 1, performanceTable: swiwinTable(400, 1), source: "Swiwin SW turbine spec, max flow; idle estimated from class ratio" },
  { id: "jetcat-p20-sx", maker: "JetCat", model: "P20-SX", thrustN: 24, engineWeightKg: 0.355, fuelKgPerMin: 0.075, performanceTable: turbineTable(0.3, 0.012, 24, 0.075), source: "JetCat P20-SX published idle/max table" },
  { id: "jetcat-p60-se", maker: "JetCat", model: "P60-SE", thrustN: 63, engineWeightKg: 0.845, fuelKgPerMin: 0.192, performanceTable: turbineTable(1, 0.056, 63, 0.192), source: "JetCat data sheet idle/max; straight-line interpolation" },
  { id: "jetcat-p80-se", maker: "JetCat", model: "P80-SE", thrustN: 80, engineWeightKg: 1.43, fuelKgPerMin: 0.217, performanceTable: turbineTable(3, 0.075, 80, 0.217), source: "JetCat 2019 published idle/max table" },
  { id: "jetcat-p90-rxi", maker: "JetCat", model: "P90-RXi", thrustN: 105, engineWeightKg: 1.435, fuelKgPerMin: 0.296, performanceTable: turbineTable(3, 0.076, 105, 0.296), source: "JetCat data sheet idle/max; straight-line interpolation" },
  { id: "jetcat-p100-rx", maker: "JetCat", model: "P100-RX", thrustN: 100, engineWeightKg: 1.08, fuelKgPerMin: 0.312, performanceTable: turbineTable(2, 0.064, 100, 0.312), source: "JetCat P100-RX published idle/max; straight-line interpolation" },
  { id: "jetcat-p130-rx", maker: "JetCat", model: "P130-RX", thrustN: 130, engineWeightKg: 1.225, fuelKgPerMin: 0.4, performanceTable: turbineTable(5, 0.08, 130, 0.4), source: "JetCat P130-RX published idle/max table" },
  { id: "jetcat-p140-rxi", maker: "JetCat", model: "P140-RXi", thrustN: 142, engineWeightKg: 1.59, fuelKgPerMin: 0.408, performanceTable: turbineTable(6, 0.092, 142, 0.408), source: "JetCat data sheet idle/max; straight-line interpolation" },
  { id: "jetcat-p160-rxi-b", maker: "JetCat", model: "P160-RXi-B", thrustN: 160, engineWeightKg: 1.67, fuelKgPerMin: 0.468, performanceTable: turbineTable(7, 0.096, 160, 0.468), source: "JetCat P160-RXi-B published idle/max table" },
  { id: "jetcat-p180-nx", maker: "JetCat", model: "P180-NX", thrustN: 175, engineWeightKg: 1.71, fuelKgPerMin: 0.468, performanceTable: turbineTable(7, 0.096, 175, 0.468), source: "JetCat catalogue published idle/max table" },
  { id: "jetcat-p200-rx", maker: "JetCat", model: "P200-RX", thrustN: 230, engineWeightKg: 2.37, fuelKgPerMin: 0.584, performanceTable: turbineTable(9, 0.103, 230, 0.584), source: "JetCat data sheet idle/max; straight-line interpolation" },
  { id: "jetcat-p220-rxi", maker: "JetCat", model: "P220-RXi", thrustN: 220, engineWeightKg: 1.85, fuelKgPerMin: 0.58, performanceTable: turbineTable(9, 0.104, 220, 0.58), source: "JetCat catalogue published idle/max table" },
  { id: "jetcat-p250-pro-s", maker: "JetCat", model: "P250-PRO-S", thrustN: 250, engineWeightKg: 2.155, fuelKgPerMin: 0.656, performanceTable: turbineTable(11.8, 0.11, 250, 0.656), source: "JetCat P250-PRO-S idle/max; straight-line interpolation" },
  { id: "jetcat-p300-rx", maker: "JetCat", model: "P300-RX", thrustN: 300, engineWeightKg: 2.63, fuelKgPerMin: 0.784, performanceTable: turbineTable(14, 0.143, 300, 0.784), source: "JetCat data sheet idle/max; straight-line interpolation" },
  { id: "jetcat-p300-pro", maker: "JetCat", model: "P300-PRO", thrustN: 300, engineWeightKg: 2.73, fuelKgPerMin: 0.784, performanceTable: turbineTable(14, 0.143, 300, 0.784), source: "JetCat PRO published idle/max table" },
  { id: "jetcat-p400-rx", maker: "JetCat", model: "P400-RX", thrustN: 395, engineWeightKg: 3.55, fuelKgPerMin: 1.04, performanceTable: turbineTable(13, 0.16, 395, 1.04), source: "JetCat data sheet idle/max; straight-line interpolation" },
  { id: "jetcat-p400-pro", maker: "JetCat", model: "P400-PRO", thrustN: 397, engineWeightKg: 3.65, fuelKgPerMin: 1.04, performanceTable: turbineTable(14, 0.16, 397, 1.04), source: "JetCat PRO published idle/max table" },
  { id: "jetcat-p550-pro", maker: "JetCat", model: "P550-PRO", thrustN: 550, engineWeightKg: 4.9, fuelKgPerMin: 1.32, performanceTable: turbineTable(28, 0.24, 550, 1.32), source: "JetCat PRO published idle/max table" },
].sort((a, b) => a.thrustN - b.thrustN);

export const baseCanvasView: CanvasView = { width: 900, height: 720, originX: 450, originY: 72, scale: 190 };
export const scaleUnits = ["mm", "cm", "m"] as const;
export const referenceRoles: SizeShapeRole[] = ["referenceLine", "mirrorPlane"];
export const airfoilOptions = ["NACA 0012", "NACA 0010", "NACA 2412", "NACA 4412", "Clark Y", "MH 32", "Selig S1223"];
export function defaultAirfoilForLiftingSurface(kind: LiftingSurfaceKind) {
  if (kind === "wing") return "NACA 2412";
  if (kind === "fin") return "NACA 0010";
  return "NACA 0012";
}
export const mirrorAxisTouchToleranceM = 0.005;
export const drawablePartTypes: PartType[] = ["payload", "battery", "motor", "rotor"];
export const sideCollapseProgress = 0.58;
