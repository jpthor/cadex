import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import path from "node:path";
import { spawnSync } from "node:child_process";

const projectPath = path.resolve(process.argv[2] ?? "aircraft/dartv1/aircraft.json");
const exportDir = path.resolve(process.argv[3] ?? "exports/openvsp");
const aircraft = JSON.parse(readFileSync(projectPath, "utf8"));
const projectName = sanitizeName(aircraft.name ?? aircraft.project?.name ?? "aircraft");
const stem = `${projectName}_sketch_faithful`;
const stlPath = path.join(exportDir, `${stem}.stl`);
const scriptPath = path.join(exportDir, `${stem}_import.vspscript`);
const vsp3Path = path.join(exportDir, `${stem}.vsp3`);
const reportPath = path.join(exportDir, `${stem}_report.json`);

mkdirSync(exportDir, { recursive: true });

const shapes = (aircraft.sizing?.shapes ?? []).filter(
  (shape) => !["referenceLine", "mirrorPlane"].includes(shape.role),
);
const verts = [];
const faces = [];
const report = [];

function sanitizeName(value) {
  return String(value).replace(/[^a-z0-9_-]+/gi, "_").replace(/^_+|_+$/g, "") || "aircraft";
}

function number(value, fallback = 0) {
  return Number.isFinite(Number(value)) ? Number(value) : fallback;
}

function sketchToVsp(point) {
  return [number(point.yM), number(point.xM)];
}

