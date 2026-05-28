import { batterySamples, motorSamples, propellerSamples } from "../propulsionEngine";
import type { PropulsionTabState } from "./types";

export const examplePrompt = "create a 40mm diameter round solid, 120mm long, on the XZ plane";
export const defaultModel = "gpt-5";
export const projectStorageKey = "cadex.project";
export const appModeStorageKey = "cadex.appMode";
export const unitOptions = ["m", "cm", "mm", "in", "ft"] as const;
export type DisplayUnit = (typeof unitOptions)[number];
export const metersPerSecondPerKnot = 0.514444;
export const fixedAircraftMotorCount = 2;
export const fixedAircraftTailplaneCount = 2;

export const defaultPropulsionTabState: PropulsionTabState = {
  selectedBatteryId: batterySamples[5]?.id ?? batterySamples[0].id,
  selectedMotorId: motorSamples[5]?.id ?? motorSamples[0].id,
  selectedPropellerId: propellerSamples[8]?.id ?? propellerSamples[0].id,
  targetEnduranceMin: 20,
  targetThrustToWeight: 1.3,
};
