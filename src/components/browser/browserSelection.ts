import type { CadObject, SelectedGeometry } from "../../types";
import { planeSelectionPolygon } from "../canvas/selectionMath";
import { tupleToVector } from "../canvas/vectorUtils";
import { browserGroupIdForObject } from "./units";

export { browserGroupIdForObject, isObjectHidden } from "./units";

export function selectionFromBrowserItem(id: string, objects: CadObject[]): SelectedGeometry | null {
  if (id === "origin") {
    return {
      type: "point",
      objectId: "origin",
      objectName: "World origin",
      position: [0, 0, 0],
      description: "World origin",
    };
  }
  if (id === "origin-plane-xy" || id === "origin-plane-xz" || id === "origin-plane-yz") {
    return originPlaneSelection(id);
  }

  const object = objects.find((entry) => entry.id === id);
  if (!object) return null;
  if (object.kind === "reference") {
    return {
      type: object.referenceKind,
      objectId: object.id,
      objectName: object.name,
      position: object.origin,
      normal: object.normal,
      description: `${object.referenceKind} reference ${object.name}`,
    };
  }
  return {
    type: "body",
    objectId: object.id,
    objectName: object.name,
    position: [0, 0, 0],
    description: `Body ${object.name}`,
  };
}

function originPlaneSelection(id: string): SelectedGeometry {
  const plane = id.replace("origin-plane-", "").toUpperCase();
  const normal: [number, number, number] =
    plane === "XY" ? [0, 0, 1] : plane === "XZ" ? [0, 1, 0] : [1, 0, 0];
  return {
    type: "plane",
    objectId: id,
    objectName: `${plane} origin plane`,
    position: [0, 0, 0],
    normal,
    polygon: planeSelectionPolygon(tupleToVector([0, 0, 0]), tupleToVector(normal), 0.42),
    description: `${plane} origin plane`,
  };
}
