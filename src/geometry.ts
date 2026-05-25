import * as THREE from "three";
import type { CadProject, MeshObject, ReferenceGeometry, SolidObject, Wing } from "./types";

type NacaDigits = {
  camber: number;
  camberPosition: number;
  thickness: number;
};

export function wingToMesh(wing: Wing): THREE.Mesh {
  const sections = 42;
  const samples = 64;
  const positions: number[] = [];
  const indices: number[] = [];
  const halfSpan = wing.spanM / 2;
  const zShift = wingRootZShift(wing);

  for (let station = 0; station <= sections; station += 1) {
    const t = station / sections;
    const y = -halfSpan + wing.spanM * t;
    const sideT = Math.abs(y) / halfSpan;
    const chord = lerp(wing.rootChordM, wing.tipChordM, sideT);
    const xOffset = Math.abs(y) * Math.tan(degToRad(wing.sweepDeg));
    const zOffset = Math.abs(y) * Math.tan(degToRad(wing.dihedralDeg));
    const twist = degToRad(wing.twistDeg * sideT);

    for (let sample = 0; sample < samples; sample += 1) {
      const u = sample / samples;
      const upper = sample < samples / 2;
      const airfoilU = upper ? 1 - u * 2 : (u - 0.5) * 2;
      const point = naca4Point(wing.airfoil, clamp01(airfoilU), chord, upper);
      const rotatedX = point.x * Math.cos(twist) - point.z * Math.sin(twist);
      const rotatedZ = point.x * Math.sin(twist) + point.z * Math.cos(twist);
      positions.push(rotatedX + xOffset - wing.rootChordM * 0.25, rotatedZ + zOffset, y + zShift);
    }
  }

  for (let station = 0; station < sections; station += 1) {
    for (let sample = 0; sample < samples; sample += 1) {
      const a = station * samples + sample;
      const b = station * samples + ((sample + 1) % samples);
      const c = (station + 1) * samples + sample;
      const d = (station + 1) * samples + ((sample + 1) % samples);
      indices.push(a, c, b, b, c, d);
    }
  }

  const geometry = new THREE.BufferGeometry();
  geometry.setAttribute("position", new THREE.Float32BufferAttribute(positions, 3));
  geometry.setIndex(indices);
  geometry.computeVertexNormals();

  const material = new THREE.MeshStandardMaterial({
    color: "#d8e6ee",
    metalness: 0.18,
    roughness: 0.44,
    side: THREE.DoubleSide,
  });

  const mesh = new THREE.Mesh(geometry, material);
  mesh.name = wing.name;
  return mesh;
}

export function buildMeasurementLines(wing: Wing): THREE.Group {
  const group = new THREE.Group();
  const material = new THREE.LineBasicMaterial({ color: "#7dd3fc" });
  const halfSpan = wing.spanM / 2;
  const zShift = wingRootZShift(wing);
  const spanGeometry = new THREE.BufferGeometry().setFromPoints([
    new THREE.Vector3(-wing.rootChordM * 0.35, 0.015, -halfSpan + zShift),
    new THREE.Vector3(-wing.rootChordM * 0.35, 0.015, halfSpan + zShift),
  ]);
  group.add(new THREE.Line(spanGeometry, material));

  const chordGeometry = new THREE.BufferGeometry().setFromPoints([
    new THREE.Vector3(-wing.rootChordM * 0.25, 0.025, zShift),
    new THREE.Vector3(wing.rootChordM * 0.75, 0.025, zShift),
  ]);
  group.add(new THREE.Line(chordGeometry, material));
  return group;
}

function wingRootZShift(wing: Wing) {
  return wing.rootAtOrigin ? wing.spanM / 2 : 0;
}

export function meshObjectToMesh(meshObject: MeshObject | SolidObject): THREE.Mesh {
  const geometry = new THREE.BufferGeometry();
  geometry.setAttribute("position", new THREE.Float32BufferAttribute(meshObject.positions, 3));
  if (meshObject.normals.length === meshObject.positions.length) {
    geometry.setAttribute("normal", new THREE.Float32BufferAttribute(meshObject.normals, 3));
  } else {
    geometry.computeVertexNormals();
  }

  const material = new THREE.MeshStandardMaterial({
    color: "#cbd5e1",
    metalness: 0.12,
    roughness: 0.5,
    side: THREE.DoubleSide,
  });

  const mesh = new THREE.Mesh(geometry, material);
  mesh.name = meshObject.name;
  return mesh;
}

