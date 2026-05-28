import type { CadObject } from "../../types";
import { unitOptions } from "../../app/constants";
import type { DisplayUnit } from "../../app/constants";
import type { BrowserGroupId } from "../../app/types";

export type { DisplayUnit };

export function formatVector(vector: [number, number, number], unit: DisplayUnit, precision: number) {
  return vector.map((value) => formatLength(value, unit, precision)).join(", ");
}

export function formatLength(valueM: number, unit: DisplayUnit, precision: number) {
  return `${convertLength(valueM, unit).toFixed(precision)} ${unit}`;
}

export function convertLength(valueM: number, unit: DisplayUnit) {
  if (unit === "cm") return valueM * 100;
  if (unit === "mm") return valueM * 1000;
  if (unit === "in") return valueM * 39.3700787;
  if (unit === "ft") return valueM * 3.2808399;
  return valueM;
}

export function toDisplayUnit(value: string): DisplayUnit {
  return unitOptions.find((unit) => unit === value) ?? "m";
}

export function browserGroupIdForObject(object: CadObject): BrowserGroupId {
  if (object.kind === "reference") {
    if (object.referenceKind === "surface" || object.referenceKind === "face") return "section:surfaces";
    if (object.referenceKind === "line" || object.referenceKind === "point") return "section:sketches";
    return "section:planes";
  }
  return "section:bodies";
}

export function isObjectHidden(object: CadObject, hiddenBrowserItemIds: Set<string>) {
  return (
    hiddenBrowserItemIds.has("project") ||
    hiddenBrowserItemIds.has(object.id) ||
    hiddenBrowserItemIds.has(browserGroupIdForObject(object))
  );
}
