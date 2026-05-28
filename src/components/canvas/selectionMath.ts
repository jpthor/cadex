import * as THREE from "three";
import { OrbitControls } from "three/examples/jsm/controls/OrbitControls.js";
import type { CadObject, SelectedGeometry } from "../../types";
import type { BrowserGroupId, CursorPlane } from "../../app/types";
import { tupleToVector, vectorToTuple } from "./vectorUtils";


export function selectionFromIntersection(
  hit: THREE.Intersection,
  camera: THREE.PerspectiveCamera,
  canvas: HTMLCanvasElement,
  clientX: number,
  clientY: number,
): SelectedGeometry {
  const meta = findCadObjectMeta(hit.object);
  const worldPoint = hit.point.clone();
  const normal = hit.face
    ? hit.face.normal.clone().transformDirection(hit.object.matrixWorld).normalize()
    : new THREE.Vector3(0, 1, 0);

  if (meta?.kind === "reference" && meta.referenceKind) {
    return {
      type: meta.referenceKind,
      objectId: meta.id,
      objectName: meta.name,
      position: vectorToTuple(worldPoint),
      normal: vectorToTuple(normal),
      polygon: meta.referenceKind === "plane" || meta.referenceKind === "face" || meta.referenceKind === "surface" ? planeSelectionPolygon(worldPoint, normal, 0.18) : undefined,
      description: `${meta.referenceKind} reference ${meta.name}`,
    };
  }

  const triangle = hit.face ? triangleFromHit(hit) : undefined;
  if (meta?.kind === "wing" || meta?.kind === "mesh" || meta?.kind === "solid") {
    return {
      type: hit.face ? "face" : "body",
      objectId: meta.id,
      objectName: meta.name,
      position: vectorToTuple(worldPoint),
      normal: vectorToTuple(normal),
      polygon: triangle?.vertices.map(vectorToTuple),
      description: `${hit.face ? "Face" : "Body"} on ${meta.name ?? "geometry"}`,
    };
  }

  if (triangle) {
    const pointer = new THREE.Vector2(clientX, clientY);
    const projected = triangle.vertices.map((vertex) => projectToScreen(vertex, camera, canvas));
    const vertexIndex = projected.findIndex((vertex) => vertex.distanceTo(pointer) < 10);
    if (vertexIndex >= 0) {
      const vertex = triangle.vertices[vertexIndex];
      return {
        type: "point",
        objectId: meta?.id,
        objectName: meta?.name,
        position: vectorToTuple(vertex),
        normal: vectorToTuple(normal),
        description: `Point on ${meta?.name ?? "geometry"}`,
      };
    }

    for (let index = 0; index < projected.length; index += 1) {
      const nextIndex = (index + 1) % projected.length;
      if (distanceToSegment(pointer, projected[index], projected[nextIndex]) < 7) {
        return {
          type: "line",
          objectId: meta?.id,
          objectName: meta?.name,
          position: vectorToTuple(worldPoint),
          start: vectorToTuple(triangle.vertices[index]),
          end: vectorToTuple(triangle.vertices[nextIndex]),
          normal: vectorToTuple(normal),
          description: `Edge on ${meta?.name ?? "geometry"}`,
        };
      }
    }
  }

  return {
    type: hit.face ? "face" : "body",
    objectId: meta?.id,
    objectName: meta?.name,
    position: vectorToTuple(worldPoint),
    normal: vectorToTuple(normal),
    polygon: triangle?.vertices.map(vectorToTuple),
    description: `${hit.face ? "Face" : "Body"} on ${meta?.name ?? "geometry"}`,
  };
}

export function pickBestIntersection(hits: THREE.Intersection[]) {
  return [...hits].sort((a, b) => pickPriority(a) - pickPriority(b) || a.distance - b.distance)[0];
}

export function pickPriority(hit: THREE.Intersection) {
  const meta = findCadObjectMeta(hit.object);
  if (meta?.referenceKind === "point") return 0;
  if (meta?.referenceKind === "line" || hit.object instanceof THREE.Line) return 1;
  if (meta?.kind === "wing" || meta?.kind === "mesh" || meta?.kind === "solid") return 2;
  if (meta?.referenceKind === "surface" || meta?.referenceKind === "face") return 3;
  if (meta?.referenceKind === "plane") return 4;
  return 5;
}

export function findCadObjectMeta(object: THREE.Object3D): {
  id?: string;
  name?: string;
  kind?: string;
  referenceKind?: "plane" | "point" | "line" | "face" | "surface";
} | undefined {
  let current: THREE.Object3D | null = object;
  while (current) {
    if (current.userData.cadObject) return current.userData.cadObject;
    current = current.parent;
  }
  return undefined;
}

export function triangleFromHit(hit: THREE.Intersection) {
  if (!hit.face || !(hit.object instanceof THREE.Mesh)) return undefined;
  const position = hit.object.geometry.getAttribute("position");
  const vertices = [hit.face.a, hit.face.b, hit.face.c].map((index) =>
    new THREE.Vector3(position.getX(index), position.getY(index), position.getZ(index)).applyMatrix4(hit.object.matrixWorld),
  );
  return { vertices };
}

