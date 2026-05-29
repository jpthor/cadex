import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import path from "node:path";
import { spawnSync } from "node:child_process";

const projectPath = path.resolve(process.argv[2] ?? "aircraft/dartv1/aircraft.json");
const exportDir = path.resolve(process.argv[3] ?? "exports/openvsp");
const aircraft = JSON.parse(readFileSync(projectPath, "utf8"));
const projectName = sanitizeName(aircraft.name ?? aircraft.project?.name ?? "aircraft");
const stem = `${projectName}_analysis`;
const partsDir = path.join(exportDir, `${stem}_parts`);
const scriptPath = path.join(exportDir, `${stem}.vspscript`);
const vsp3Path = path.join(exportDir, `${stem}.vsp3`);
const reportPath = path.join(exportDir, `${stem}_elements_report.json`);

mkdirSync(partsDir, { recursive: true });

const shapes = (aircraft.sizing?.shapes ?? []).filter((shape) => !["referenceLine", "mirrorPlane"].includes(shape.role));
const groups = [];

function sanitizeName(value) {
  return String(value).replace(/[^a-z0-9_-]+/gi, "_").replace(/^_+|_+$/g, "") || "aircraft";
}

function number(value, fallback = 0) {
  return Number.isFinite(Number(value)) ? Number(value) : fallback;
}

