import type { CanvasView } from "./types";
import type { PartType, SizeShapeRole } from "../sizing";

export type TurbineEngineOption = {
  id: string;
  maker: string;
  model: string;
  thrustN: number;
  engineWeightKg: number;
  fuelKgPerMin: number;
  source: string;
};

export const defaultTurbineCount = 2;

export const turbineEngineOptions: TurbineEngineOption[] = [
  { id: "swiwin-sw60b", maker: "Swiwin", model: "SW60B", thrustN: 60, engineWeightKg: 0.783, fuelKgPerMin: 0.2, source: "SW60B datasheet max flow" },
  { id: "swiwin-sw80b", maker: "Swiwin", model: "SW80B", thrustN: 80, engineWeightKg: 0.788, fuelKgPerMin: 0.27, source: "SW brushless manual" },
  { id: "swiwin-sw120b", maker: "Swiwin", model: "SW120B", thrustN: 120, engineWeightKg: 1.255, fuelKgPerMin: 0.31, source: "SW brushless manual" },
  { id: "swiwin-sw140b", maker: "Swiwin", model: "SW140B", thrustN: 140, engineWeightKg: 1.255, fuelKgPerMin: 0.325, source: "SW brushless manual" },
  { id: "swiwin-sw170b", maker: "Swiwin", model: "SW170B", thrustN: 170, engineWeightKg: 1.457, fuelKgPerMin: 0.351, source: "SW brushless manual" },
  { id: "swiwin-sw190b", maker: "Swiwin", model: "SW190B", thrustN: 190, engineWeightKg: 1.563, fuelKgPerMin: 0.38, source: "SW brushless manual" },
  { id: "swiwin-sw220b", maker: "Swiwin", model: "SW220B", thrustN: 220, engineWeightKg: 1.7, fuelKgPerMin: 0.66, source: "SW220B datasheet" },
  { id: "swiwin-sw300b", maker: "Swiwin", model: "SW300B", thrustN: 300, engineWeightKg: 2.5, fuelKgPerMin: 0.784, source: "Swiwin spec sheet; fuel scaled from JetCat P300 class" },
  { id: "swiwin-sw400b", maker: "Swiwin", model: "SW400B", thrustN: 400, engineWeightKg: 3, fuelKgPerMin: 1.04, source: "Swiwin spec sheet; fuel scaled from JetCat P400 class" },
  { id: "jetcat-p20-sx", maker: "JetCat", model: "P20-SX", thrustN: 24, engineWeightKg: 0.355, fuelKgPerMin: 0.075, source: "JetCat 2019 table" },
  { id: "jetcat-p60-se", maker: "JetCat", model: "P60-SE", thrustN: 60, engineWeightKg: 0.845, fuelKgPerMin: 0.192, source: "JetCat 2019 table" },
  { id: "jetcat-p80-se", maker: "JetCat", model: "P80-SE", thrustN: 80, engineWeightKg: 1.43, fuelKgPerMin: 0.217, source: "JetCat 2019 table" },
  { id: "jetcat-p100-rx", maker: "JetCat", model: "P100-RX", thrustN: 100, engineWeightKg: 1.08, fuelKgPerMin: 0.312, source: "JetCat 2019 table" },
  { id: "jetcat-p130-rx", maker: "JetCat", model: "P130-RX", thrustN: 130, engineWeightKg: 1.225, fuelKgPerMin: 0.4, source: "JetCat 2019 table" },
  { id: "jetcat-p160-rxi-b", maker: "JetCat", model: "P160-RXi-B", thrustN: 160, engineWeightKg: 1.67, fuelKgPerMin: 0.468, source: "JetCat 2019 table" },
  { id: "jetcat-p180-nx", maker: "JetCat", model: "P180-NX", thrustN: 175, engineWeightKg: 1.71, fuelKgPerMin: 0.468, source: "JetCat catalogue" },
  { id: "jetcat-p200-rx", maker: "JetCat", model: "P200-RX", thrustN: 210, engineWeightKg: 2.61, fuelKgPerMin: 0.577, source: "JetCat 2019 table" },
  { id: "jetcat-p220-rxi", maker: "JetCat", model: "P220-RXi", thrustN: 220, engineWeightKg: 1.85, fuelKgPerMin: 0.58, source: "JetCat catalogue" },
  { id: "jetcat-p300-pro", maker: "JetCat", model: "P300-PRO", thrustN: 300, engineWeightKg: 2.73, fuelKgPerMin: 0.784, source: "JetCat catalogue" },
  { id: "jetcat-p400-pro", maker: "JetCat", model: "P400-PRO", thrustN: 397, engineWeightKg: 3.65, fuelKgPerMin: 1.04, source: "JetCat catalogue" },
  { id: "jetcat-p550-pro", maker: "JetCat", model: "P550-PRO", thrustN: 550, engineWeightKg: 4.9, fuelKgPerMin: 1.32, source: "JetCat catalogue" },
].sort((a, b) => a.thrustN - b.thrustN);

export const baseCanvasView: CanvasView = { width: 900, height: 720, originX: 450, originY: 72, scale: 190 };
export const scaleUnits = ["cm", "m", "mm"] as const;
export const referenceRoles: SizeShapeRole[] = ["referenceLine", "mirrorPlane"];
export const airfoilOptions = ["NACA 0012", "NACA 2412", "NACA 4412", "Clark Y", "MH 32", "Selig S1223"];
export const mirrorAxisTouchToleranceM = 0.005;
export const drawablePartTypes: PartType[] = ["payload", "battery", "motor", "rotor"];
export const sideCollapseProgress = 0.58;
