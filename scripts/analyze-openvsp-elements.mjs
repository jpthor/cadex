import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import path from "node:path";
import { spawnSync } from "node:child_process";

const projectPath = path.resolve(process.argv[2] ?? "aircraft/dartv1/aircraft.json");
const exportDir = path.resolve(process.argv[3] ?? "exports/openvsp");
const vsp3Path = path.resolve(process.argv[4] ?? path.join(exportDir, "DartV1_analysis.vsp3"));
const aircraft = JSON.parse(readFileSync(projectPath, "utf8"));
const reportPath = path.join(exportDir, "DartV1_analysis_audit.json");
const vspScriptPath = path.join(exportDir, "DartV1_analysis_audit.vspscript");

mkdirSync(exportDir, { recursive: true });

const shapes = (aircraft.sizing?.shapes ?? []).filter((shape) => !["referenceLine", "mirrorPlane"].includes(shape.role));
const elementReport = readJsonIfExists(path.join(exportDir, "DartV1_analysis_elements_report.json"));
const stlObjects = (elementReport?.objects ?? []).map((object) => ({ ...object, mesh: readStl(object.stlPath) }));
const meshSummary = stlObjects.map((object) => summarizeMesh(object.name, object.mesh));
const sketchSummary = summarizeSketch(shapes);
const clearances = computeClearances(shapes);
const openvsp = runOpenVspAudit(vsp3Path, vspScriptPath);

const audit = {
  projectPath,
  vsp3Path,
  generatedAt: new Date().toISOString(),
  openvsp,
  sketchSummary,
  clearances,
  meshSummary,
  notes: [
    "This audit uses the sketch-faithful element export. It is reliable for layout, projected area, bounds, and clearance checks.",
    "Imported STL meshes are not ideal for final VSPAERO polars. For that, the next step is a station-based parametric OpenVSP wing/body model using the same 10% and 90% chord stations.",
  ],
};

writeFileSync(reportPath, JSON.stringify(audit, null, 2));
console.log(JSON.stringify(audit, null, 2));

function readJsonIfExists(filePath) {
  try {
    return JSON.parse(readFileSync(filePath, "utf8"));
  } catch {
    return undefined;
  }
}

function readStl(filePath) {
  const text = readFileSync(filePath, "utf8");
  const vertices = [];
  const triangles = [];
  let current = [];
  for (const line of text.split(/\r?\n/)) {
    const match = line.trim().match(/^vertex\s+([-+0-9.eE]+)\s+([-+0-9.eE]+)\s+([-+0-9.eE]+)/);
    if (!match) continue;
    current.push(match.slice(1).map(Number));
    if (current.length === 3) {
      triangles.push(current);
      vertices.push(...current);
      current = [];
    }
  }
  return { vertices, triangles };
}

function summarizeMesh(name, mesh) {
  const bounds = meshBounds(mesh.vertices);
  const areaM2 = mesh.triangles.reduce((sum, tri) => sum + triangleArea(tri[0], tri[1], tri[2]), 0);
  const signedVolumeM3 = mesh.triangles.reduce((sum, tri) => sum + signedTetraVolume(tri[0], tri[1], tri[2]), 0);
  return {
    name,
    vertices: mesh.vertices.length,
    triangles: mesh.triangles.length,
    bounds,
    surfaceAreaM2: areaM2,
    signedVolumeM3,
    volumeM3: Math.abs(signedVolumeM3),
  };
}

function meshBounds(vertices) {
  if (!vertices.length) return { minX: 0, maxX: 0, minY: 0, maxY: 0, minZ: 0, maxZ: 0 };
  return {
    minX: Math.min(...vertices.map((v) => v[0])),
    maxX: Math.max(...vertices.map((v) => v[0])),
    minY: Math.min(...vertices.map((v) => v[1])),
    maxY: Math.max(...vertices.map((v) => v[1])),
    minZ: Math.min(...vertices.map((v) => v[2])),
    maxZ: Math.max(...vertices.map((v) => v[2])),
  };
}

function triangleArea(a, b, c) {
  const ab = [b[0] - a[0], b[1] - a[1], b[2] - a[2]];
  const ac = [c[0] - a[0], c[1] - a[1], c[2] - a[2]];
  return Math.hypot(
    ab[1] * ac[2] - ab[2] * ac[1],
    ab[2] * ac[0] - ab[0] * ac[2],
    ab[0] * ac[1] - ab[1] * ac[0],
  ) / 2;
}

function signedTetraVolume(a, b, c) {
  return (
    a[0] * (b[1] * c[2] - b[2] * c[1]) -
    a[1] * (b[0] * c[2] - b[2] * c[0]) +
    a[2] * (b[0] * c[1] - b[1] * c[0])
  ) / 6;
}

