import type { SizeDimensionTarget } from "../sizing";

export const scaleUnits = ["cm", "m", "mm"] as const;
export type ScaleUnit = (typeof scaleUnits)[number];
export type AirfoilStation = "root" | "tip";
export type CanvasViewMode = "top" | "front" | "side";
export type JoinPointSelection = { shapeId: string; pointIndex: number };
export type DimensionDraft = { firstTarget: SizeDimensionTarget } | null;
export type PendingDimension = { targetA: SizeDimensionTarget; targetB: SizeDimensionTarget } | null;
export type CanvasView = { width: number; height: number; originX: number; originY: number; scale: number };
export type SideProjectionFrame = { baselineY: number; longitudinalSign: 1 | -1 };