export function referenceGeometryToObject(reference: ReferenceGeometry): THREE.Object3D {
  const group = new THREE.Group();
  group.name = reference.name;

  const origin = tupleToVector(reference.origin);
  const normal = tupleToVector(reference.normal ?? [0, 1, 0]).normalize();
  const size = reference.sizeM ?? 0.16;

  if (reference.referenceKind === "point") {
    const pointRadius = reference.cadRole === "sketch_point" ? 0.004 : Math.min(size * 0.045, 0.009);
    const geometry = new THREE.SphereGeometry(pointRadius, 12, 12);
    const material = new THREE.MeshBasicMaterial({ color: "#facc15" });
    const point = new THREE.Mesh(geometry, material);
    point.position.copy(origin);
    group.add(point);
  } else if (reference.referenceKind === "line") {
    const points = reference.points?.length
      ? reference.points.map(tupleToVector)
      : [origin, tupleToVector(reference.end ?? [origin.x + size, origin.y, origin.z])];
    const geometry = new THREE.BufferGeometry().setFromPoints(points);
    const material = new THREE.LineBasicMaterial({ color: "#facc15" });
    group.add(new THREE.Line(geometry, material));
  } else if (reference.referenceKind === "surface" && reference.points?.length) {
    const points = reference.points.map(tupleToVector);
    const geometry = new THREE.BufferGeometry().setFromPoints(points);
    const line = new THREE.Line(
      geometry,
      new THREE.LineBasicMaterial({ color: "#f59e0b", transparent: true, opacity: 0.9 }),
    );
    group.add(line);
    if (points.length >= 4) {
      const surfaceGeometry = new THREE.BufferGeometry();
      surfaceGeometry.setFromPoints(points.slice(0, 4));
      surfaceGeometry.setIndex([0, 1, 2, 0, 2, 3]);
      surfaceGeometry.computeVertexNormals();
      const surface = new THREE.Mesh(
        surfaceGeometry,
        new THREE.MeshBasicMaterial({
          color: "#f59e0b",
          transparent: true,
          opacity: 0.2,
          side: THREE.DoubleSide,
        }),
      );
      group.add(surface);
    }
  } else {
    const geometry = new THREE.PlaneGeometry(size, size);
    const color = reference.referenceKind === "plane" ? "#38bdf8" : "#f59e0b";
    const material = new THREE.MeshBasicMaterial({
      color,
      transparent: true,
      opacity: reference.referenceKind === "plane" ? 0.22 : 0.3,
      side: THREE.DoubleSide,
    });
    const plane = new THREE.Mesh(geometry, material);
    plane.position.copy(origin);
    plane.quaternion.setFromUnitVectors(new THREE.Vector3(0, 0, 1), normal);
    group.add(plane);

    const half = size / 2;
    const outline = new THREE.LineLoop(
      new THREE.BufferGeometry().setFromPoints([
        new THREE.Vector3(-half, -half, 0),
        new THREE.Vector3(half, -half, 0),
        new THREE.Vector3(half, half, 0),
        new THREE.Vector3(-half, half, 0),
      ]),
      new THREE.LineBasicMaterial({ color }),
    );
    outline.position.copy(plane.position);
    outline.quaternion.copy(plane.quaternion);
    group.add(outline);
  }

  return group;
}

export function projectToStl(project: CadProject): string {
  const facets = project.objects.flatMap((object) => {
    if (object.kind === "wing") return wingToFacets(object);
    if (object.kind === "mesh" || object.kind === "solid") return meshToFacets(object);
    return [];
  });
  return `solid cadex\n${facets.join("")}endsolid cadex\n`;
}