function distance(a, b) {
  return Math.hypot(a[0] - b[0], a[1] - b[1]);
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
  const tolerance =
    shape.role === "part" && !["motor", "rotor"].includes(partType)
      ? Math.max(0.03, maxAbsX(points) * 0.4)
      : 0.006;
  return minAbsX(points) <= tolerance;
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

function cleanPoly(poly) {
  const result = [];
  for (const point of poly) {
    if (!result.length || distance(result[result.length - 1], point) > 1e-5) {
      result.push(point);
    }
  }
  if (result.length > 1 && distance(result[0], result[result.length - 1]) < 1e-5) {
    result.pop();
  }
  return result;
}

function fullPolygons(shape) {
  const points = shape.points ?? [];
  if (points.length < 3) return [];

  const base = cleanPoly(points.map(sketchToVsp));
  const isTailplane = shape.role === "liftingSurface" && shape.liftingSurfaceKind === "tailplane";
  if (isTailplane && !touchesCenterline(shape)) {
    const localMirrorY = Math.min(...base.map(([, y]) => y));
    const local = cleanPoly([
      ...base,
      ...[...base]
        .reverse()
        .filter(([, y]) => Math.abs(y - localMirrorY) > 1e-5)
        .map(([x, y]) => [x, 2 * localMirrorY - y]),
    ]);
    return [local, cleanPoly(local.map(([x, y]) => [x, -y]).reverse())];
  }

  if (touchesCenterline(shape)) {
    const mirrored = [...base]
      .reverse()
      .filter(([, y]) => Math.abs(y) > 1e-5)
      .map(([x, y]) => [x, -y]);
    return [cleanPoly([...base, ...mirrored])];
  }

  return [base, cleanPoly(base.map(([x, y]) => [x, -y]).reverse())];
}

function addVertex(point) {
  verts.push(point);
  return verts.length - 1;
}

function addFace(a, b, c) {
  faces.push([a, b, c]);
}

function extrudePolygon(poly, zTop, zBottom) {
  let clean = cleanPoly(poly);
  if (clean.length < 3 || Math.abs(signedArea(clean)) < 1e-6) return;
  if (signedArea(clean) < 0) clean = [...clean].reverse();

  const top = clean.map(([x, y]) => addVertex([x, y, zTop]));
  const bottom = clean.map(([x, y]) => addVertex([x, y, zBottom]));
  for (let index = 1; index < clean.length - 1; index += 1) {
    addFace(top[0], top[index], top[index + 1]);
    addFace(bottom[0], bottom[index + 1], bottom[index]);
  }
  for (let index = 0; index < clean.length; index += 1) {
    const next = (index + 1) % clean.length;
    addFace(top[index], bottom[index], bottom[next]);
    addFace(top[index], bottom[next], top[next]);
  }
}

function addSegmentBox(a, b, width, zTop, zBottom) {
  const dx = b[0] - a[0];
  const dy = b[1] - a[1];
  const length = Math.hypot(dx, dy) || 1;
  const nx = (-dy / length) * (width / 2);
  const ny = (dx / length) * (width / 2);
  extrudePolygon(
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

function addVerticalRotor(center, radius, bladeCount, chord) {
  const [x, y] = center;
  const rootCut = radius * 0.12;
  for (let index = 0; index < bladeCount; index += 1) {
    const angle = (Math.PI * 2 * index) / bladeCount;
    const cy = Math.cos(angle);
    const sz = Math.sin(angle);
    const halfChord = chord / 2;

    const positive = [
      addVertex([x - halfChord, y + cy * rootCut, sz * rootCut]),
      addVertex([x + halfChord, y + cy * rootCut, sz * rootCut]),
      addVertex([x + halfChord, y + cy * radius, sz * radius]),
      addVertex([x - halfChord, y + cy * radius, sz * radius]),
    ];
    addFace(positive[0], positive[1], positive[2]);
    addFace(positive[0], positive[2], positive[3]);

    const negative = [
      addVertex([x - halfChord, y - cy * rootCut, -sz * rootCut]),
      addVertex([x + halfChord, y - cy * rootCut, -sz * rootCut]),
      addVertex([x + halfChord, y - cy * radius, -sz * radius]),
      addVertex([x - halfChord, y - cy * radius, -sz * radius]),
    ];
    addFace(negative[0], negative[2], negative[1]);
    addFace(negative[0], negative[3], negative[2]);
  }
}

function normal(a, b, c) {
  const u = [b[0] - a[0], b[1] - a[1], b[2] - a[2]];
  const v = [c[0] - a[0], c[1] - a[1], c[2] - a[2]];
  const n = [
    u[1] * v[2] - u[2] * v[1],
    u[2] * v[0] - u[0] * v[2],
    u[0] * v[1] - u[1] * v[0],
  ];
  const length = Math.hypot(...n) || 1;
  return n.map((value) => value / length);
}

function scriptString(value) {
  return String(value).replace(/\\/g, "\\\\").replace(/"/g, '\\"');
}

for (const shape of shapes) {
  const points = shape.points ?? [];
  if (shape.role === "part" && shape.partType === "rotor" && points.length >= 2) {
    const center = sketchToVsp(points[0]);
    const end = sketchToVsp(points[1]);
    const radius = distance(center, end);
    const bladeCount = Math.max(1, Math.round(number(shape.rotorBladeCount, 2)));
    const chord = Math.max(radius * 0.05, 0.012);
    addVerticalRotor(center, radius, bladeCount, chord);
    addVerticalRotor([center[0], -center[1]], radius, bladeCount, chord);
    report.push({ label: shape.label, kind: "rotor", radiusM: radius, count: 2, bladeCount });
    continue;
  }

  if (shape.role === "part" && shape.partType === "motor" && points.length >= 2) {
    const start = sketchToVsp(points[0]);
    const end = sketchToVsp(points[1]);
    const width = Math.max(distance(start, end) * 1.2, 0.035);
    addSegmentBox(start, end, width, 0.035, -0.035);
    addSegmentBox([start[0], -start[1]], [end[0], -end[1]], width, 0.035, -0.035);
    report.push({ label: shape.label, kind: "motor", count: 2 });
    continue;
  }

  const polygons = fullPolygons(shape);
  const thickness = shape.role === "liftingSurface" ? 0.018 : shape.role === "body" ? 0.06 : 0.04;
  for (const poly of polygons) extrudePolygon(poly, thickness / 2, -thickness / 2);
  report.push({
    label: shape.label,
    role: shape.role,
    partType: shape.partType,
    liftingSurfaceKind: shape.liftingSurfaceKind,
    polygons: polygons.length,
  });
}

let stl = `solid ${stem}\n`;
for (const face of faces) {
  const a = verts[face[0]];
  const b = verts[face[1]];
  const c = verts[face[2]];
  const faceNormal = normal(a, b, c);
  stl += `facet normal ${faceNormal[0]} ${faceNormal[1]} ${faceNormal[2]}\n`;
  stl += "outer loop\n";
  stl += `vertex ${a[0]} ${a[1]} ${a[2]}\n`;
  stl += `vertex ${b[0]} ${b[1]} ${b[2]}\n`;
  stl += `vertex ${c[0]} ${c[1]} ${c[2]}\n`;
  stl += "endloop\nendfacet\n";
}
stl += `endsolid ${stem}\n`;
writeFileSync(stlPath, stl);

writeFileSync(
  scriptPath,
  `void main()\n{\n    ClearVSPModel();\n    string gid = ImportFile("${scriptString(stlPath)}", IMPORT_STL, "");\n    SetGeomName(gid, "${scriptString(projectName)} sketch faithful mesh");\n    Update();\n    WriteVSPFile("${scriptString(vsp3Path)}", SET_ALL);\n}\n`,
);

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
  stlPath,
  scriptPath,
  vsp3Path,
  vertices: verts.length,
  triangles: faces.length,
  shapes: report,
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
  const candidates = [
    "/Applications/OpenVSP.app/Contents/Resources/vsp",
    "vsp",
    "openvsp",
  ];
  for (const candidate of candidates) {
    const result = spawnSync(candidate, ["-help"], { encoding: "utf8" });
    if (!result.error) return candidate;
  }
  return null;
}