function summarizeSketch(allShapes) {
  const lifting = allShapes.filter((shape) => shape.role === "liftingSurface");
  const parts = allShapes.filter((shape) => shape.role === "part");
  const bodies = allShapes.filter((shape) => shape.role === "body");
  const wingAreaM2 = lifting
    .filter((shape) => (shape.liftingSurfaceKind ?? "wing") === "wing")
    .reduce((sum, shape) => sum + effectivePlanformArea(shape), 0);
  const tailplaneAreaM2 = lifting
    .filter((shape) => shape.liftingSurfaceKind === "tailplane")
    .reduce((sum, shape) => sum + effectivePlanformArea(shape), 0);
  const wingBounds = combinedMirroredBounds(lifting.filter((shape) => (shape.liftingSurfaceKind ?? "wing") === "wing"));
  const tailBounds = combinedMirroredBounds(lifting.filter((shape) => shape.liftingSurfaceKind === "tailplane"));
  return {
    elements: allShapes.length,
    bodies: bodies.length,
    liftingSurfaces: lifting.length,
    parts: parts.length,
    wingAreaM2,
    tailplaneAreaM2,
    wingSpanM: wingBounds.maxX - wingBounds.minX,
    tailplaneSpanM: tailBounds.maxX - tailBounds.minX,
    partCounts: countParts(parts),
  };
}

function countParts(parts) {
  return parts.reduce((counts, shape) => {
    const key = shape.partType ?? "payload";
    counts[key] = (counts[key] ?? 0) + (touchesCenterline(shape) ? 1 : 2);
    return counts;
  }, {});
}

function effectivePlanformArea(shape) {
  const base = cleanPoly((shape.points ?? []).map((p) => [number(p.xM), number(p.yM)]));
  if (base.length < 3) return 0;
  const area = Math.abs(polygonArea(base));
  if (shape.liftingSurfaceKind === "tailplane" && !touchesCenterline(shape)) {
    return area * 4;
  }
  return touchesCenterline(shape) ? area : area * 2;
}

function combinedMirroredBounds(items) {
  const points = [];
  for (const shape of items) {
    for (const point of shape.points ?? []) {
      points.push([point.xM, point.yM], [-point.xM, point.yM]);
    }
  }
  if (!points.length) return { minX: 0, maxX: 0, minY: 0, maxY: 0 };
  return {
    minX: Math.min(...points.map((p) => p[0])),
    maxX: Math.max(...points.map((p) => p[0])),
    minY: Math.min(...points.map((p) => p[1])),
    maxY: Math.max(...points.map((p) => p[1])),
  };
}

function computeClearances(allShapes) {
  const rotors = allShapes.filter((shape) => shape.role === "part" && shape.partType === "rotor" && shape.points?.length >= 2);
  const surfaces = allShapes.filter((shape) => shape.role === "liftingSurface" || shape.role === "body");
  const results = [];
  for (const rotor of rotors) {
    const center = rotor.points[0];
    const end = rotor.points[1];
    const radius = distance2([center.xM, center.yM], [end.xM, end.yM]);
    for (const side of center.xM === 0 ? [1] : [1, -1]) {
      const rotorCenter = [side * Math.abs(center.xM), center.yM];
      for (const surface of surfaces) {
        for (const poly of mirroredPolygons(surface)) {
          const signedClearanceM = circlePolygonClearance(rotorCenter, radius, poly);
          results.push({
            rotor: `${rotor.label ?? "Rotor"} ${side > 0 ? "right" : "left"}`,
            target: `${surface.label ?? "Shape"} ${poly.side}`,
            clearanceM: signedClearanceM,
            status: signedClearanceM < 0 ? "overlap" : signedClearanceM < 0.03 ? "tight" : "clear",
          });
        }
      }
    }
  }
  return results
    .filter((item) => item.status !== "clear" || /Wing|tailboom|Tailplane|Fin/i.test(item.target))
    .sort((a, b) => a.clearanceM - b.clearanceM)
    .slice(0, 20);
}

function mirroredPolygons(shape) {
  const base = cleanPoly((shape.points ?? []).map((p) => [number(p.xM), number(p.yM)]));
  if (base.length < 2) return [];
  if (touchesCenterline(shape)) return [{ side: "center", points: base }];
  return [
    { side: "right", points: base },
    { side: "left", points: cleanPoly(base.map(([x, y]) => [-x, y]).reverse()) },
  ];
}

