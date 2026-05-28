import type { SelectedGeometry } from "../../types";
import type { CursorPlane } from "../../app/types";
import { tupleToVector } from "./vectorUtils";

export function updateActiveCursorPlane(
  activeCursorPlaneRef: { current: CursorPlane },
  selection: SelectedGeometry,
) {
  if (selection.type !== "plane" && selection.type !== "face" && selection.type !== "surface") {
    return;
  }
  if (!selection.normal) return;
  const normal = tupleToVector(selection.normal).normalize();
  if (normal.lengthSq() === 0) return;
  activeCursorPlaneRef.current = {
    label: selection.objectName ?? selection.description,
    normal,
    point: tupleToVector(selection.position),
  };
}
