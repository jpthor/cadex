import * as THREE from "three";

export function vectorToTuple(vector: THREE.Vector3): [number, number, number] {
  return [roundCoord(vector.x), roundCoord(vector.y), roundCoord(vector.z)];
}

export function tupleToVector(tuple: [number, number, number]) {
  return new THREE.Vector3(tuple[0], tuple[1], tuple[2]);
}

export function roundCoord(value: number) {
  return Math.abs(value) < 1e-9 ? 0 : Number(value.toFixed(6));
}