function escapeScript(value) {
  return String(value ?? "").replace(/\\/g, "\\\\").replace(/"/g, '\\"');
}

function sketchPoint(point) {
  return [number(point.xM), number(point.yM)];
}

function distance(a, b) {
  return Math.hypot(a[0] - b[0], a[1] - b[1]);
}

function cleanPoly(poly) {
  const result = [];
  for (const point of poly) {
    if (!result.length || distance(result[result.length - 1], point) > 1e-5) result.push(point);
  }
  if (result.length > 1 && distance(result[0], result[result.length - 1]) < 1e-5) result.pop();
  return result;
}

function signedArea(poly) {
  let area = 0;
  for (let index = 0; index < poly.length; index += 1) {
    const current = poly[index];
    const next = poly[(index + 1) % poly.length];
    area += current[0] * next[1] - next[0] * current[1];
  }
  return area / 2;
}

function minAbsX(points) {
  return points.length ? Math.min(...points.map((point) => Math.abs(number(point.xM)))) : Infinity;
}

function maxAbsX(points) {
  return points.length ? Math.max(...points.map((point) => Math.abs(number(point.xM)))) : 0;
}

function touchesCenterline(shape) {
  const points = shape.points ?? [];
  const partType = shape.partType ?? "";
  const tolerance = shape.role === "part" && !["motor", "rotor"].includes(partType) ? Math.max(0.03, maxAbsX(points) * 0.4) : 0.006;
  return minAbsX(points) <= tolerance;
}

function mirrorPolyX(poly, mirrorX = 0) {
  return cleanPoly(poly.map(([x, y]) => [2 * mirrorX - x, y]).reverse());
}

function fullPolygons(shape) {
  const points = shape.points ?? [];
  if (points.length < 3) return [];
  const base = cleanPoly(points.map(sketchPoint));
  const isTailplane = shape.role === "liftingSurface" && shape.liftingSurfaceKind === "tailplane";

  if (isTailplane && !touchesCenterline(shape)) {
    const localMirrorX = Math.min(...base.map(([x]) => x));
    const local = cleanPoly([...base, ...mirrorPolyX(base, localMirrorX).filter(([x]) => Math.abs(x - localMirrorX) > 1e-5)]);
    return [
      { name: "right", poly: local },
      { name: "left", poly: mirrorPolyX(local, 0) },
    ];
  }

  if (touchesCenterline(shape)) {
    const mirrored = [...base]
      .reverse()
      .filter(([x]) => Math.abs(x) > 1e-5)
      .map(([x, y]) => [-x, y]);
    return [{ name: "center", poly: cleanPoly([...base, ...mirrored]) }];
  }

  return [
    { name: "right", poly: base },
    { name: "left", poly: mirrorPolyX(base, 0) },
  ];
}

function addGroup(name) {
  const group = { name, verts: [], faces: [] };
  groups.push(group);
  return group;
}

function addVertex(group, point) {
  group.verts.push(point);
  return group.verts.length - 1;
}

function addFace(group, a, b, c) {
  group.faces.push([a, b, c]);
}

function extrudePlanform(group, poly, zTop, zBottom) {
  let clean = cleanPoly(poly);
  if (clean.length < 3 || Math.abs(signedArea(clean)) < 1e-6) return;
  if (signedArea(clean) < 0) clean = [...clean].reverse();
  const top = clean.map(([x, y]) => addVertex(group, [x, y, zTop]));
  const bottom = clean.map(([x, y]) => addVertex(group, [x, y, zBottom]));
  for (let index = 1; index < clean.length - 1; index += 1) {
    addFace(group, top[0], top[index], top[index + 1]);
    addFace(group, bottom[0], bottom[index + 1], bottom[index]);
  }
  for (let index = 0; index < clean.length; index += 1) {
    const next = (index + 1) % clean.length;
    addFace(group, top[index], bottom[index], bottom[next]);
    addFace(group, top[index], bottom[next], top[next]);
  }
}

function extrudeVertical(group, polyYZ, lateral, halfThickness) {
  let clean = cleanPoly(polyYZ);
  if (clean.length < 3 || Math.abs(signedArea(clean)) < 1e-6) return;
  if (signedArea(clean) < 0) clean = [...clean].reverse();
  const left = clean.map(([longitudinal, z]) => addVertex(group, [lateral - halfThickness, longitudinal, z]));
  const right = clean.map(([longitudinal, z]) => addVertex(group, [lateral + halfThickness, longitudinal, z]));
  for (let index = 1; index < clean.length - 1; index += 1) {
    addFace(group, left[0], left[index], left[index + 1]);
    addFace(group, right[0], right[index + 1], right[index]);
  }
  for (let index = 0; index < clean.length; index += 1) {
    const next = (index + 1) % clean.length;
    addFace(group, left[index], right[index], right[next]);
    addFace(group, left[index], right[next], left[next]);
  }
}

function segmentBox(group, a, b, width, zTop, zBottom) {
  const dx = b[0] - a[0];
  const dy = b[1] - a[1];
  const length = Math.hypot(dx, dy) || 1;
  const nx = (-dy / length) * (width / 2);
  const ny = (dx / length) * (width / 2);
  extrudePlanform(
    group,
    [
      [a[0] + nx, a[1] + ny],
      [b[0] + nx, b[1] + ny],
      [b[0] - nx, b[1] - ny],
      [a[0] - nx, a[1] - ny],
    ],
    zTop,
    zBottom,
  );
}

function verticalRotor(group, center, radius, bladeCount, chord) {
  const [x, y] = center;
  const rootCut = radius * 0.12;
  for (let index = 0; index < bladeCount; index += 1) {
    const angle = (Math.PI * 2 * index) / bladeCount;
    const cy = Math.cos(angle);
    const sz = Math.sin(angle);
    const halfChord = chord / 2;
    const positive = [
      addVertex(group, [x + cy * rootCut, y - halfChord, sz * rootCut]),
      addVertex(group, [x + cy * rootCut, y + halfChord, sz * rootCut]),
      addVertex(group, [x + cy * radius, y + halfChord, sz * radius]),
      addVertex(group, [x + cy * radius, y - halfChord, sz * radius]),
    ];
    addFace(group, positive[0], positive[1], positive[2]);
    addFace(group, positive[0], positive[2], positive[3]);
    const negative = [
      addVertex(group, [x - cy * rootCut, y - halfChord, -sz * rootCut]),
      addVertex(group, [x - cy * rootCut, y + halfChord, -sz * rootCut]),
      addVertex(group, [x - cy * radius, y + halfChord, -sz * radius]),
      addVertex(group, [x - cy * radius, y - halfChord, -sz * radius]),
    ];
    addFace(group, negative[0], negative[2], negative[1]);
    addFace(group, negative[0], negative[3], negative[2]);
  }
}

function tailboomLaterals() {
  const booms = shapes.filter((shape) => shape.role === "body" && /boom|empennage/i.test(shape.label ?? ""));
  const station = booms.map((shape) => centroidAbsX(shape.points ?? [])).find((value) => value > 0.01) ?? 0.69;
  return [station, -station];
}

function centroidAbsX(points) {
  return points.length ? points.reduce((sum, point) => sum + Math.abs(number(point.xM)), 0) / points.length : 0;
}

function normal(a, b, c) {
  const u = [b[0] - a[0], b[1] - a[1], b[2] - a[2]];
  const v = [c[0] - a[0], c[1] - a[1], c[2] - a[2]];
  const n = [u[1] * v[2] - u[2] * v[1], u[2] * v[0] - u[0] * v[2], u[0] * v[1] - u[1] * v[0]];
  const length = Math.hypot(...n) || 1;
  return n.map((value) => value / length);
}

function writeStl(group, index) {
  const filePath = path.join(partsDir, `${String(index).padStart(2, "0")}_${sanitizeName(group.name)}.stl`);
  let stl = `solid ${sanitizeName(group.name)}\n`;
  for (const face of group.faces) {
    const a = group.verts[face[0]];
    const b = group.verts[face[1]];
    const c = group.verts[face[2]];
    const faceNormal = normal(a, b, c);
    stl += `facet normal ${faceNormal[0]} ${faceNormal[1]} ${faceNormal[2]}\nouter loop\n`;
    stl += `vertex ${a[0]} ${a[1]} ${a[2]}\nvertex ${b[0]} ${b[1]} ${b[2]}\nvertex ${c[0]} ${c[1]} ${c[2]}\n`;
    stl += "endloop\nendfacet\n";
  }
  stl += `endsolid ${sanitizeName(group.name)}\n`;
  writeFileSync(filePath, stl);
  return filePath;
}

for (const shape of shapes) {
  const points = shape.points ?? [];
  if (shape.role === "part" && shape.partType === "rotor" && points.length >= 2) {
    const center = sketchPoint(points[0]);
    const end = sketchPoint(points[1]);
    const radius = distance(center, end);
    const bladeCount = Math.max(1, Math.round(number(shape.rotorBladeCount, 2)));
    for (const [suffix, side] of [["right", 1], ["left", -1]]) {
      const group = addGroup(`${shape.label ?? "Rotor"} ${suffix}`);
      verticalRotor(group, [side * Math.abs(center[0]), center[1]], radius, bladeCount, Math.max(radius * 0.05, 0.012));
    }
    continue;
  }

  if (shape.role === "part" && shape.partType === "motor" && points.length >= 2) {
    const start = sketchPoint(points[0]);
    const end = sketchPoint(points[1]);
    const width = Math.max(distance(start, end) * 1.2, 0.035);
    for (const [suffix, side] of [["right", 1], ["left", -1]]) {
      const group = addGroup(`${shape.label ?? "Motor"} ${suffix}`);
      segmentBox(group, [side * Math.abs(start[0]), start[1]], [side * Math.abs(end[0]), end[1]], width, 0.035, -0.035);
    }
    continue;
  }

  if (shape.role === "liftingSurface" && shape.liftingSurfaceKind === "fin" && points.length >= 3) {
    const profile = cleanPoly(points.map((point) => [number(point.yM), Math.abs(number(point.xM))]));
    for (const [index, lateral] of tailboomLaterals().entries()) {
      const group = addGroup(`${shape.label ?? "Fin"} ${index + 1}`);
      extrudeVertical(group, profile, lateral, 0.006);
    }
    continue;
  }

  const polygons = fullPolygons(shape);
  const thickness = shape.role === "liftingSurface" ? 0.018 : shape.role === "body" ? 0.06 : 0.04;
  for (const item of polygons) {
    const group = addGroup(`${shape.label ?? "Shape"} ${item.name}`);
    extrudePlanform(group, item.poly, thickness / 2, -thickness / 2);
  }
}

const stlFiles = groups.map(writeStl);

let script = `void main()\n{\n    ClearVSPModel();\n    string gid;\n`;
for (let index = 0; index < groups.length; index += 1) {
  script += `    gid = ImportFile("${escapeScript(stlFiles[index])}", IMPORT_STL, "");\n`;
  script += `    SetGeomName(gid, "${escapeScript(groups[index].name)}");\n`;
  script += "    Update();\n";
}
script += `    WriteVSPFile("${escapeScript(vsp3Path)}", SET_ALL);\n}\n`;
writeFileSync(scriptPath, script);

const vspBinary = findOpenVspBinary();
let openvsp = { attempted: false, ok: false, stdout: "", stderr: "" };
if (vspBinary) {
  const result = spawnSync(vspBinary, ["-script", scriptPath], { encoding: "utf8" });
  openvsp = {
    attempted: true,
    ok: result.status === 0 || exists(vsp3Path),
    status: result.status,
    stdout: result.stdout ?? "",
    stderr: result.stderr ?? "",
  };
}

const output = {
  projectPath,
  scriptPath,
  vsp3Path,
  partsDir,
  objects: groups.map((group, index) => ({ name: group.name, stlPath: stlFiles[index], vertices: group.verts.length, triangles: group.faces.length })),
  openvsp,
};
writeFileSync(reportPath, JSON.stringify(output, null, 2));
console.log(JSON.stringify(output, null, 2));

function exists(filePath) {
  try {
    readFileSync(filePath);
    return true;
  } catch {
    return false;
  }
}

function findOpenVspBinary() {
  const candidates = ["/Applications/OpenVSP.app/Contents/Resources/vsp", "vsp", "openvsp"];
  for (const candidate of candidates) {
    const result = spawnSync(candidate, ["-help"], { encoding: "utf8" });
    if (!result.error) return candidate;
  }
  return null;
}