function circlePolygonClearance(center, radius, poly) {
  const points = poly.points;
  let minDistance = Number.POSITIVE_INFINITY;
  for (let i = 0; i < points.length; i += 1) {
    const a = points[i];
    const b = points[(i + 1) % points.length];
    minDistance = Math.min(minDistance, pointSegmentDistance(center, a, b));
  }
  const inside = points.length >= 3 && pointInPolygon(center, points);
  return (inside ? -1 : 1) * minDistance - radius;
}

function pointSegmentDistance(point, a, b) {
  const dx = b[0] - a[0];
  const dy = b[1] - a[1];
  const lengthSquared = dx * dx + dy * dy;
  if (lengthSquared <= 1e-12) return distance2(point, a);
  const t = Math.max(0, Math.min(1, ((point[0] - a[0]) * dx + (point[1] - a[1]) * dy) / lengthSquared));
  return distance2(point, [a[0] + dx * t, a[1] + dy * t]);
}

function pointInPolygon(point, poly) {
  let inside = false;
  for (let i = 0, j = poly.length - 1; i < poly.length; j = i, i += 1) {
    const xi = poly[i][0];
    const yi = poly[i][1];
    const xj = poly[j][0];
    const yj = poly[j][1];
    const intersect = yi > point[1] !== yj > point[1] && point[0] < ((xj - xi) * (point[1] - yi)) / (yj - yi || 1e-12) + xi;
    if (intersect) inside = !inside;
  }
  return inside;
}

function runOpenVspAudit(modelPath, scriptPath) {
  const script = `void main()
{
    ReadVSPFile("${escapeScript(modelPath)}");
    Update();
    string comp = ExecAnalysis("CompGeom");
    array<double> wet = GetDoubleResults(comp, "Total_Wet_Area");
    array<double> theo = GetDoubleResults(comp, "Total_Theo_Area");
    array<double> vol = GetDoubleResults(comp, "Total_Wet_Vol");
    array<int> tris = GetIntResults(comp, "Total_Num_Tris");
    Print("CADEX_COMP_WET_AREA=" + wet[0] + "\\n");
    Print("CADEX_COMP_THEO_AREA=" + theo[0] + "\\n");
    Print("CADEX_COMP_WET_VOL=" + vol[0] + "\\n");
    Print("CADEX_COMP_TRIS=" + tris[0] + "\\n");

    string mass = ExecAnalysis("MassProp");
    array<double> totalMass = GetDoubleResults(mass, "Total_Mass");
    array<double> totalVolume = GetDoubleResults(mass, "Total_Volume");
    array<double> ixx = GetDoubleResults(mass, "Total_Ixx");
    array<double> iyy = GetDoubleResults(mass, "Total_Iyy");
    array<double> izz = GetDoubleResults(mass, "Total_Izz");
    Print("CADEX_MASS_TOTAL=" + totalMass[0] + "\\n");
    Print("CADEX_MASS_VOLUME=" + totalVolume[0] + "\\n");
    Print("CADEX_MASS_IXX=" + ixx[0] + "\\n");
    Print("CADEX_MASS_IYY=" + iyy[0] + "\\n");
    Print("CADEX_MASS_IZZ=" + izz[0] + "\\n");
}
`;
  writeFileSync(scriptPath, script);
  const result = spawnSync("/Applications/OpenVSP.app/Contents/Resources/vsp", ["-script", scriptPath], { encoding: "utf8" });
  const output = `${result.stdout ?? ""}\n${result.stderr ?? ""}`;
  const values = {};
  for (const line of output.split(/\r?\n/)) {
    const match = line.match(/CADEX_([A-Z_]+)=([-+0-9.eE]+)/);
    if (match) values[match[1].toLowerCase()] = Number(match[2]);
  }
  return {
    ok: result.status === 0 || Object.keys(values).length > 0,
    status: result.status,
    values,
  };
}

function cleanPoly(poly) {
  const result = [];
  for (const point of poly) {
    if (!result.length || distance2(result[result.length - 1], point) > 1e-5) result.push(point);
  }
  if (result.length > 1 && distance2(result[0], result[result.length - 1]) < 1e-5) result.pop();
  return result;
}

function polygonArea(poly) {
  let area = 0;
  for (let i = 0; i < poly.length; i += 1) {
    const a = poly[i];
    const b = poly[(i + 1) % poly.length];
    area += a[0] * b[1] - b[0] * a[1];
  }
  return area / 2;
}

function touchesCenterline(shape) {
  return (shape.points ?? []).some((point) => Math.abs(number(point.xM)) <= 0.006);
}

function distance2(a, b) {
  return Math.hypot(a[0] - b[0], a[1] - b[1]);
}

function number(value, fallback = 0) {
  return Number.isFinite(Number(value)) ? Number(value) : fallback;
}

function escapeScript(value) {
  return String(value).replace(/\\/g, "\\\\").replace(/"/g, '\\"');
}