export function projectToScreen(point: THREE.Vector3, camera: THREE.PerspectiveCamera, canvas: HTMLCanvasElement) {
  const projected = point.clone().project(camera);
  const bounds = canvas.getBoundingClientRect();
  return new THREE.Vector2(
    bounds.left + ((projected.x + 1) / 2) * bounds.width,
    bounds.top + ((-projected.y + 1) / 2) * bounds.height,
  );
}

export function distanceToSegment(point: THREE.Vector2, start: THREE.Vector2, end: THREE.Vector2) {
  const segment = end.clone().sub(start);
  const lengthSq = segment.lengthSq();
  if (lengthSq === 0) return point.distanceTo(start);
  const t = Math.max(0, Math.min(1, point.clone().sub(start).dot(segment) / lengthSq));
  return point.distanceTo(start.clone().add(segment.multiplyScalar(t)));
}

export function updateSelectionMarker(marker: THREE.Group, selection: SelectedGeometry | null) {
  marker.clear();
  if (!selection) return;

  const selectionBlue = "#38bdf8";
  const position = tupleToVector(selection.position);
  const sphere = new THREE.Mesh(
    new THREE.SphereGeometry(selection.type === "point" ? 0.007 : 0.006, 12, 12),
    new THREE.MeshBasicMaterial({ color: selectionBlue, depthTest: false }),
  );
  sphere.position.copy(position);
  sphere.renderOrder = 10;
  marker.add(sphere);

  if (selection.polygon && selection.polygon.length >= 3) {
    const vertices = selection.polygon.map(tupleToVector);
    const geometry = new THREE.BufferGeometry().setFromPoints(vertices);
    geometry.setIndex(vertices.length === 3 ? [0, 1, 2] : [0, 1, 2, 0, 2, 3]);
    geometry.computeVertexNormals();
    const face = new THREE.Mesh(
      geometry,
      new THREE.MeshBasicMaterial({
        color: selectionBlue,
        transparent: true,
        opacity: 0.32,
        side: THREE.DoubleSide,
        depthTest: false,
      }),
    );
    face.renderOrder = 8;
    marker.add(face);

    const outline = new THREE.LineLoop(
      new THREE.BufferGeometry().setFromPoints(vertices),
      new THREE.LineBasicMaterial({ color: selectionBlue, depthTest: false }),
    );
    outline.renderOrder = 11;
    marker.add(outline);
  } else if ((selection.type === "plane" || selection.type === "surface") && selection.normal) {
    const vertices = planeSelectionPolygon(position, tupleToVector(selection.normal), 0.16).map(tupleToVector);
    const outline = new THREE.LineLoop(
      new THREE.BufferGeometry().setFromPoints(vertices),
      new THREE.LineBasicMaterial({ color: selectionBlue, depthTest: false }),
    );
    outline.renderOrder = 11;
    marker.add(outline);
  }

  if (selection.type === "line" && selection.start && selection.end) {
    const geometry = new THREE.BufferGeometry().setFromPoints([tupleToVector(selection.start), tupleToVector(selection.end)]);
    const line = new THREE.Line(geometry, new THREE.LineBasicMaterial({ color: selectionBlue, depthTest: false }));
    line.renderOrder = 10;
    marker.add(line);

    for (const endpoint of [selection.start, selection.end]) {
      const endpointMarker = new THREE.Mesh(
        new THREE.SphereGeometry(0.0045, 10, 10),
        new THREE.MeshBasicMaterial({ color: selectionBlue, depthTest: false }),
      );
      endpointMarker.position.copy(tupleToVector(endpoint));
      endpointMarker.renderOrder = 10;
      marker.add(endpointMarker);
    }
  }
}

export function updateBrowserSelectionMarker(marker: THREE.Group, selectedId: string, objects: THREE.Object3D[]) {
  marker.clear();
  if (!selectedId) return;

  const targets = selectableTargetsForBrowserItem(selectedId, objects);
  for (const target of targets) {
    addObjectHighlight(marker, target);
  }
}

export function selectableTargetsForBrowserItem(selectedId: string, objects: THREE.Object3D[]) {
  const targets: THREE.Object3D[] = [];
  for (const object of objects) {
    if (!object.visible) continue;
    object.traverse((child) => {
      if (!child.visible) return;
      const meta = findCadObjectMeta(child);
      if (!meta) return;
      if (selectedId === "project" || selectedId === "origin") {
        if (meta.id?.startsWith("origin-plane-") || selectedId === "project") targets.push(child);
        return;
      }
      if (selectedId.startsWith("section:")) {
        if (meta.id && browserGroupIdForSceneMeta(meta) === selectedId) targets.push(child);
        return;
      }
      if (meta.id === selectedId) targets.push(child);
    });
  }
  return targets.filter((target, index, all) => all.indexOf(target) === index);
}

