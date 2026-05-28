import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import path from "node:path";
import { spawnSync } from "node:child_process";

const projectPath = path.resolve(process.argv[2] ?? "aircraft/dartv1/aircraft.json");
const exportDir = path.resolve(process.argv[3] ?? "exports/openvsp");
const aircraft = JSON.parse(readFileSync(projectPath, "utf8"));
const projectName = sanitizeName(aircraft.name ?? aircraft.project?.name ?? "aircraft");
const stem = `${projectName}_analysis`;
const scriptPath = path.join(exportDir, `${stem}.vspscript`);
const vsp3Path = path.join(exportDir, `${stem}.vsp3`);
const reportPath = path.join(exportDir, `${stem}_report.json`);

mkdirSync(exportDir, { recursive: true });

const shapes = (aircraft.sizing?.shapes ?? []).filter(
  (shape) => !["referenceLine", "mirrorPlane"].includes(shape.role),
);
const report = [];

function sanitizeName(value) {
  return String(value).replace(/[^a-z0-9_-]+/gi, "_").replace(/^_+|_+$/g, "") || "aircraft";
}

function number(value, fallback = 0) {
  return Number.isFinite(Number(value)) ? Number(value) : fallback;
}

function escapeScript(value) {
  return String(value ?? "").replace(/\\/g, "\\\\").replace(/"/g, '\\"');
}

function sketchToVsp(point) {
  return [number(point.yM), number(point.xM)];
}

function distance(a, b) {
  return Math.hypot(a[0] - b[0], a[1] - b[1]);
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

function mirroredAcrossCenter(poly) {
  return cleanPoly(poly.map(([x, y]) => [x, -y]).reverse());
}

function liftingPolygons(shape) {
  const points = shape.points ?? [];
  if (points.length < 3) return [];
  const base = cleanPoly(points.map(sketchToVsp));
  const isTailplane = shape.liftingSurfaceKind === "tailplane";

  if (isTailplane && !touchesCenterline(shape)) {
    const localMirrorY = Math.min(...base.map(([, y]) => y));
    const local = cleanPoly([
      ...base,
      ...[...base]
        .reverse()
        .filter(([, y]) => Math.abs(y - localMirrorY) > 1e-5)
        .map(([x, y]) => [x, 2 * localMirrorY - y]),
    ]);
    return [local, mirroredAcrossCenter(local)];
  }

  if (touchesCenterline(shape)) {
    const mirrored = [...base]
      .reverse()
      .filter(([, y]) => Math.abs(y) > 1e-5)
      .map(([x, y]) => [x, -y]);
    return [cleanPoly([...base, ...mirrored])];
  }

  return [base, mirroredAcrossCenter(base)];
}

function chordAtSpan(poly, spanY) {
  const hits = [];
  const eps = 1e-7;
  for (let index = 0; index < poly.length; index += 1) {
    const a = poly[index];
    const b = poly[(index + 1) % poly.length];
    const minY = Math.min(a[1], b[1]);
    const maxY = Math.max(a[1], b[1]);
    if (spanY < minY - eps || spanY > maxY + eps) continue;
    if (Math.abs(a[1] - b[1]) < eps) {
      if (Math.abs(spanY - a[1]) < eps) hits.push(a[0], b[0]);
      continue;
    }
    const t = (spanY - a[1]) / (b[1] - a[1]);
    hits.push(a[0] + (b[0] - a[0]) * t);
  }
  if (hits.length < 2) return null;
  const leading = Math.max(...hits);
  const trailing = Math.min(...hits);
  const chord = leading - trailing;
  if (chord <= 0.01) return null;
  return { y: spanY, leading, trailing, chord };
}

function stationsForPolygon(poly) {
  const ys = [...new Set(poly.map(([, y]) => y))]
    .sort((a, b) => a - b)
    .filter((value, index, values) => index === 0 || Math.abs(value - values[index - 1]) > 0.01);
  const stations = [];
  for (const y of ys) {
    const station = chordAtSpan(poly, y);
    if (station) stations.push(station);
  }
  if (stations.length >= 2) return stations;

  const minY = Math.min(...poly.map(([, y]) => y));
  const maxY = Math.max(...poly.map(([, y]) => y));
  const minX = Math.min(...poly.map(([x]) => x));
  const maxX = Math.max(...poly.map(([x]) => x));
  return [
    { y: minY, leading: maxX, trailing: minX, chord: Math.max(maxX - minX, 0.03) },
    { y: maxY, leading: maxX, trailing: minX, chord: Math.max(maxX - minX, 0.03) },
  ];
}

function bounds(points) {
  const xs = points.map((point) => Math.abs(number(point.xM)));
  const ys = points.map((point) => number(point.yM));
  return {
    minX: Math.min(...xs),
    maxX: Math.max(...xs),
    minY: Math.min(...ys),
    maxY: Math.max(...ys),
  };
}

function centroid(points) {
  return {
    xM: points.reduce((sum, point) => sum + Math.abs(number(point.xM)), 0) / points.length,
    yM: points.reduce((sum, point) => sum + number(point.yM), 0) / points.length,
  };
}

function setIfValid() {
  return `void SetIfValid(string geom, string parm, string group, double val)
{
    string pid = FindParm(geom, parm, group);
    if (ValidParm(pid)) { SetParmVal(pid, val); }
}

`;
}

function addPodScript(shape) {
  const points = shape.points ?? [];
  if (points.length < 2) return "";
  const b = bounds(points);
  const c = centroid(points);
  const centered = touchesCenterline(shape);
  const length = Math.max(b.maxY - b.minY, 0.02);
  const radius = Math.max(centered ? b.maxX : (b.maxX - b.minX) / 2, 0.01);
  const fineRatio = Math.max(length / radius, 0.1);
  const scripts = [];
  for (const side of centered ? [1] : [1, -1]) {
    const name = `${shape.label ?? "Pod"}${centered ? "" : side < 0 ? " mirror" : ""}`;
    scripts.push(`
    // pod/body/part: ${escapeScript(name)}
    gid = AddGeom("POD", "");
    SetGeomName(gid, "${escapeScript(name)}");
    SetIfValid(gid, "Length", "Design", ${length});
    SetIfValid(gid, "FineRatio", "Design", ${fineRatio});
    SetIfValid(gid, "X_Rel_Location", "XForm", ${c.yM});
    SetIfValid(gid, "Y_Rel_Location", "XForm", ${centered ? 0 : side * c.xM});
    SetIfValid(gid, "Z_Rel_Location", "XForm", 0.0);
    Update();
`);
  }
  report.push({ label: shape.label, kind: "pod", count: scripts.length, lengthM: length, radiusM: radius });
  return scripts.join("");
}

function addPropScript(shape) {
  const points = shape.points ?? [];
  if (points.length < 2) return "";
  const center = sketchToVsp(points[0]);
  const end = sketchToVsp(points[1]);
  const radius = Math.max(distance(center, end), 0.02);
  const bladeCount = Math.max(1, Math.round(number(shape.rotorBladeCount, 2)));
  report.push({ label: shape.label, kind: "prop", count: 2, diameterM: radius * 2, bladeCount });
  return [1, -1]
    .map((side) => {
      const name = `${shape.label ?? "Rotor"}${side < 0 ? " mirror" : ""}`;
      return `
    // rotor: ${escapeScript(name)}
    gid = AddGeom("PROP", "");
    SetGeomName(gid, "${escapeScript(name)}");
    SetIfValid(gid, "Diameter", "Design", ${radius * 2});
    SetIfValid(gid, "NumBlade", "Design", ${bladeCount});
    SetIfValid(gid, "X_Rel_Location", "XForm", ${center[0]});
    SetIfValid(gid, "Y_Rel_Location", "XForm", ${side * Math.abs(center[1])});
    SetIfValid(gid, "Z_Rel_Location", "XForm", 0.0);
    Update();
`;
    })
    .join("");
}

function addWingScript(shape) {
  const scripts = [];
  const polygons = liftingPolygons(shape);
  polygons.forEach((poly, polyIndex) => {
    const stations = stationsForPolygon(poly);
    if (stations.length < 2) return;
    const name = `${shape.label ?? "Surface"}${polygons.length > 1 ? ` ${polyIndex + 1}` : ""}`;
    const first = stations[0];
    const sectionCount = stations.length - 1;
    let script = `
    // lifting surface: ${escapeScript(name)}
    gid = AddGeom("WING", "");
    SetGeomName(gid, "${escapeScript(name)}");
    SetIfValid(gid, "Sym_Planar_Flag", "Sym", 0);
`;
    if (sectionCount > 1) {
      for (let index = 0; index < sectionCount; index += 1) {
        script += `    InsertXSec(gid, 1, XS_FOUR_SERIES);\n`;
      }
      script += `    CutXSec(gid, 1);\n    Update();\n`;
    }
    script += `    SetIfValid(gid, "X_Rel_Location", "XForm", ${first.trailing});
    SetIfValid(gid, "Y_Rel_Location", "XForm", ${first.y});
    SetIfValid(gid, "Z_Rel_Location", "XForm", 0.0);
`;
    for (let index = 0; index < sectionCount; index += 1) {
      const a = stations[index];
      const b = stations[index + 1];
      const span = Math.max(b.y - a.y, 0.02);
      const sweep = (Math.atan2(a.trailing - b.trailing, span) * 180) / Math.PI;
      const twist = number(shape.incidenceDeg, 0);
      script += `    SetDriverGroup(gid, ${index + 1}, SPAN_WSECT_DRIVER, ROOTC_WSECT_DRIVER, TIPC_WSECT_DRIVER);
    SetIfValid(gid, "Span", "XSec_${index + 1}", ${span});
    SetIfValid(gid, "Root_Chord", "XSec_${index + 1}", ${Math.max(a.chord, 0.03)});
    SetIfValid(gid, "Tip_Chord", "XSec_${index + 1}", ${Math.max(b.chord, 0.03)});
    SetIfValid(gid, "Sweep", "XSec_${index + 1}", ${sweep});
    SetIfValid(gid, "Sweep_Location", "XSec_${index + 1}", 0.999);
    SetIfValid(gid, "Dihedral", "XSec_${index + 1}", 0.0);
    SetIfValid(gid, "Twist", "XSec_${index + 1}", ${twist});
    Update();
`;
    }
    scripts.push(script);
    report.push({
      label: shape.label,
      kind: "wing",
      liftingSurfaceKind: shape.liftingSurfaceKind,
      objectName: name,
      sections: sectionCount,
      stations,
    });
  });
  return scripts.join("");
}

let script = `${setIfValid()}void main()
{
    ClearVSPModel();
    string gid;
`;

for (const shape of shapes) {
  if (shape.role === "liftingSurface") continue;
  if (shape.role === "part" && shape.partType === "rotor") {
    script += addPropScript(shape);
  } else {
    script += addPodScript(shape);
  }
}
for (const shape of shapes.filter((shape) => shape.role === "liftingSurface")) {
  script += addWingScript(shape);
}

script += `
    Update();
    WriteVSPFile("${escapeScript(vsp3Path)}", SET_ALL);
}
`;

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
  objects: report,
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