function wingToFacets(wing: Wing): string[] {
  const mesh = wingToMesh(wing);
  const geometry = mesh.geometry;
  const positions = geometry.getAttribute("position");
  const index = geometry.getIndex();
  const facets: string[] = [];
  if (!index) return facets;

  for (let i = 0; i < index.count; i += 3) {
    const a = index.getX(i);
    const b = index.getX(i + 1);
    const c = index.getX(i + 2);
    facets.push(
      facet(
        [positions.getX(a), positions.getZ(a), positions.getY(a)],
        [positions.getX(b), positions.getZ(b), positions.getY(b)],
        [positions.getX(c), positions.getZ(c), positions.getY(c)],
      ),
    );
  }

  geometry.dispose();
  return facets;
}

function meshToFacets(mesh: MeshObject | SolidObject): string[] {
  const facets: string[] = [];
  for (let i = 0; i + 8 < mesh.positions.length; i += 9) {
    facets.push(
      facet(
        [mesh.positions[i], mesh.positions[i + 1], mesh.positions[i + 2]],
        [mesh.positions[i + 3], mesh.positions[i + 4], mesh.positions[i + 5]],
        [mesh.positions[i + 6], mesh.positions[i + 7], mesh.positions[i + 8]],
      ),
    );
  }
  return facets;
}

function facet(a: number[], b: number[], c: number[]) {
  const [nx, ny, nz] = triangleNormal(a, b, c);
  return `  facet normal ${nx} ${ny} ${nz}\n    outer loop\n      vertex ${a[0]} ${a[1]} ${a[2]}\n      vertex ${b[0]} ${b[1]} ${b[2]}\n      vertex ${c[0]} ${c[1]} ${c[2]}\n    endloop\n  endfacet\n`;
}

function triangleNormal(a: number[], b: number[], c: number[]): [number, number, number] {
  const ux = b[0] - a[0];
  const uy = b[1] - a[1];
  const uz = b[2] - a[2];
  const vx = c[0] - a[0];
  const vy = c[1] - a[1];
  const vz = c[2] - a[2];
  const nx = uy * vz - uz * vy;
  const ny = uz * vx - ux * vz;
  const nz = ux * vy - uy * vx;
  const length = Math.hypot(nx, ny, nz);
  return length > 0 ? [nx / length, ny / length, nz / length] : [0, 0, 0];
}

function tupleToVector(tuple: [number, number, number]) {
  return new THREE.Vector3(tuple[0], tuple[1], tuple[2]);
}

function naca4Point(airfoil: string, x: number, chord: number, upper: boolean) {
  const digits = parseNaca4(airfoil);
  const yt =
    5 *
    digits.thickness *
    (0.2969 * Math.sqrt(x) -
      0.126 * x -
      0.3516 * x ** 2 +
      0.2843 * x ** 3 -
      0.1015 * x ** 4);

  let yc = 0;
  let dycDx = 0;
  if (digits.camberPosition > 0 && x < digits.camberPosition) {
    yc =
      (digits.camber / digits.camberPosition ** 2) *
      (2 * digits.camberPosition * x - x ** 2);
    dycDx =
      (2 * digits.camber / digits.camberPosition ** 2) *
      (digits.camberPosition - x);
  } else if (digits.camberPosition > 0) {
    yc =
      (digits.camber / (1 - digits.camberPosition) ** 2) *
      (1 - 2 * digits.camberPosition + 2 * digits.camberPosition * x - x ** 2);
    dycDx =
      (2 * digits.camber / (1 - digits.camberPosition) ** 2) *
      (digits.camberPosition - x);
  }

  const theta = Math.atan(dycDx);
  const sign = upper ? 1 : -1;
  return {
    x: (x - sign * yt * Math.sin(theta)) * chord,
    z: (yc + sign * yt * Math.cos(theta)) * chord,
  };
}

function parseNaca4(airfoil: string): NacaDigits {
  const digits = airfoil.replace(/\D/g, "");
  if (digits.length !== 4) {
    return { camber: 0.02, camberPosition: 0.4, thickness: 0.12 };
  }
  return {
    camber: Number(digits[0]) / 100,
    camberPosition: Number(digits[1]) / 10,
    thickness: Number(digits.slice(2)) / 100,
  };
}

function lerp(start: number, end: number, t: number) {
  return start + (end - start) * t;
}

function clamp01(value: number) {
  return Math.min(1, Math.max(0, value));
}

function degToRad(value: number) {
  return (value * Math.PI) / 180;
}