export function browserGroupIdForSceneMeta(meta: { id?: string; kind?: string; referenceKind?: string }): BrowserGroupId | undefined {
  if (meta.id?.startsWith("origin-plane-")) return "origin";
  if (meta.kind === "wing" || meta.kind === "mesh" || meta.kind === "solid") return "section:bodies";
  if (meta.referenceKind === "surface" || meta.referenceKind === "face") return "section:surfaces";
  if (meta.referenceKind === "line" || meta.referenceKind === "point") return "section:sketches";
  if (meta.referenceKind === "plane") return "section:planes";
  return undefined;
}

export function addObjectHighlight(marker: THREE.Group, object: THREE.Object3D) {
  if (object instanceof THREE.Mesh && object.geometry instanceof THREE.BufferGeometry && object.geometry.getAttribute("position")) {
    const outline = outlineFromMeshGeometry(object);
    if (outline) {
      marker.add(outline);
      return;
    }
  }

  const box = new THREE.Box3().setFromObject(object);
  if (box.isEmpty()) return;
  const helper = new THREE.Box3Helper(box, "#38bdf8");
  if (Array.isArray(helper.material)) {
    helper.material.forEach((material) => {
      if ("depthTest" in material) material.depthTest = false;
    });
  } else {
    helper.material.depthTest = false;
  }
  helper.renderOrder = 12;
  marker.add(helper);
}

export function outlineFromMeshGeometry(mesh: THREE.Mesh) {
  const position = mesh.geometry.getAttribute("position");
  if (!position || position.count < 3 || position.count > 8) return undefined;
  const points: THREE.Vector3[] = [];
  for (let index = 0; index < position.count; index += 1) {
    points.push(new THREE.Vector3(position.getX(index), position.getY(index), position.getZ(index)).applyMatrix4(mesh.matrixWorld));
  }
  const orderedPoints = points.length === 4 ? orderCoplanarQuadPoints(points) : points;
  const line = new THREE.LineLoop(
    new THREE.BufferGeometry().setFromPoints(orderedPoints),
    new THREE.LineBasicMaterial({ color: "#38bdf8", depthTest: false }),
  );
  line.renderOrder = 12;
  return line;
}

export function orderCoplanarQuadPoints(points: THREE.Vector3[]) {
  const center = points.reduce((sum, point) => sum.add(point), new THREE.Vector3()).multiplyScalar(1 / points.length);
  const normal = new THREE.Vector3()
    .crossVectors(points[1].clone().sub(points[0]), points[2].clone().sub(points[0]))
    .normalize();
  const tangent = points[0].clone().sub(center).normalize();
  const bitangent = normal.clone().cross(tangent).normalize();
  return [...points].sort((a, b) => {
    const aOffset = a.clone().sub(center);
    const bOffset = b.clone().sub(center);
    const aAngle = Math.atan2(aOffset.dot(bitangent), aOffset.dot(tangent));
    const bAngle = Math.atan2(bOffset.dot(bitangent), bOffset.dot(tangent));
    return aAngle - bAngle;
  });
}

export function planeSelectionPolygon(center: THREE.Vector3, normal: THREE.Vector3, size: number): [number, number, number][] {
  const n = normal.clone().normalize();
  const tangent = new THREE.Vector3(1, 0, 0);
  if (Math.abs(tangent.dot(n)) > 0.92) tangent.set(0, 1, 0);
  tangent.cross(n).normalize();
  const bitangent = n.clone().cross(tangent).normalize();
  const half = size / 2;
  return [
    center.clone().add(tangent.clone().multiplyScalar(-half)).add(bitangent.clone().multiplyScalar(-half)),
    center.clone().add(tangent.clone().multiplyScalar(half)).add(bitangent.clone().multiplyScalar(-half)),
    center.clone().add(tangent.clone().multiplyScalar(half)).add(bitangent.clone().multiplyScalar(half)),
    center.clone().add(tangent.clone().multiplyScalar(-half)).add(bitangent.clone().multiplyScalar(half)),
  ].map(vectorToTuple);
}

export function fitCameraToObject(camera: THREE.PerspectiveCamera, controls: OrbitControls, object: THREE.Object3D) {
  if (object.children.length === 0) {
    camera.position.set(0.9, 0.55, 1.2);
    controls.target.set(0.08, 0, 0);
    return;
  }

  const box = new THREE.Box3().setFromObject(object);
  const center = box.getCenter(new THREE.Vector3());
  const size = box.getSize(new THREE.Vector3());
  const maxSize = Math.max(size.x, size.y, size.z, 0.25);
  const distance = maxSize / (2 * Math.tan((Math.PI * camera.fov) / 360));
  camera.position.copy(center).add(new THREE.Vector3(distance * 0.9, distance * 0.55, distance * 1.1));
  camera.near = distance / 100;
  camera.far = distance * 100;
  camera.updateProjectionMatrix();
  controls.target.copy(center);
  controls.update();
}
