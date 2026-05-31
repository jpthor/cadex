#!/usr/bin/env node
import fs from "node:fs";
import path from "node:path";
import { spawnSync } from "node:child_process";

const inputPath = path.resolve(process.argv[2] ?? "aircraft/dart80kg/aircraft.json");
const outDir = path.resolve(process.argv[3] ?? "exports/openfoam");
const jsonOnly = process.argv.includes("--json-only");
const runMesh = process.argv.includes("--mesh");
const runSolve = process.argv.includes("--solve");
const lexSweep = process.argv.includes("--lex-sweep");
const propSwirlSweep = process.argv.includes("--prop-swirl-sweep");
const wingevonAlpha25 = process.argv.includes("--wingevon-alpha25");
const cruise = process.argv.includes("--cruise");
const reuseGeometry = process.argv.includes("--reuse-geometry");

const input = JSON.parse(fs.readFileSync(inputPath, "utf8"));
const name = input.name ?? input.project?.name ?? "CadexAircraft";
const sizing = input.sizing ?? input.project?.sizing;
if (!sizing?.shapes?.length) fail("No sizing sketch found.");
const movementControls = normalizeMovementControls(sizing.openFoam?.movementControls);
const surfaceCaptures = normalizeSurfaceCaptures(sizing.openFoam?.surfaceCaptures);
const activeSurfaceCaptureId = surfaceCaptures.some((capture) => capture.id === sizing.openFoam?.activeSurfaceCaptureId)
  ? sizing.openFoam.activeSurfaceCaptureId
  : undefined;

fs.mkdirSync(outDir, { recursive: true });

const stem = sanitize(name);
const geometryDir = path.join(outDir, `${stem}_geometry`);
const geometryManifestPath = path.join(geometryDir, "components.json");
let exported;
if (reuseGeometry) {
  if (!fs.existsSync(geometryManifestPath)) {
    fail("Prepared OpenFOAM geometry was not found. Run Prepare Geometry first.");
  }
  exported = JSON.parse(fs.readFileSync(geometryManifestPath, "utf8"));
  const missingSurface = exported.find((component) => !fs.existsSync(component.filePath));
  if (missingSurface) {
    fail(`Prepared OpenFOAM geometry is incomplete. Missing ${missingSurface.fileName}. Run Prepare Geometry again.`);
  }
} else {
  fs.rmSync(geometryDir, { recursive: true, force: true });
  fs.mkdirSync(geometryDir, { recursive: true });
  exported = exportGeometry(sizing, geometryDir);
  fs.writeFileSync(geometryManifestPath, JSON.stringify(exported, null, 2));
}
const verification = verifyGeometry(sizing, exported);
const preview = buildPreviewGeometry(exported, wingevonAlpha25 ? 120 : undefined);
const variants = propSwirlSweep
  ? buildPropSwirlVariants(exported)
  : cruise
    ? buildCruiseVariants(exported)
    : wingevonAlpha25
      ? buildWingevonAlpha25Variants(sizing, geometryDir)
      : lexSweep
        ? buildLexSweepVariants(exported)
        : buildVariants(exported);
const cases = variants.map((variant) => buildCase(stem, variant, sizing, outDir, { runMesh, runSolve }));

const report = {
  ok: verification.ok && cases.every((entry) => entry.ok),
  solver: "OpenFOAM",
  message: verification.ok
    ? "OpenFOAM geometry exported and cases prepared."
    : "OpenFOAM geometry export has verification warnings.",
  geometryDir,
  movementControls,
  surfaceCaptures,
  activeSurfaceCaptureId,
  preview,
  variants: cases,
  verification,
};

const reportPath = path.join(outDir, `${stem}_openfoam_report.json`);
fs.writeFileSync(reportPath, JSON.stringify({ ...report, reportPath }, null, 2));

if (jsonOnly) {
  process.stdout.write(JSON.stringify({ ...report, reportPath }, null, 2));
} else {
  console.log(JSON.stringify({ ...report, reportPath }, null, 2));
}

function exportGeometry(project, dir, options = {}) {
  fs.mkdirSync(dir, { recursive: true });
  const components = [];
  for (const shape of project.shapes) {
    if (shape.role === "referenceLine" || shape.role === "mirrorPlane") continue;
    const meshes = meshShape(shape, project.shapes, options);
    for (const mesh of meshes) {
      if (!mesh.triangles.length) continue;
      const fileName = `${sanitize(mesh.name)}.stl`;
      const filePath = path.join(dir, fileName);
      fs.writeFileSync(filePath, stl(mesh.name, mesh.triangles));
      components.push({
        label: shape.label,
        kind: shape.liftingSurfaceKind ?? shape.partType ?? shape.role,
        cadGeometryKind: shape.cadGeometry?.kind,
        sourceGeometry: shape.cadGeometry,
        name: mesh.name,
        fileName,
        filePath,
        triangles: mesh.triangles.length,
        areaM2: surfaceArea(mesh.triangles),
        bounds: boundsFor(mesh.triangles.flatMap((tri) => tri)),
        centroid: centroidFor(mesh.triangles),
        previewTriangles: mesh.triangles.map((tri) => tri.map((point) => point.map(round))),
      });
    }
  }
  return components;
}

function buildPreviewGeometry(components, maxTrianglesPerComponent) {
  return {
    components: components.map((component) => ({
      name: component.name,
      kind: component.kind,
      label: component.label,
      color: previewColor(component.kind),
      triangles: decimateTriangles(component.previewTriangles ?? [], maxTrianglesPerComponent),
    })),
  };
}

function decimateTriangles(triangles, maxTriangles) {
  if (!maxTriangles || triangles.length <= maxTriangles) return triangles;
  const step = Math.ceil(triangles.length / maxTriangles);
  return triangles.filter((_, index) => index % step === 0);
}

function previewColor(kind) {
  if (kind === "wing") return "#6fb7ff";
  if (kind === "wingevon") return "#83f3c7";
  if (kind === "lex") return "#ffcf66";
  if (kind === "tailplane") return "#b69cff";
  if (kind === "fin") return "#f28ba8";
  if (kind === "rotor") return "#f5f7fb";
  if (kind === "body") return "#d3dee7";
  return "#9fb2c0";
}

function meshShape(shape, shapes = [], options = {}) {
  const geom = shape.cadGeometry;
  if (shape.role === "liftingSurface" && shape.liftingSurfaceKind === "lex") return meshLexVortexGenerator(shape, shapes);
  if (shape.role === "liftingSurface" && shape.liftingSurfaceKind === "fin" && shape.sketchViewMode === "side") return meshSideViewFin(shape, shapes);
  if (geom?.kind === "revolvedBody") return mirrorRevolvedBodyIfNeeded([meshRevolvedBody(shape, geom)], geom);
  if (geom?.kind === "liftingSurface") return meshLiftingSurface(shape, geom, shapes, options);
  if (geom?.kind === "box") return mirrorIfNeeded(shape, [meshBox(shape, geom)]);
  if (geom?.kind === "cylinder") return mirrorIfNeeded(shape, [meshCylinder(shape.label, geom.centerM, geom.axisM, geom.radiusM, geom.lengthM)]);
  if (geom?.kind === "rotor") return mirrorIfNeeded(shape, [meshRotorDisk(shape, geom)]);
  if (shape.role === "liftingSurface" && shape.liftingSurfaceKind === "fin") return mirrorIfNeeded(shape, [meshFin(shape)]);
  return [];
}

function meshLiftingSurface(shape, geom, shapes, options = {}) {
  const baseName = componentName(shape);
  const meshes = [-1, 1].map((sign) => ({
    name: `${baseName}${sign < 0 ? "_left" : "_right"}`,
    triangles: drawnPlanformAirfoilTriangles(shape, geom, sign, shapes, options),
  }));
  const localMirrorY = localMirrorPlaneY(shape, shapes);
  if (!localMirrorY) return meshes;
  return meshes.flatMap((mesh) => {
    const centerY = centroidFor(mesh.triangles)[1];
    const planeY = (centerY < 0 ? -1 : 1) * localMirrorY;
    return [mesh, mirrorMeshAcrossYPlane(mesh, planeY, "_inboard")];
  });
}

function drawnPlanformAirfoilTriangles(shape, geom, sign, shapes = [], options = {}) {
  const planform = normalizedHalfPlanform(shape);
  const stationXs = planformStations(planform, 18);
  if (stationXs.length < 2) return liftingTriangles({
    rootLeadingEdge: geom.rootLeadingEdgeM,
    semispan: Math.max(geom.spanM / 2, 0.01),
    sign,
    rootChord: geom.rootChordM,
    tipChord: geom.tipChordM,
    incidenceDeg: geom.incidenceDeg ?? shape.incidenceDeg ?? 0,
    airfoil: shape.airfoilStations?.root ?? shape.airfoil ?? geom.airfoil ?? "NACA 0012",
    dihedralDeg: dihedralDeg(shape, geom),
  });

  const rootX = stationXs[0];
  const tipX = stationXs.at(-1);
  const spanM = Math.max(tipX - rootX, 0.01);
  const rootZM = geom.rootLeadingEdgeM?.[2] ?? 0;
  const dihedral = Math.tan((dihedralDeg(shape, { ...geom, spanM: spanM * 2 }) * Math.PI) / 180);
  const zStations = liftingSurfaceZStations(shape, shapes);
  const upper = [];
  const lower = [];
  for (const stationX of stationXs) {
    const station = chordAtSpanStation(planform, stationX);
    if (!station) continue;
    const eta = (stationX - rootX) / spanM;
    const chordM = station.leadingY - station.trailingY;
    const airfoil = airfoilAtStation(shape, eta, geom.airfoil);
    const wingevonDeflectionDeg = shape.liftingSurfaceKind === "wingevon" ? (options.wingevonDeflectionDeg ?? 0) : 0;
    const incidenceDeg = incidenceAtStation(shape, eta, geom.incidenceDeg) + wingevonDeflectionDeg;
    const pivotOffsetM = shape.liftingSurfaceKind === "wingevon" && Math.abs(wingevonDeflectionDeg) > 1e-6
      ? chordM * (options.wingevonPivotChordFraction ?? 0.25)
      : 0;
    const section = airfoilSectionSamples(airfoil, 44);
    const leadingXM = station.leadingY;
    const lateralYM = sign * stationX;
    const baseZM = zStations.length
      ? liftingSurfaceZAtStation(zStations, stationX)
      : rootZM + dihedral * (stationX - rootX);
    upper.push(section.map((sample) => airfoilWorldPoint(leadingXM, lateralYM, baseZM, sample.x * chordM, sample.yUpper * chordM, incidenceDeg, pivotOffsetM)));
    lower.push(section.map((sample) => airfoilWorldPoint(leadingXM, lateralYM, baseZM, sample.x * chordM, sample.yLower * chordM, incidenceDeg, pivotOffsetM)));
  }
  if (upper.length < 2) return [];
  const triangles = [];
  stitchGrid(triangles, upper, false);
  stitchGrid(triangles, lower, true);
  capSection(triangles, upper[0], lower[0], true);
  capSection(triangles, upper[upper.length - 1], lower[lower.length - 1], false);
  capSpanEdge(triangles, upper, lower, upper[0].length - 1, false);
  return triangles;
}

function liftingSurfaceZStations(shape, shapes) {
  const fallbackZ = effectiveZOffsetM(shape, shapes);
  const byStation = new Map();
  for (const point of shape.points ?? []) {
    const stationX = round(Math.abs(point.xM));
    const zM = pointAttachmentZ(point, shapes, fallbackZ);
    const values = byStation.get(stationX) ?? [];
    values.push(zM);
    byStation.set(stationX, values);
  }
  return [...byStation.entries()]
    .map(([x, values]) => ({ x, z: sum(values) / values.length }))
    .filter((station) => Number.isFinite(station.x) && Number.isFinite(station.z))
    .sort((a, b) => a.x - b.x);
}

function liftingSurfaceZAtStation(stations, stationX) {
  if (!stations.length) return 0;
  if (stationX <= stations[0].x) return stations[0].z;
  for (let index = 1; index < stations.length; index += 1) {
    const previous = stations[index - 1];
    const next = stations[index];
    if (stationX <= next.x) return lerp(previous.z, next.z, (stationX - previous.x) / Math.max(next.x - previous.x, 1e-6));
  }
  return stations.at(-1).z;
}

function pointAttachmentZ(point, shapes, fallbackZ) {
  const attachment = point.snapAttachment;
  if (!attachment) return fallbackZ;
  if (attachment.shapeId === "implicit-x-axis-mirror") return 0;
  const source = shapes.find((shape) => shape.id === attachment.shapeId);
  if (!source) return fallbackZ;
  if (source.cadGeometry?.kind === "liftingSurface") {
    const stations = liftingSurfaceZStations(source, shapes);
    if (stations.length) return liftingSurfaceZAtStation(stations, Math.abs(point.xM));
  }
  if (source.sketchViewMode === "side" && source.points?.length) {
    return sideReferenceXAt(source, attachment) + effectiveZOffsetM(source, shapes);
  }
  return effectiveZOffsetM(source, shapes);
}

function sideReferenceXAt(shape, attachment) {
  const points = shape.points ?? [];
  if (!points.length) return 0;
  if (attachment.kind === "node" && Number.isInteger(attachment.pointIndex)) return points[attachment.pointIndex]?.xM ?? 0;
  if (attachment.kind === "segment" && Number.isInteger(attachment.segmentIndex)) {
    const a = points[attachment.segmentIndex];
    const b = points[(attachment.segmentIndex + 1) % points.length];
    if (a && b) return lerp(a.xM, b.xM, attachment.t ?? 0);
  }
  return points.reduce((total, point) => total + point.xM, 0) / points.length;
}

function effectiveZOffsetM(shape, shapes) {
  const station = shapes.find((candidate) => candidate.id === shape.zStationId);
  if (!station) return shape.cadGeometry?.centerM?.[2] ?? 0;
  return verticalReferenceX(station) + effectiveZOffsetM(station, shapes);
}

function verticalReferenceX(shape) {
  if (!shape.points?.length) return 0;
  return shape.points.reduce((total, point) => total + point.xM, 0) / shape.points.length;
}

function localMirrorPlaneY(shape, shapes) {
  for (const candidate of shapes) {
    if (candidate.role !== "mirrorPlane" || candidate.sketchViewMode === "side" || !candidate.points?.length) continue;
    const planeY = candidate.points.reduce((total, point) => total + point.xM, 0) / candidate.points.length;
    const minX = Math.min(...candidate.points.map((point) => point.xM));
    const maxX = Math.max(...candidate.points.map((point) => point.xM));
    if (Math.abs(maxX - minX) > 0.02) continue;
    if (shape.points?.some((point) => point.snapAttachment?.shapeId === candidate.id)) return Math.abs(planeY);
    const minLong = Math.min(...candidate.points.map((point) => point.yM)) - 0.05;
    const maxLong = Math.max(...candidate.points.map((point) => point.yM)) + 0.05;
    const touches = shape.points?.some((point) => Math.abs(Math.abs(point.xM) - Math.abs(planeY)) <= 0.015 && point.yM >= minLong && point.yM <= maxLong);
    if (touches) return Math.abs(planeY);
  }
  return undefined;
}

function normalizedHalfPlanform(shape) {
  return shape.points
    .map((point) => ({ x: Math.abs(point.xM), y: point.yM }))
    .filter((point, index, points) => index === 0 || Math.hypot(point.x - points[index - 1].x, point.y - points[index - 1].y) > 1e-6);
}

function planformStations(points, uniformCount) {
  if (points.length < 3) return [];
  const xs = points.map((point) => point.x);
  const minX = Math.min(...xs);
  const maxX = Math.max(...xs);
  const spanM = maxX - minX;
  if (!Number.isFinite(spanM) || spanM <= 1e-6) return [];
  const stations = new Set(points.map((point) => round(point.x)));
  for (let i = 0; i <= uniformCount; i += 1) stations.add(round(minX + spanM * (i / uniformCount)));
  return [...stations]
    .sort((a, b) => a - b)
    .filter((x) => chordAtSpanStation(points, x));
}

function chordAtSpanStation(points, stationX) {
  const ys = [];
  const eps = 1e-5;
  for (let index = 0; index < points.length; index += 1) {
    const a = points[index];
    const b = points[(index + 1) % points.length];
    const minX = Math.min(a.x, b.x);
    const maxX = Math.max(a.x, b.x);
    if (Math.abs(a.x - b.x) <= eps) {
      if (Math.abs(stationX - a.x) <= eps) ys.push(a.y, b.y);
      continue;
    }
    if (stationX < minX - eps || stationX > maxX + eps) continue;
    const t = (stationX - a.x) / (b.x - a.x);
    if (t < -eps || t > 1 + eps) continue;
    ys.push(lerp(a.y, b.y, Math.min(Math.max(t, 0), 1)));
  }
  const uniqueYs = [...new Set(ys.map((y) => round(y)))];
  if (uniqueYs.length < 2) return undefined;
  const leadingY = Math.max(...uniqueYs);
  const trailingY = Math.min(...uniqueYs);
  if (leadingY - trailingY <= 0.005) return undefined;
  return { leadingY, trailingY };
}

function airfoilAtStation(shape, eta, fallback) {
  const root = shape.airfoilStations?.root ?? shape.airfoilStations?.root10 ?? shape.airfoil ?? fallback ?? "NACA 0012";
  const tip = shape.airfoilStations?.tip ?? shape.airfoilStations?.tip90 ?? shape.airfoil ?? fallback ?? root;
  return eta < 0.5 ? root : tip;
}

function incidenceAtStation(shape, eta, fallback = 0) {
  const root = shape.incidenceStationsDeg?.root ?? shape.incidenceStationsDeg?.root10 ?? shape.incidenceDeg ?? fallback ?? 0;
  const tip = shape.incidenceStationsDeg?.tip ?? shape.incidenceStationsDeg?.tip90 ?? shape.incidenceDeg ?? root;
  return lerp(root, tip, Math.min(Math.max(eta, 0), 1));
}

function airfoilSectionSamples(name, count) {
  const spec = airfoilSpec(name);
  const samples = [];
  for (let i = 0; i < count; i += 1) {
    const beta = (i / (count - 1)) * Math.PI;
    const x = (1 - Math.cos(beta)) / 2;
    const yt = 5 * spec.thicknessRatio * (0.2969 * Math.sqrt(x) - 0.126 * x - 0.3516 * x ** 2 + 0.2843 * x ** 3 - 0.1036 * x ** 4);
    const camber = airfoilCamber(spec, x);
    samples.push({ x, yUpper: camber + yt, yLower: camber - yt });
  }
  return samples;
}

function airfoilSpec(name) {
  const digits = String(name ?? "").match(/(\d{4})/)?.[1];
  if (digits) {
    return {
      thicknessRatio: Math.max(Number(digits.slice(2)) / 100, 0.04),
      maxCamber: Number(digits[0]) / 100,
      maxCamberStation: Number(digits[1]) / 10,
    };
  }
  const normalized = String(name ?? "").toLowerCase().replace(/\s+/g, "");
  if (normalized.includes("s1223")) return { thicknessRatio: 0.121, maxCamber: 0.075, maxCamberStation: 0.38 };
  if (normalized.includes("clarky")) return { thicknessRatio: 0.117, maxCamber: 0.035, maxCamberStation: 0.42 };
  if (normalized.includes("mh32")) return { thicknessRatio: 0.087, maxCamber: 0.018, maxCamberStation: 0.35 };
  return { thicknessRatio: 0.12, maxCamber: 0, maxCamberStation: 0 };
}

function airfoilCamber(spec, x) {
  const m = spec.maxCamber;
  const p = spec.maxCamberStation;
  if (!m || !p) return 0;
  if (x < p) return (m / (p * p)) * (2 * p * x - x * x);
  return (m / ((1 - p) * (1 - p))) * ((1 - 2 * p) + 2 * p * x - x * x);
}

function airfoilWorldPoint(leadingXM, lateralYM, baseZM, chordOffsetM, verticalOffsetM, incidenceDeg, pivotOffsetM = 0) {
  const angle = (incidenceDeg * Math.PI) / 180;
  const localAftM = chordOffsetM - pivotOffsetM;
  const aftM = localAftM * Math.cos(angle) - verticalOffsetM * Math.sin(angle);
  const upM = -localAftM * Math.sin(angle) + verticalOffsetM * Math.cos(angle);
  return [leadingXM - pivotOffsetM - aftM, lateralYM, baseZM + upM];
}

function meshLexVortexGenerator(shape, shapes = []) {
  const baseName = componentName(shape);
  const thicknessM = 0.006;
  const zStations = liftingSurfaceZStations(shape, shapes);
  return [-1, 1].map((sign) => ({
    name: `${baseName}${sign < 0 ? "_left" : "_right"}`,
    triangles: thinPolygonTriangles(
      shape.points.map((point) => [point.yM, sign * Math.abs(point.xM), zStations.length ? liftingSurfaceZAtStation(zStations, Math.abs(point.xM)) : 0]),
      thicknessM,
    ),
  }));
}

function meshSideViewFin(shape, shapes) {
  const station = sideViewStationY(shape, shapes);
  const thicknessM = 0.006;
  const baseName = componentName(shape);
  const make = (sign) => ({
    name: `${baseName}${sign < 0 ? "_left" : "_right"}`,
    triangles: thinSidePolygonTriangles(
      shape.points.map((point) => [point.yM, sign * station, point.xM]),
      thicknessM,
    ),
  });
  const meshes = station > 0.001 ? [make(-1), make(1)] : [make(1)];
  const mirrorZ = sideMirrorPlaneZ(shape, shapes);
  if (!Number.isFinite(mirrorZ)) return meshes;
  return meshes.flatMap((mesh) => [mesh, mirrorMeshAcrossZPlane(mesh, mirrorZ, "_bottom")]);
}

function sideViewStationY(shape, shapes) {
  const station = shapes.find((candidate) => candidate.id === shape.sideViewStationId);
  if (station?.points?.length) {
    return Math.abs(station.points.reduce((total, point) => total + point.xM, 0) / station.points.length);
  }
  return 0;
}

function sideMirrorPlaneZ(shape, shapes) {
  for (const candidate of shapes) {
    if (candidate.role !== "mirrorPlane" || candidate.sketchViewMode !== "side" || !candidate.points?.length) continue;
    if (candidate.sideViewStationId && shape.sideViewStationId && candidate.sideViewStationId !== shape.sideViewStationId) continue;
    const planeZ = candidate.points.reduce((total, point) => total + point.xM, 0) / candidate.points.length;
    const minZ = Math.min(...candidate.points.map((point) => point.xM));
    const maxZ = Math.max(...candidate.points.map((point) => point.xM));
    if (Math.abs(maxZ - minZ) > 0.02) continue;
    if (shape.points?.some((point) => point.snapAttachment?.shapeId === candidate.id)) return planeZ;
    const minLong = Math.min(...candidate.points.map((point) => point.yM)) - 0.05;
    const maxLong = Math.max(...candidate.points.map((point) => point.yM)) + 0.05;
    const touches = shape.points?.some((point) => Math.abs(point.xM - planeZ) <= 0.015 && point.yM >= minLong && point.yM <= maxLong);
    if (touches) return planeZ;
  }
  return undefined;
}

function thinSidePolygonTriangles(points, thicknessM) {
  const left = points.map(([x, y, z]) => [x, y - thicknessM / 2, z]);
  const right = points.map(([x, y, z]) => [x, y + thicknessM / 2, z]);
  const triangles = [];
  for (let i = 1; i < left.length - 1; i += 1) triangles.push([left[0], left[i], left[i + 1]]);
  for (let i = 1; i < right.length - 1; i += 1) triangles.push([right[0], right[i + 1], right[i]]);
  for (let i = 0; i < left.length; i += 1) {
    const j = (i + 1) % left.length;
    triangles.push([left[i], right[j], right[i]], [left[i], left[j], right[j]]);
  }
  return triangles;
}

function thinPolygonTriangles(points, thicknessM) {
  const cleanPoints = points.filter((point, index) => {
    const previous = points[(index + points.length - 1) % points.length];
    return mag(sub(point, previous)) > 1e-6;
  });
  const top = cleanPoints.map(([x, y, z]) => [x, y, z + thicknessM / 2]);
  const bottom = cleanPoints.map(([x, y, z]) => [x, y, z - thicknessM / 2]);
  const triangles = [];
  for (let i = 1; i < top.length - 1; i += 1) triangles.push([top[0], top[i], top[i + 1]]);
  for (let i = 1; i < bottom.length - 1; i += 1) triangles.push([bottom[0], bottom[i + 1], bottom[i]]);
  for (let i = 0; i < top.length; i += 1) {
    const j = (i + 1) % top.length;
    triangles.push([bottom[i], bottom[j], top[j]], [bottom[i], top[j], top[i]]);
  }
  return triangles;
}

function meshFin(shape) {
  const points = shape.points;
  const minY = Math.min(...points.map((p) => p.yM));
  const maxY = Math.max(...points.map((p) => p.yM));
  const minZ = Math.min(...points.map((p) => Math.abs(p.xM)));
  const maxZ = Math.max(...points.map((p) => Math.abs(p.xM)));
  const chord = Math.max(maxY - minY, 0.08);
  const height = Math.max(maxZ - minZ, 0.08);
  const rootLeading = [maxY, 0, 0];
  const geom = { rootLeadingEdgeM: rootLeading, spanM: height * 2, rootChordM: chord, tipChordM: chord * 0.55, incidenceDeg: 0 };
  return {
    name: componentName(shape),
    triangles: liftingTriangles({
      rootLeadingEdge: geom.rootLeadingEdgeM,
      semispan: height,
      sign: 1,
      rootChord: geom.rootChordM,
      tipChord: geom.tipChordM,
      incidenceDeg: 90,
      airfoil: shape.airfoil ?? "NACA 0012",
      vertical: true,
    }),
  };
}

function liftingTriangles(spec) {
  const sections = 10;
  const chordSamples = nacaAirfoil(spec.airfoil, 36);
  const upper = [];
  const lower = [];
  for (let i = 0; i <= sections; i += 1) {
    const eta = i / sections;
    const chord = lerp(spec.rootChord, spec.tipChord, eta);
    const leadX = spec.rootLeadingEdge[0];
    const y = spec.rootLeadingEdge[1] + spec.sign * spec.semispan * eta;
    const z = spec.rootLeadingEdge[2] + Math.tan((spec.dihedralDeg ?? 0) * Math.PI / 180) * spec.semispan * eta;
    const upRow = [];
    const lowRow = [];
    for (const sample of chordSamples) {
      const xLocal = sample.x * chord;
      const zUpper = sample.yt * chord;
      const zLower = -sample.yt * chord;
      upRow.push(rotateIncidence([leadX + xLocal, y, z + zUpper], spec.rootLeadingEdge, spec.incidenceDeg, spec.vertical));
      lowRow.push(rotateIncidence([leadX + xLocal, y, z + zLower], spec.rootLeadingEdge, spec.incidenceDeg, spec.vertical));
    }
    upper.push(upRow);
    lower.push(lowRow);
  }
  const triangles = [];
  stitchGrid(triangles, upper, false);
  stitchGrid(triangles, lower, true);
  capSection(triangles, upper[0], lower[0], true);
  capSection(triangles, upper[upper.length - 1], lower[lower.length - 1], false);
  return triangles;
}

function meshRevolvedBody(shape, geom) {
  const profile = (geom.profile?.length ? geom.profile : shape.points).map((p) => [p.yM, Math.abs(p.xM)]);
  const centerY = geom.centerM?.[1] ?? 0;
  const centerZ = geom.centerM?.[2] ?? 0;
  const rings = 36;
  const triangles = [];
  for (let i = 0; i < profile.length - 1; i += 1) {
    const [x1, r1] = profile[i];
    const [x2, r2] = profile[i + 1];
    for (let j = 0; j < rings; j += 1) {
      const a0 = (j / rings) * Math.PI * 2;
      const a1 = ((j + 1) / rings) * Math.PI * 2;
      const p00 = [x1, centerY + Math.cos(a0) * r1, centerZ + Math.sin(a0) * r1];
      const p01 = [x1, centerY + Math.cos(a1) * r1, centerZ + Math.sin(a1) * r1];
      const p10 = [x2, centerY + Math.cos(a0) * r2, centerZ + Math.sin(a0) * r2];
      const p11 = [x2, centerY + Math.cos(a1) * r2, centerZ + Math.sin(a1) * r2];
      triangles.push([p00, p10, p11], [p00, p11, p01]);
    }
  }
  return { name: componentName(shape), triangles };
}

function mirrorIfNeeded(shape, meshes) {
  if (!shouldMirrorAcrossCenterline(shape)) return meshes;
  return meshes.flatMap((mesh) => [mesh, mirrorMeshAcrossY(mesh)]);
}

function mirrorRevolvedBodyIfNeeded(meshes, geom) {
  if (Math.abs(geom.centerM?.[1] ?? 0) <= 0.001) return meshes;
  return meshes.flatMap((mesh) => [mesh, mirrorMeshAcrossY(mesh)]);
}

function shouldMirrorAcrossCenterline(shape) {
  if (!shape.points?.length) return false;
  const xs = shape.points.map((point) => point.xM);
  return Math.min(...xs) >= -0.001 && Math.max(...xs) > 0.001;
}

function mirrorMeshAcrossY(mesh) {
  return mirrorMeshAcrossYPlane(mesh, 0, "_mirror");
}

function mirrorMeshAcrossYPlane(mesh, planeY, suffix) {
  return {
    ...mesh,
    name: `${mesh.name}${suffix}`,
    triangles: mesh.triangles.map((tri) => [mirrorPointYAt(tri[0], planeY), mirrorPointYAt(tri[2], planeY), mirrorPointYAt(tri[1], planeY)]),
  };
}

function mirrorMeshAcrossZPlane(mesh, planeZ, suffix) {
  return {
    ...mesh,
    name: `${mesh.name}${suffix}`,
    triangles: mesh.triangles.map((tri) => [mirrorPointZAt(tri[0], planeZ), mirrorPointZAt(tri[2], planeZ), mirrorPointZAt(tri[1], planeZ)]),
  };
}

function mirrorPointY(point) {
  return mirrorPointYAt(point, 0);
}

function mirrorPointYAt(point, planeY) {
  return [point[0], 2 * planeY - point[1], point[2]];
}

function mirrorPointZAt(point, planeZ) {
  return [point[0], point[1], 2 * planeZ - point[2]];
}

function meshBox(shape, geom) {
  const [cx, cy, cz] = geom.centerM;
  const [sx, sy, sz] = geom.sizeM.map((v) => Math.max(v, 0.001));
  const x = [cx - sx / 2, cx + sx / 2];
  const y = [cy - sy / 2, cy + sy / 2];
  const z = [cz - sz / 2, cz + sz / 2];
  const p = [
    [x[0], y[0], z[0]], [x[1], y[0], z[0]], [x[1], y[1], z[0]], [x[0], y[1], z[0]],
    [x[0], y[0], z[1]], [x[1], y[0], z[1]], [x[1], y[1], z[1]], [x[0], y[1], z[1]],
  ];
  const faces = [[0, 1, 2, 3], [4, 7, 6, 5], [0, 4, 5, 1], [1, 5, 6, 2], [2, 6, 7, 3], [3, 7, 4, 0]];
  return { name: componentName(shape), triangles: faces.flatMap(([a, b, c, d]) => [[p[a], p[b], p[c]], [p[a], p[c], p[d]]]) };
}

function meshCylinder(name, center, axis, radius, length) {
  const n = 32;
  const dir = normalize(axis);
  const [u, v] = basis(dir);
  const c0 = add(center, scale(dir, -length / 2));
  const c1 = add(center, scale(dir, length / 2));
  const triangles = [];
  for (let i = 0; i < n; i += 1) {
    const a0 = (i / n) * Math.PI * 2;
    const a1 = ((i + 1) / n) * Math.PI * 2;
    const r0 = add(scale(u, Math.cos(a0) * radius), scale(v, Math.sin(a0) * radius));
    const r1 = add(scale(u, Math.cos(a1) * radius), scale(v, Math.sin(a1) * radius));
    const p00 = add(c0, r0);
    const p01 = add(c0, r1);
    const p10 = add(c1, r0);
    const p11 = add(c1, r1);
    triangles.push([p00, p10, p11], [p00, p11, p01], [c0, p01, p00], [c1, p10, p11]);
  }
  return { name: sanitize(name), triangles };
}

function meshRotorDisk(shape, geom) {
  return meshCylinder(`${componentName(shape)}_actuator_disk`, geom.centerM, [-1, 0, 0], geom.radiusM, Math.max(geom.radiusM * 0.04, 0.01));
}

function buildVariants(components) {
  const include = (rules) => components.filter((entry) => rules(entry.kind));
  return [
    { id: "clean", label: "Clean", components: include((kind) => !["lex", "rotor"].includes(kind)) },
    { id: "lex", label: "LEX", components: include((kind) => kind !== "rotor") },
    { id: "blown", label: "Blown", components: include((kind) => kind !== "lex") },
    { id: "full", label: "Full System", components: components },
  ];
}

function buildCruiseVariants(components) {
  return [{
    id: "cruise",
    label: "Cruise",
    alphaDeg: 0,
    airflow: { mode: "cruise" },
    components,
  }];
}

function buildWingevonAlpha25Variants(sizing, geometryDir) {
  const variants = [
    {
      id: "alpha25_wingevons_locked",
      label: "25 deg alpha - wingevons locked",
      deflectionDeg: 0,
      mode: "locked to airframe",
    },
    {
      id: "alpha25_wingevons_flat",
      label: "25 deg alpha - wingevons flat to flow",
      deflectionDeg: 25,
      mode: "flow-aligned",
    },
  ];
  return variants.map((variant) => {
    const components = exportGeometry(
      sizing,
      path.join(geometryDir, variant.id),
      {
        wingevonDeflectionDeg: variant.deflectionDeg,
        wingevonPivotChordFraction: 0.25,
      },
    ).filter((component) => component.kind !== "rotor");
    return {
      id: variant.id,
      label: variant.label,
      alphaDeg: 25,
      components,
      airflow: true,
      wingevonControl: {
        mode: variant.mode,
        deflectionDeg: variant.deflectionDeg,
        pivotChordFraction: 0.25,
        note: variant.deflectionDeg === 0
          ? "Wingevon chord stays locked to the airframe while the main wing sees 25 deg alpha."
          : "Wingevon incidence is rotated 25 deg so the outer panel is approximately flat to the incoming 25 deg freestream.",
      },
    };
  });
}

function buildLexSweepVariants(components) {
  const alphas = [10, 15, 20, 25];
  const cleanComponents = components.filter((entry) => !["lex", "rotor"].includes(entry.kind));
  const lexComponents = components.filter((entry) => entry.kind !== "rotor");
  return alphas.flatMap((alphaDeg) => [
    { id: `clean_alpha${alphaDeg}`, label: `Clean ${alphaDeg} deg`, alphaDeg, components: cleanComponents },
    { id: `lex_alpha${alphaDeg}`, label: `LEX ${alphaDeg} deg`, alphaDeg, components: lexComponents },
  ]);
}

function buildPropSwirlVariants(components) {
  const fullComponents = components;
  return [
    {
      id: "swirl_bottoms_in",
      label: "Prop swirl: bottoms-in",
      propSwirl: { mode: "bottoms-in" },
      components: fullComponents,
    },
    {
      id: "swirl_tops_in",
      label: "Prop swirl: tops-in",
      propSwirl: { mode: "tops-in" },
      components: fullComponents,
    },
  ];
}

function buildCase(stem, variant, sizing, outDir, options) {
  const caseDir = path.join(outDir, `${stem}_${variant.id}`);
  fs.rmSync(caseDir, { recursive: true, force: true });
  for (const sub of ["0", "constant/triSurface", "system"]) fs.mkdirSync(path.join(caseDir, sub), { recursive: true });
  for (const component of variant.components) {
    fs.copyFileSync(component.filePath, path.join(caseDir, "constant", "triSurface", component.fileName));
  }
  const bounds = mergeBounds(variant.components.map((component) => component.bounds));
  const refs = referenceValues(sizing, variant);
  const propSwirlAnalysis = variant.propSwirl ? analyzePropSwirl(variant, refs) : undefined;
  const airflowAnalysis = variant.airflow ? analyzeAirflowVisualization(variant, refs) : undefined;
  writeFoamCase(caseDir, variant, bounds, refs, propSwirlAnalysis, airflowAnalysis);
  const commands = [];
  let ok = true;
  let message = "case prepared";
  if (options.runMesh || options.runSolve) {
    const meshCommands = ["blockMesh", "surfaceFeatureExtract", "snappyHexMesh -overwrite"];
    if (propSwirlAnalysis) meshCommands.push("topoSet");
    meshCommands.push("checkMesh");
    for (const command of meshCommands) {
      const result = runOpenFoam(command, caseDir);
      commands.push(result);
      ok &&= result.ok;
      if (!result.ok) {
        message = `${command} failed`;
        break;
      }
    }
  }
  if (ok && options.runSolve) {
    const result = runOpenFoam("simpleFoam", caseDir);
    commands.push(result);
    ok &&= result.ok;
    message = result.ok ? "solved" : "simpleFoam failed";
  }
  const result = parseForceCoeffs(caseDir, "forceCoeffs");
  const surfaceResults = {
    wing: parseForceCoeffs(caseDir, "forceCoeffsWing"),
    wingevon: parseForceCoeffs(caseDir, "forceCoeffsWingevon"),
    body: parseForceCoeffs(caseDir, "forceCoeffsBody"),
    lex: parseForceCoeffs(caseDir, "forceCoeffsLex"),
  };
  const vortexSections = propSwirlAnalysis ? parseVortexSections(caseDir, propSwirlAnalysis) : undefined;
  const airflow = airflowAnalysis ? parseAirflowSections(caseDir, airflowAnalysis) : undefined;
  return {
    id: variant.id,
    label: variant.label,
    ok,
    message,
    caseDir,
    componentCount: variant.components.length,
    components: variant.components.map((entry) => entry.name),
    reference: refs,
    propSwirl: propSwirlAnalysis,
    wingevonControl: variant.wingevonControl,
    preview: variant.airflow ? buildPreviewGeometry(variant.components, 280) : undefined,
    airflow,
    vortexSections,
    result,
    surfaceResults,
    commands,
  };
}

function parseForceCoeffs(caseDir, functionName) {
  const coeffPath = path.join(caseDir, "postProcessing", functionName, "0", "coefficient.dat");
  if (!fs.existsSync(coeffPath)) return undefined;
  const lines = fs.readFileSync(coeffPath, "utf8").trim().split(/\r?\n/).filter((line) => line.trim() && !line.startsWith("#"));
  const last = lines.at(-1);
  if (!last) return undefined;
  const values = last.trim().split(/\s+/).map(Number);
  if (values.length < 13 || values.some((value) => !Number.isFinite(value))) return undefined;
  return {
    time: values[0],
    CD: values[1],
    CL: values[4],
    CmPitch: values[7],
    CmRoll: values[8],
    CmYaw: values[9],
    CSide: values[10],
    coefficientPath: coeffPath,
  };
}

function parseVortexSections(caseDir, propSwirlAnalysis) {
  const sectionRoot = path.join(caseDir, "postProcessing", "vortexSections");
  if (!fs.existsSync(sectionRoot)) return undefined;
  const timeDirs = fs.readdirSync(sectionRoot)
    .map((entry) => Number(entry))
    .filter((value) => Number.isFinite(value))
    .sort((a, b) => a - b);
  const time = timeDirs.at(-1);
  if (time === undefined) return undefined;
  const dir = path.join(sectionRoot, String(time));
  const sections = {};
  for (const plane of propSwirlAnalysis.samplePlanes) {
    const filePath = path.join(dir, `${sanitize(plane.name)}.vtp`);
    if (!fs.existsSync(filePath)) continue;
    sections[plane.name] = summarizeVorticitySection(filePath, propSwirlAnalysis.rotors);
  }
  const prop = sections.after_prop_yz;
  const rightSign = signOf(prop?.right?.meanOmegaX);
  const leftSign = signOf(prop?.left?.meanOmegaX);
  const expected = propSwirlAnalysis.lexVortexExpectation;
  const measuredVsLex =
    rightSign && leftSign
      ? (rightSign === expected.rightOmegaXSign && leftSign === expected.leftOmegaXSign
        ? "measured prop wake co-rotates with the expected LEX vortex signs"
        : "measured prop wake counter-rotates against the expected LEX vortex signs")
      : undefined;
  return {
    time,
    sections,
    plot: buildVortexPlotData(dir, propSwirlAnalysis, "after_prop_yz"),
    plots: propSwirlAnalysis.samplePlanes.map((plane) => buildVortexPlotData(dir, propSwirlAnalysis, plane.name)).filter(Boolean),
    measuredVsLex,
    note: "meanOmegaX is averaged over samples near each rotor on the YZ section; positive/negative signs are streamwise vorticity in OpenFOAM X.",
  };
}

function analyzeAirflowVisualization(variant, refs) {
  const rightSide = (components, kind) =>
    components
      .filter((component) => component.kind === kind)
      .sort((a, b) => (b.centroid?.[1] ?? b.bounds.center[1]) - (a.centroid?.[1] ?? a.bounds.center[1]))[0];
  const mainWing = rightSide(variant.components, "wing");
  const wingevon = rightSide(variant.components, "wingevon");
  const body = variant.components.find((component) => component.kind === "body" && /fuselage/i.test(component.name))
    ?? variant.components.find((component) => component.kind === "body");
  const tail = rightSide(variant.components, "tailplane");
  const isCruise = variant.airflow?.mode === "cruise";
  const samplePlanes = isCruise
    ? airflowCruiseStationPlanes(variant.components)
    : [
        mainWing ? airflowPlaneForComponent("main_wing_xz", "Main wing section", mainWing) : undefined,
        wingevon ? airflowPlaneForComponent("wingevon_xz", "Wingevon section", wingevon) : undefined,
      ].filter(Boolean);
  return {
    mode: variant.airflow?.mode,
    alphaDeg: refs.alphaDeg ?? 0,
    speedMS: refs.speedMS,
    wingevonControl: variant.wingevonControl,
    components: variant.components.map((component) => ({
      name: component.name,
      kind: component.kind,
      bounds: component.bounds,
      centroid: component.centroid,
      previewTriangles: component.previewTriangles,
    })),
    samplePlanes,
    note: isCruise
      ? "Cruise-speed X-Z slices. Colors show pressure coefficient; arrows show local velocity direction and speed."
      : "Samples U on vertical X-Z slices through the right main wing and right wingevon. Use the solved case to inspect local flow direction and separation cues.",
  };
}

function airflowCruiseStationPlanes(components) {
  const bounds = combinedBounds(components);
  const xPad = Math.max(bounds.size[0] * 0.18, 0.28);
  const zPad = Math.max(bounds.size[2] * 0.8, 0.28);
  const spanMax = Math.max(...components.map((component) => Math.abs(component.bounds.max[1])), 0.1);
  const motor = components
    .filter((component) => component.kind === "motor" || component.kind === "rotor")
    .sort((a, b) => Math.abs(b.bounds.center[1]) - Math.abs(a.bounds.center[1]))[0];
  const wing = components
    .filter((component) => component.kind === "wing" || component.kind === "wingevon")
    .sort((a, b) => Math.abs(b.bounds.max[1]) - Math.abs(a.bounds.max[1]))[0];
  const podY = motor ? Math.abs(motor.bounds.center[1]) : spanMax * 0.58;
  const wingtipY = wing ? Math.abs(wing.bounds.max[1]) * 0.94 : spanMax * 0.92;
  const stationBounds = {
    xMin: round(bounds.min[0] - xPad),
    xMax: round(bounds.max[0] + xPad),
    zMin: round(bounds.min[2] - zPad),
    zMax: round(bounds.max[2] + zPad),
  };
  return [
    airflowPlaneForStation("centreline_xz", "Centreline", 0, stationBounds),
    airflowPlaneForStation("pod_xz", "Pod", podY, stationBounds),
    airflowPlaneForStation("wingtip_xz", "Wingtip", wingtipY, stationBounds),
  ];
}

function combinedBounds(components) {
  const mins = [Infinity, Infinity, Infinity];
  const maxes = [-Infinity, -Infinity, -Infinity];
  for (const component of components) {
    for (let axis = 0; axis < 3; axis += 1) {
      mins[axis] = Math.min(mins[axis], component.bounds.min[axis]);
      maxes[axis] = Math.max(maxes[axis], component.bounds.max[axis]);
    }
  }
  const min = mins.map((value) => Number.isFinite(value) ? value : 0);
  const max = maxes.map((value) => Number.isFinite(value) ? value : 0);
  return {
    min,
    max,
    center: min.map((value, axis) => (value + max[axis]) / 2),
    size: min.map((value, axis) => Math.max(max[axis] - value, 0)),
  };
}

function airflowPlaneForStation(name, label, yM, bounds) {
  return {
    name,
    label,
    point: [round((bounds.xMin + bounds.xMax) / 2), round(yM), round((bounds.zMin + bounds.zMax) / 2)],
    normal: [0, 1, 0],
    sections: [],
    bounds,
  };
}

function airflowPlaneForComponent(name, label, component, options = {}) {
  const bounds = component.bounds;
  const xPad = Math.max(bounds.size[0] * (options.xPadScale ?? 0.75), 0.18);
  const zPad = Math.max(bounds.size[2] * (options.zPadScale ?? 1.2), 0.16);
  return {
    name,
    label,
    point: [round(component.centroid?.[0] ?? bounds.center[0]), round(options.forceY ?? component.centroid?.[1] ?? bounds.center[1]), round(component.centroid?.[2] ?? bounds.center[2])],
    normal: [0, 1, 0],
    sections: [],
    bounds: {
      xMin: round(bounds.min[0] - xPad),
      xMax: round(bounds.max[0] + xPad),
      zMin: round(bounds.min[2] - zPad),
      zMax: round(bounds.max[2] + zPad),
    },
  };
}

function parseAirflowSections(caseDir, airflowAnalysis) {
  const sectionRoot = path.join(caseDir, "postProcessing", "airflowSections");
  const base = {
    ...airflowAnalysis,
    time: undefined,
    plots: airflowAnalysis.samplePlanes.map((plane) => emptyAirflowPlot(plane, airflowAnalysis)),
  };
  if (!fs.existsSync(sectionRoot)) return base;
  const timeDirs = fs.readdirSync(sectionRoot)
    .map((entry) => Number(entry))
    .filter((value) => Number.isFinite(value))
    .sort((a, b) => a - b);
  const time = timeDirs.at(-1);
  if (time === undefined) return base;
  const dir = path.join(sectionRoot, String(time));
  return {
    ...airflowAnalysis,
    time,
    plots: airflowAnalysis.samplePlanes.map((plane) => buildAirflowPlotData(dir, plane, airflowAnalysis)),
  };
}

function emptyAirflowPlot(plane, airflowAnalysis) {
  return {
    plane: plane.name,
    label: plane.label,
    point: plane.point,
    bounds: plane.bounds,
    sections: airframeSectionsForPlane(plane, airflowAnalysis?.components ?? []),
    samples: [],
    scale: { maxSpeedMS: 0, minCp: 0, maxCp: 0 },
  };
}

function estimatedAirflowPlot(plane, airflowAnalysis) {
  const speedMS = airflowAnalysis.speedMS ?? 15;
  const components = airflowAnalysis.components ?? [];
  const samples = [];
  const xSteps = 32;
  const zSteps = 18;
  for (let zi = 0; zi <= zSteps; zi += 1) {
    const z = lerp(plane.bounds.zMin, plane.bounds.zMax, zi / zSteps);
    for (let xi = 0; xi <= xSteps; xi += 1) {
      const x = lerp(plane.bounds.xMin, plane.bounds.xMax, xi / xSteps);
      const influence = airflowInfluenceAt(x, z, plane, components, speedMS);
      samples.push({
        x: round(x),
        z: round(z),
        u: round(influence.u),
        w: round(influence.w),
        speed: round(influence.speed),
        cp: round(influence.cp),
        pressurePa: round(influence.pressurePa),
        estimated: true,
      });
    }
  }
  return {
    plane: plane.name,
    label: plane.label,
    point: plane.point,
    bounds: plane.bounds,
    sections: airframeSectionsForPlane(plane, components),
    samples,
    estimated: true,
    scale: {
      maxSpeedMS: round(Math.max(...samples.map((sample) => sample.speed), speedMS)),
      minCp: round(Math.min(...samples.map((sample) => sample.cp), -1)),
      maxCp: round(Math.max(...samples.map((sample) => sample.cp), 1)),
    },
  };
}

function airframeSectionsForPlane(plane, components) {
  return components
    .filter((component) => ["body", "wing", "wingevon", "tailplane", "fin", "lex"].includes(component.kind))
    .flatMap((component) => {
      const segments = sectionSegmentsForComponent(component, plane);
      if (!segments.length) return [];
      return {
        name: component.name,
        kind: component.kind,
        segments,
      };
    })
    .filter((section) => section.segments.length > 0);
}

function sectionSegmentsForComponent(component, plane) {
  const y = plane.point[1];
  const segments = [];
  for (const tri of component.previewTriangles ?? []) {
    const intersections = trianglePlaneYIntersections(tri, y);
    if (intersections.length < 2) continue;
    const [a, b] = farthestPair(intersections);
    if (!a || !b || Math.hypot(a[0] - b[0], a[1] - b[1]) < 1e-4) continue;
    if (!pointInAirflowBounds(a, plane.bounds) && !pointInAirflowBounds(b, plane.bounds)) continue;
    segments.push([[round(a[0]), round(a[1])], [round(b[0]), round(b[1])]]);
  }
  const step = Math.max(1, Math.ceil(segments.length / 600));
  return segments.filter((_, index) => index % step === 0);
}

function trianglePlaneYIntersections(tri, planeY) {
  const points = [];
  for (let index = 0; index < 3; index += 1) {
    const a = tri[index];
    const b = tri[(index + 1) % 3];
    const ay = a[1] - planeY;
    const by = b[1] - planeY;
    if (Math.abs(ay) < 1e-6) points.push([a[0], a[2]]);
    if (ay * by < 0) {
      const t = (planeY - a[1]) / (b[1] - a[1]);
      points.push([lerp(a[0], b[0], t), lerp(a[2], b[2], t)]);
    } else if (Math.abs(by) < 1e-6) {
      points.push([b[0], b[2]]);
    }
  }
  const unique = [];
  for (const point of points) {
    if (!unique.some((candidate) => Math.hypot(candidate[0] - point[0], candidate[1] - point[1]) < 1e-5)) unique.push(point);
  }
  return unique;
}

function farthestPair(points) {
  let best = [points[0], points[1]];
  let bestDistance = -1;
  for (let a = 0; a < points.length; a += 1) {
    for (let b = a + 1; b < points.length; b += 1) {
      const distance = Math.hypot(points[a][0] - points[b][0], points[a][1] - points[b][1]);
      if (distance > bestDistance) {
        best = [points[a], points[b]];
        bestDistance = distance;
      }
    }
  }
  return best;
}

function pointInAirflowBounds(point, bounds) {
  return point[0] >= bounds.xMin && point[0] <= bounds.xMax && point[1] >= bounds.zMin && point[1] <= bounds.zMax;
}

function airflowInfluenceAt(x, z, plane, components, speedMS) {
  let uFactor = 1;
  let wFactor = 0;
  for (const component of components) {
    const bounds = component.bounds;
    if (!bounds) continue;
    const sideDistance = Math.abs((component.centroid?.[1] ?? bounds.center[1]) - plane.point[1]);
    const sideFalloff = Math.exp(-((sideDistance / Math.max(bounds.size[1] * 0.7, 0.16)) ** 2));
    if (sideFalloff < 0.02 && plane.name !== "centerline_xz") continue;
    const cx = component.centroid?.[0] ?? bounds.center[0];
    const cz = component.centroid?.[2] ?? bounds.center[2];
    const rx = Math.max(bounds.size[0] * 0.55, 0.12);
    const rz = Math.max(bounds.size[2] * (component.kind === "body" ? 1.1 : 4.5), 0.08);
    const dx = (x - cx) / rx;
    const dz = (z - cz) / rz;
    const proximity = Math.exp(-(dx * dx + dz * dz)) * sideFalloff;
    const wake = Math.exp(-Math.max(0, (cx - x) / Math.max(bounds.size[0] * 0.9, 0.18))) * Math.exp(-(dz * dz) * 0.7) * sideFalloff;
    if (["wing", "wingevon", "tailplane"].includes(component.kind)) {
      uFactor += proximity * 0.28;
      uFactor -= wake * 0.12;
      wFactor += proximity * (z >= cz ? 0.16 : -0.08);
      wFactor -= wake * 0.05;
    } else if (component.kind === "body") {
      uFactor += proximity * 0.18;
      uFactor -= wake * 0.18;
      wFactor += proximity * dz * 0.18;
    } else if (component.kind === "rotor") {
      uFactor += proximity * 0.1;
    }
  }
  const u = speedMS * Math.max(uFactor, 0.18);
  const w = speedMS * wFactor;
  const speed = Math.hypot(u, w);
  const cp = 1 - (speed / Math.max(speedMS, 0.1)) ** 2;
  const pressurePa = 0.5 * 1.225 * speedMS * speedMS * cp;
  return { u, w, speed, cp, pressurePa };
}

function buildAirflowPlotData(dir, plane, airflowAnalysis) {
  const filePath = path.join(dir, `${sanitize(plane.name)}.vtp`);
  if (!fs.existsSync(filePath)) return emptyAirflowPlot(plane, airflowAnalysis);
  const points = readVtpFloatArray(filePath, "Points", 3);
  const velocities = readVtpFloatArray(filePath, "U", 3);
  const pressures = readVtpFloatArray(filePath, "p", 1);
  const vorticity = readVtpFloatArray(filePath, "vorticity", 3);
  const samples = [];
  const step = Math.max(1, Math.ceil(points.length / 850));
  for (let index = 0; index < Math.min(points.length, velocities.length); index += step) {
    const point = points[index];
    const velocity = velocities[index];
    if (point[0] < plane.bounds.xMin || point[0] > plane.bounds.xMax || point[2] < plane.bounds.zMin || point[2] > plane.bounds.zMax) continue;
    samples.push({
      x: round(point[0]),
      z: round(point[2]),
      u: round(velocity[0]),
      w: round(velocity[2]),
      speed: round(mag(velocity)),
      omegaY: round(vorticity[index]?.[1] ?? 0),
      pressurePa: round(pressures[index]?.[0] ?? 0),
    });
  }
  const maxSpeed = Math.max(...samples.map((sample) => sample.speed), 0);
  for (const sample of samples) sample.cp = round(maxSpeed > 0 ? 1 - (sample.speed / maxSpeed) ** 2 : 0);
  return {
    plane: plane.name,
    label: plane.label,
    point: plane.point,
    bounds: plane.bounds,
    sections: airframeSectionsForPlane(plane, airflowAnalysis?.components ?? []),
    samples,
    scale: {
      maxSpeedMS: round(Math.max(...samples.map((sample) => sample.speed), 0)),
      minCp: round(Math.min(...samples.map((sample) => sample.cp), -1)),
      maxCp: round(Math.max(...samples.map((sample) => sample.cp), 1)),
    },
  };
}

function buildVortexPlotData(dir, propSwirlAnalysis, planeName = "after_prop_yz") {
  const plane = propSwirlAnalysis.samplePlanes.find((entry) => entry.name === planeName) ?? propSwirlAnalysis.samplePlanes.find((entry) => entry.name === "after_prop_yz") ?? propSwirlAnalysis.samplePlanes.at(-1);
  if (!plane) return undefined;
  const filePath = path.join(dir, `${sanitize(plane.name)}.vtp`);
  if (!fs.existsSync(filePath)) return undefined;
  const points = readVtpFloatArray(filePath, "Points", 3);
  const vorticity = readVtpFloatArray(filePath, "vorticity", 3);
  const samples = [];
  const rotorRadius = Math.max(...propSwirlAnalysis.rotors.map((rotor) => rotor.radiusM), 0.1);
  const yMin = Math.min(...propSwirlAnalysis.rotors.map((rotor) => rotor.center[1] - rotor.radiusM * 1.18));
  const yMax = Math.max(...propSwirlAnalysis.rotors.map((rotor) => rotor.center[1] + rotor.radiusM * 1.18));
  const zMin = Math.min(...propSwirlAnalysis.rotors.map((rotor) => rotor.center[2] - rotor.radiusM * 1.18));
  const zMax = Math.max(...propSwirlAnalysis.rotors.map((rotor) => rotor.center[2] + rotor.radiusM * 1.18));
  const step = Math.max(1, Math.ceil(points.length / 700));
  for (let index = 0; index < Math.min(points.length, vorticity.length); index += step) {
    const point = points[index];
    if (point[1] < yMin || point[1] > yMax || point[2] < zMin || point[2] > zMax) continue;
    samples.push({
      y: round(point[1]),
      z: round(point[2]),
      omegaX: round(vorticity[index][0]),
    });
  }
  return {
    plane: plane.name,
    point: plane.point,
    field: "omega.x",
    bounds: { yMin: round(yMin), yMax: round(yMax), zMin: round(zMin), zMax: round(zMax) },
    rotors: propSwirlAnalysis.rotors.map((rotor) => ({
      side: rotor.side,
      centerY: rotor.center[1],
      centerZ: rotor.center[2],
      radiusM: rotor.radiusM,
      expectedOmegaXSign: rotor.expectedOmegaXSign,
    })),
    samples,
    scale: {
      maxAbsOmegaX: round(Math.max(...samples.map((sample) => Math.abs(sample.omegaX)), 1)),
      rotorRadiusM: round(rotorRadius),
    },
  };
}

function summarizeVorticitySection(filePath, rotors) {
  const points = readVtpFloatArray(filePath, "Points", 3);
  const vorticity = readVtpFloatArray(filePath, "vorticity", 3);
  const buckets = {};
  for (const rotor of rotors) buckets[rotor.side] = [];
  for (let index = 0; index < Math.min(points.length, vorticity.length); index += 1) {
    const point = points[index];
    const omega = vorticity[index];
    for (const rotor of rotors) {
      const dy = point[1] - rotor.center[1];
      const dz = point[2] - rotor.center[2];
      if (Math.hypot(dy, dz) <= rotor.radiusM * 0.95) buckets[rotor.side].push(omega[0]);
    }
  }
  return Object.fromEntries(Object.entries(buckets).map(([side, values]) => [side, summarizeOmega(values)]));
}

function summarizeOmega(values) {
  const finite = values.filter(Number.isFinite);
  const meanOmegaX = finite.length ? sum(finite) / finite.length : 0;
  return {
    samples: finite.length,
    meanOmegaX: round(meanOmegaX),
    absMeanOmegaX: round(finite.length ? sum(finite.map((value) => Math.abs(value))) / finite.length : 0),
    positiveSamples: finite.filter((value) => value > 0).length,
    negativeSamples: finite.filter((value) => value < 0).length,
    sign: signOf(meanOmegaX),
  };
}

function readVtpFloatArray(filePath, name, components) {
  const text = fs.readFileSync(filePath, "utf8");
  const match = text.match(new RegExp(`<DataArray[^>]*Name=['"]${name}['"][^>]*>([\\s\\S]*?)<\\/DataArray>`));
  if (!match) return [];
  const buffer = Buffer.from(match[1].replace(/\s+/g, ""), "base64");
  if (buffer.length < 8) return [];
  const byteLength = Number(buffer.readBigUInt64LE(0));
  const data = buffer.subarray(8, 8 + byteLength);
  const values = [];
  for (let offset = 0; offset + components * 4 <= data.length; offset += components * 4) {
    const tuple = [];
    for (let component = 0; component < components; component += 1) tuple.push(data.readFloatLE(offset + component * 4));
    values.push(tuple);
  }
  return values;
}

function signOf(value) {
  if (!Number.isFinite(value) || Math.abs(value) < 1e-9) return 0;
  return value > 0 ? 1 : -1;
}

function writeFoamCase(caseDir, variant, bounds, refs, propSwirlAnalysis, airflowAnalysis) {
  const pad = Math.max(bounds.size[0], bounds.size[1], bounds.size[2], 1);
  const min = [bounds.min[0] - pad * 4, bounds.min[1] - pad * 3, bounds.min[2] - pad * 3];
  const max = [bounds.max[0] + pad * 6, bounds.max[1] + pad * 3, bounds.max[2] + pad * 3];
  fs.writeFileSync(path.join(caseDir, "system", "blockMeshDict"), blockMeshDict(min, max));
  fs.writeFileSync(path.join(caseDir, "system", "controlDict"), controlDict(refs, variant.components, propSwirlAnalysis, airflowAnalysis));
  fs.writeFileSync(path.join(caseDir, "system", "fvSchemes"), fvSchemes());
  fs.writeFileSync(path.join(caseDir, "system", "fvSolution"), fvSolution());
  fs.writeFileSync(path.join(caseDir, "system", "snappyHexMeshDict"), snappyHexMeshDict(variant.components));
  fs.writeFileSync(path.join(caseDir, "system", "surfaceFeatureExtractDict"), surfaceFeatureExtractDict(variant.components));
  if (propSwirlAnalysis) {
    fs.writeFileSync(path.join(caseDir, "system", "topoSetDict"), topoSetDict(propSwirlAnalysis.rotors));
    fs.writeFileSync(path.join(caseDir, "system", "fvOptions"), fvOptions(propSwirlAnalysis));
  }
  fs.writeFileSync(path.join(caseDir, "constant", "transportProperties"), transportProperties());
  fs.writeFileSync(path.join(caseDir, "constant", "turbulenceProperties"), turbulenceProperties());
  fs.writeFileSync(path.join(caseDir, "0", "U"), initialU(refs));
  fs.writeFileSync(path.join(caseDir, "0", "p"), initialP());
  fs.writeFileSync(path.join(caseDir, "0", "k"), initialK(refs.speedMS));
  fs.writeFileSync(path.join(caseDir, "0", "omega"), initialOmega());
  fs.writeFileSync(path.join(caseDir, "0", "nut"), initialNut());
}

function analyzePropSwirl(variant, refs) {
  const rotorComponents = variant.components.filter((component) => component.kind === "rotor");
  const lexComponents = variant.components.filter((component) => component.kind === "lex");
  const physicalRotors = mirroredRotorSources(rotorComponents);
  const mode = variant.propSwirl.mode;
  const modeId = mode.replace(/[^a-zA-Z0-9_]+/g, "_");
  const rotors = physicalRotors.map((rotor) => {
    const side = rotor.center[1] >= 0 ? "right" : "left";
    const streamwiseVorticitySign =
      mode === "bottoms-in"
        ? (side === "right" ? -1 : 1)
        : (side === "right" ? 1 : -1);
    const zoneName = sanitize(`${side}_${modeId}_prop_swirl_zone`);
    return {
      ...rotor,
      side,
      zoneName,
      setName: sanitize(`${side}_${modeId}_prop_swirl_set`),
      streamwiseVorticitySign,
      expectedOmegaXSign: streamwiseVorticitySign,
      swirlAccelerationMS2: round(Math.max(refs.speedMS * refs.speedMS / Math.max(rotor.radiusM, 0.05) * 0.18, 1)),
    };
  });
  const right = rotors.find((rotor) => rotor.side === "right");
  const left = rotors.find((rotor) => rotor.side === "left");
  const lexMinX = Math.min(...lexComponents.map((component) => component.bounds.min[0]), refs.centerOfRotation[0]);
  const rotorX = right?.center[0] ?? refs.centerOfRotation[0];
  const rotorRadius = right?.radiusM ?? refs.spanM / 4;
  const tailComponents = variant.components.filter((component) => component.kind === "tailplane" || component.kind === "fin");
  const tailPlaneX = tailComponents.length
    ? Math.max(...tailComponents.map((component) => component.bounds.max[0]))
    : rotorX - rotorRadius * 1.6;
  const samplePlanes = [
    {
      name: "after_lex_yz",
      point: [round(lexMinX - 0.05), 0, refs.centerOfRotation[2]],
      normal: [1, 0, 0],
      fieldToCompare: "vorticity.x",
    },
    {
      name: "after_prop_yz",
      point: [round(rotorX - rotorRadius * 0.35), 0, right?.center[2] ?? refs.centerOfRotation[2]],
      normal: [1, 0, 0],
      fieldToCompare: "vorticity.x",
    },
    {
      name: "tail_impact_yz",
      point: [round(tailPlaneX), 0, right?.center[2] ?? refs.centerOfRotation[2]],
      normal: [1, 0, 0],
      fieldToCompare: "vorticity.x",
    },
  ];
  const lexVortexExpectation = {
    rightOmegaXSign: -1,
    leftOmegaXSign: 1,
    coordinateNote: "Signs are omega.x in Cadex/OpenFOAM coordinates with nose-to-tail freestream along -X.",
  };
  const coRotatesWithLex =
    right?.expectedOmegaXSign === lexVortexExpectation.rightOmegaXSign &&
    left?.expectedOmegaXSign === lexVortexExpectation.leftOmegaXSign;
  return {
    mode,
    model: "tangential actuator-source approximation",
    note: "This prepares an OpenFOAM source-term swirl comparison. It is not a resolved blade model.",
    rotors,
    samplePlanes,
    lexVortexExpectation,
    expectedResult: coRotatesWithLex
      ? "prop swirl co-rotates with the expected LEX vortex sign"
      : "prop swirl counter-rotates against the expected LEX vortex sign",
  };
}

function mirroredRotorSources(rotorComponents) {
  const explicit = rotorComponents.map((component) => rotorSourceFromComponent(component)).filter(Boolean);
  if (explicit.length > 1) return explicit;
  const source = explicit[0];
  if (!source) return [];
  if (Math.abs(source.center[1]) < 1e-6) return [source];
  return [
    source.center[1] < 0 ? source : { ...source, name: `${source.name}_left`, center: [source.center[0], -source.center[1], source.center[2]] },
    source.center[1] >= 0 ? source : { ...source, name: `${source.name}_right`, center: [source.center[0], -source.center[1], source.center[2]] },
  ];
}

function rotorSourceFromComponent(component) {
  const geom = component.sourceGeometry;
  const radiusM = geom?.radiusM ?? Math.max(component.bounds.size[1], component.bounds.size[2]) / 2;
  const center = component.centroid ?? component.bounds.center ?? geom?.centerM;
  if (!Array.isArray(center) || !Number.isFinite(radiusM) || radiusM <= 0) return undefined;
  return {
    name: component.name,
    center: center.map(round),
    radiusM: round(radiusM),
    diskThicknessM: round(Math.max(radiusM * 0.04, 0.01)),
    actuatorLengthM: round(Math.max(radiusM * 0.45, 0.2)),
    axis: [-1, 0, 0],
  };
}

function verifyGeometry(sizing, components) {
  const expected = ["body", "wing", "wingevon", "tailplane", "fin", "lex", "rotor"];
  const present = new Set(components.map((component) => component.kind));
  const missing = expected.filter((kind) => !present.has(kind));
  const bad = components.filter((component) => component.triangles < 4 || component.areaM2 <= 0 || !Number.isFinite(component.centroid[0]));
  const bounds = mergeBounds(components.map((component) => component.bounds));
  return {
    ok: missing.length === 0 && bad.length === 0,
    componentCount: components.length,
    missing,
    warnings: [
      ...missing.map((kind) => `No exported ${kind} component found.`),
      ...bad.map((component) => `${component.name} has invalid mesh metrics.`),
    ],
    bounds,
    components: components.map((component) => ({
      name: component.name,
      kind: component.kind,
      triangles: component.triangles,
      areaM2: round(component.areaM2),
      bounds: component.bounds,
      centroid: component.centroid.map(round),
    })),
    sourceShapeCount: sizing.shapes.length,
  };
}

function runOpenFoam(command, caseDir) {
  const args = command.split(/\s+/);
  const executable = path.resolve("scripts/openfoam-docker");
  const containerCaseDir = `/work/${path.relative(process.cwd(), caseDir).replaceAll(path.sep, "/")}`;
  const result = spawnSync(executable, [...args, "-case", containerCaseDir], { encoding: "utf8", maxBuffer: 20 * 1024 * 1024 });
  return { command, ok: result.status === 0, status: result.status, stdout: tail(result.stdout), stderr: tail(result.stderr) };
}

function blockMeshDict(min, max) {
  const [x0, y0, z0] = min;
  const [x1, y1, z1] = max;
  return foamHeader("dictionary", "blockMeshDict") + `
convertToMeters 1;
vertices
(
    (${x0} ${y0} ${z0}) (${x1} ${y0} ${z0}) (${x1} ${y1} ${z0}) (${x0} ${y1} ${z0})
    (${x0} ${y0} ${z1}) (${x1} ${y0} ${z1}) (${x1} ${y1} ${z1}) (${x0} ${y1} ${z1})
);
blocks (hex (0 1 2 3 4 5 6 7) (36 28 24) simpleGrading (1 1 1));
edges ();
boundary
(
    outlet { type patch; faces ((0 4 7 3)); }
    inlet { type patch; faces ((1 2 6 5)); }
    farfield { type patch; faces ((0 1 5 4) (3 7 6 2) (0 3 2 1) (4 5 6 7)); }
);
mergePatchPairs ();
`;
}

function snappyHexMeshDict(components) {
  const geometry = components.map((c) => `    ${c.fileName} { type triSurfaceMesh; name ${sanitize(c.name)}; }`).join("\n");
  const refinement = components.map((c) => `        ${sanitize(c.name)} { level (2 3); patchInfo { type wall; } }`).join("\n");
  return foamHeader("dictionary", "snappyHexMeshDict") + `
castellatedMesh true;
snap true;
addLayers false;
geometry
{
${geometry}
}
castellatedMeshControls
{
    maxLocalCells 300000;
    maxGlobalCells 1200000;
    minRefinementCells 0;
    nCellsBetweenLevels 3;
    features ();
    refinementSurfaces
    {
${refinement}
    }
    resolveFeatureAngle 25;
    refinementRegions {}
    locationInMesh (4 0 1);
    allowFreeStandingZoneFaces true;
}
snapControls
{
    nSmoothPatch 3;
    tolerance 2.0;
    nSolveIter 30;
    nRelaxIter 5;
}
addLayersControls { relativeSizes true; layers {}; expansionRatio 1.2; finalLayerThickness 0.3; minThickness 0.1; }
meshQualityControls { maxNonOrtho 70; maxBoundarySkewness 20; maxInternalSkewness 4; maxConcave 80; minVol 1e-13; minTetQuality 1e-15; minArea -1; minTwist 0.02; minDeterminant 0.001; minFaceWeight 0.02; minVolRatio 0.01; minTriangleTwist -1; nSmoothScale 4; errorReduction 0.75; }
writeFlags (scalarLevels layerSets layerFields);
mergeTolerance 1e-6;
`;
}

function surfaceFeatureExtractDict(components) {
  return foamHeader("dictionary", "surfaceFeatureExtractDict") + components.map((c) => `
${c.fileName}
{
    extractionMethod extractFromSurface;
    extractFromSurfaceCoeffs { includedAngle 150; }
    writeObj no;
}
`).join("\n");
}

function controlDict(refs, components, propSwirlAnalysis, airflowAnalysis) {
  const alpha = (refs.alphaDeg ?? 0) * Math.PI / 180;
  const dragDir = [round(-Math.cos(alpha)), 0, round(-Math.sin(alpha))];
  const liftDir = [round(-Math.sin(alpha)), 0, round(Math.cos(alpha))];
  const forceSets = [
    { name: "forceCoeffs", components },
    { name: "forceCoeffsWing", components: components.filter((component) => component.kind === "wing" || component.kind === "wingevon") },
    { name: "forceCoeffsWingevon", components: components.filter((component) => component.kind === "wingevon") },
    { name: "forceCoeffsBody", components: components.filter((component) => component.kind === "body") },
    { name: "forceCoeffsLex", components: components.filter((component) => component.kind === "lex") },
  ].filter((entry) => entry.components.length > 0);
  return foamHeader("dictionary", "controlDict") + `
application simpleFoam;
startFrom startTime;
startTime 0;
stopAt endTime;
endTime 350;
deltaT 1;
writeControl timeStep;
writeInterval 100;
purgeWrite 0;
writeFormat ascii;
writePrecision 6;
writeCompression off;
timeFormat general;
timePrecision 6;
runTimeModifiable true;
functions
{
${forceSets.map((entry) => forceCoeffsBlock(entry.name, entry.components, refs, liftDir, dragDir)).join("\n")}
${propSwirlAnalysis || airflowAnalysis ? vorticityBlock() : ""}
${propSwirlAnalysis ? vorticityAndSampleBlocks(propSwirlAnalysis) : ""}
${airflowAnalysis ? airflowSampleBlocks(airflowAnalysis) : ""}
}
`;
}

function forceCoeffsBlock(name, components, refs, liftDir, dragDir) {
  const patches = `(${components.map((component) => sanitize(component.name)).join(" ")})`;
  return `    ${name}
    {
        type forceCoeffs;
        libs (forces);
        patches ${patches};
        rho rhoInf;
        rhoInf 1.225;
        CofR (${refs.centerOfRotation.join(" ")});
        liftDir (${liftDir.join(" ")});
        dragDir (${dragDir.join(" ")});
        pitchAxis (0 1 0);
        magUInf ${refs.speedMS};
        lRef ${refs.meanChordM};
        Aref ${refs.referenceAreaM2};
    }`;
}

function vorticityBlock() {
  return `
    vorticity
    {
        type vorticity;
        libs (fieldFunctionObjects);
        field U;
        executeControl writeTime;
        writeControl writeTime;
    }`;
}

function vorticityAndSampleBlocks(propSwirlAnalysis) {
  return `
    vortexSections
    {
        type surfaces;
        libs (sampling);
        fields (U vorticity);
        interpolationScheme cellPoint;
        surfaceFormat vtk;
        writeControl writeTime;
        surfaces
        {
${propSwirlAnalysis.samplePlanes.map((plane) => `            ${sanitize(plane.name)}
            {
                type cuttingPlane;
                planeType pointAndNormal;
                pointAndNormalDict
                {
                    point (${plane.point.join(" ")});
                    normal (${plane.normal.join(" ")});
                }
                interpolate true;
            }`).join("\n")}
        }
    }`;
}

function airflowSampleBlocks(airflowAnalysis) {
  return `
    airflowSections
    {
        type surfaces;
        libs (sampling);
        fields (U p vorticity);
        interpolationScheme cellPoint;
        surfaceFormat vtk;
        writeControl writeTime;
        surfaces
        {
${airflowAnalysis.samplePlanes.map((plane) => `            ${sanitize(plane.name)}
            {
                type cuttingPlane;
                planeType pointAndNormal;
                pointAndNormalDict
                {
                    point (${plane.point.join(" ")});
                    normal (${plane.normal.join(" ")});
                }
                interpolate true;
            }`).join("\n")}
        }
    }`;
}

function topoSetDict(rotors) {
  return foamHeader("dictionary", "topoSetDict") + `
actions
(
${rotors.map((rotor) => {
  const p1 = [round(rotor.center[0] - rotor.actuatorLengthM / 2), rotor.center[1], rotor.center[2]];
  const p2 = [round(rotor.center[0] + rotor.actuatorLengthM / 2), rotor.center[1], rotor.center[2]];
  return `    {
        name ${rotor.setName};
        type cellSet;
        action new;
        source cylinderToCell;
        sourceInfo
        {
            p1 (${p1.join(" ")});
            p2 (${p2.join(" ")});
            radius ${rotor.radiusM};
        }
    }
    {
        name ${rotor.zoneName};
        type cellZoneSet;
        action new;
        source setToCellZone;
        sourceInfo
        {
            set ${rotor.setName};
        }
    }`;
}).join("\n")}
);
`;
}

function fvOptions(propSwirlAnalysis) {
  return foamHeader("dictionary", "fvOptions") + `
${propSwirlAnalysis.rotors.map((rotor) => codedSwirlSource(rotor)).join("\n")}
`;
}

function codedSwirlSource(rotor) {
  return `${sanitize(rotor.zoneName)}Source
{
    type vectorCodedSource;
    active true;
    selectionMode cellZone;
    cellZone ${rotor.zoneName};
    fields (U);
    name ${sanitize(rotor.zoneName)}Source;
    codeInclude
    #{
        #include "fvCFD.H"
    #};
    codeAddSup
    #{
        const vector origin(${rotor.center.join(", ")});
        const scalar sign = ${rotor.streamwiseVorticitySign};
        const scalar accel = ${rotor.swirlAccelerationMS2};
        vectorField& Su = eqn.source();
        const scalarField& V = mesh_.V();
        const vectorField& C = mesh_.C();
        forAll(cells_, i)
        {
            const label celli = cells_[i];
            const vector r = C[celli] - origin;
            vector tangent(0, -r.z(), r.y());
            const scalar tangentMag = max(mag(tangent), SMALL);
            Su[celli] += sign * accel * (tangent / tangentMag) * V[celli];
        }
    #};
    codeCorrect #{ #};
    codeConstrain #{ #};
}
`;
}

function fvSchemes() {
  return foamHeader("dictionary", "fvSchemes") + `
ddtSchemes { default steadyState; }
gradSchemes { default Gauss linear; }
divSchemes
{
    default none;
    div(phi,U) bounded Gauss upwind;
    div(phi,k) bounded Gauss upwind;
    div(phi,omega) bounded Gauss upwind;
    div((nuEff*dev2(T(grad(U))))) Gauss linear;
}
laplacianSchemes { default Gauss linear corrected; }
interpolationSchemes { default linear; }
snGradSchemes { default corrected; }
wallDist { method meshWave; }
`;
}

function fvSolution() {
  return foamHeader("dictionary", "fvSolution") + `
solvers
{
    p { solver GAMG; tolerance 1e-7; relTol 0.05; smoother GaussSeidel; }
    U { solver smoothSolver; smoother symGaussSeidel; tolerance 1e-8; relTol 0.1; }
    "(k|omega)" { solver smoothSolver; smoother symGaussSeidel; tolerance 1e-8; relTol 0.1; }
}
SIMPLE { nNonOrthogonalCorrectors 0; consistent yes; residualControl { p 1e-4; U 1e-5; "(k|omega)" 1e-5; } }
relaxationFactors { equations { U 0.7; k 0.7; omega 0.7; } }
`;
}

function transportProperties() {
  return foamHeader("dictionary", "transportProperties") + "transportModel Newtonian;\nnu [0 2 -1 0 0 0 0] 1.5e-05;\n";
}

function turbulenceProperties() {
  return foamHeader("dictionary", "turbulenceProperties") + "simulationType RAS;\nRAS { model kOmegaSST; turbulence on; printCoeffs on; }\n";
}

function initialU(refs) {
  const alpha = (refs.alphaDeg ?? 0) * Math.PI / 180;
  const value = `(${round(-refs.speedMS * Math.cos(alpha))} 0 ${round(-refs.speedMS * Math.sin(alpha))})`;
  return volField("volVectorField", "U", `[0 1 -1 0 0 0 0]`, value, "fixedValue", value, "noSlip", "(0 0 0)");
}
function initialP() {
  return volField("volScalarField", "p", `[0 2 -2 0 0 0 0]`, "0", "zeroGradient", "0", "zeroGradient", "0");
}
function initialK(speed) {
  return volField("volScalarField", "k", `[0 2 -2 0 0 0 0]`, String(Math.max(1.5 * (speed * 0.01) ** 2, 1e-6)), "fixedValue", "1e-4", "kqRWallFunction", "1e-4");
}
function initialOmega() {
  return volField("volScalarField", "omega", `[0 0 -1 0 0 0 0]`, "10", "fixedValue", "10", "omegaWallFunction", "10");
}
function initialNut() {
  return volField("volScalarField", "nut", `[0 2 -1 0 0 0 0]`, "0", "calculated", "0", "nutkWallFunction", "0");
}

function volField(cls, object, dimensions, internal, farfieldType, farfieldValue, wallType, wallValue) {
  return foamHeader(cls, object) + `
dimensions ${dimensions};
internalField uniform ${internal};
boundaryField
{
    inlet { type fixedValue; value uniform ${farfieldValue}; }
    outlet { type zeroGradient; }
    farfield { type ${farfieldType}; value uniform ${farfieldValue}; }
    ".*" { type ${wallType}; value uniform ${wallValue}; }
}
`;
}

function referenceValues(sizing, variant) {
  const components = variant.components;
  const wingComponents = components.filter((component) => component.kind === "wing" || component.kind === "wingevon");
  const bounds = mergeBounds((wingComponents.length ? wingComponents : components).map((component) => component.bounds));
  const referenceAreaM2 = Math.max(sum(wingComponents.map((component) => component.areaM2)) / 2, 0.01);
  const spanM = Math.max(bounds.size[1], 0.01);
  const meanChordM = Math.max(referenceAreaM2 / spanM, 0.01);
  return {
    speedMS: Math.max(sizing.mission?.cruiseSpeedMS ?? 15, 0.1),
    alphaDeg: variant.alphaDeg ?? 0,
    referenceAreaM2,
    spanM,
    meanChordM,
    centerOfRotation: [bounds.center[0], bounds.center[1], bounds.center[2]],
  };
}

function nacaAirfoil(name, count) {
  const digits = String(name).match(/(\d{4})/)?.[1] ?? "0012";
  const t = Number(digits.slice(2)) / 100;
  const samples = [];
  for (let i = 0; i < count; i += 1) {
    const beta = (i / (count - 1)) * Math.PI;
    const x = (1 - Math.cos(beta)) / 2;
    const yt = 5 * t * (0.2969 * Math.sqrt(x) - 0.126 * x - 0.3516 * x ** 2 + 0.2843 * x ** 3 - 0.1015 * x ** 4);
    samples.push({ x, yt });
  }
  return samples;
}

function stl(name, triangles) {
  const lines = [`solid ${name}`];
  for (const tri of triangles) {
    const n = normal(tri);
    lines.push(`  facet normal ${n[0]} ${n[1]} ${n[2]}`, "    outer loop");
    for (const p of tri) lines.push(`      vertex ${p[0]} ${p[1]} ${p[2]}`);
    lines.push("    endloop", "  endfacet");
  }
  lines.push(`endsolid ${name}`, "");
  return lines.join("\n");
}

function foamHeader(cls, object) {
  return `FoamFile\n{\n    version 2.0;\n    format ascii;\n    class ${cls};\n    object ${object};\n}\n`;
}

function componentName(shape) {
  const kind = shape.liftingSurfaceKind ?? shape.partType ?? shape.role;
  return `${kind}_${shape.label ?? shape.id}`;
}
function normalizeMovementControls(value) {
  if (!Array.isArray(value)) return [];
  return value
    .filter((control) => control && typeof control === "object" && typeof control.componentName === "string")
    .map((control) => ({
      componentName: control.componentName,
      componentKind: typeof control.componentKind === "string" ? control.componentKind : "unknown",
      label: typeof control.label === "string" ? control.label : undefined,
      axis: ["span-hinge", "vertical-hinge", "chord-hinge"].includes(control.axis) ? control.axis : "span-hinge",
      deflectionDeg: clampNumber(control.deflectionDeg, 0, -90, 90),
      minDeg: clampNumber(control.minDeg, -25, -90, 90),
      maxDeg: clampNumber(control.maxDeg, 25, -90, 90),
      neutralDeg: clampNumber(control.neutralDeg, 0, -90, 90),
      hingeChordFraction: clampNumber(control.hingeChordFraction, 0.25, 0, 1),
      hingeSpanFraction: clampNumber(control.hingeSpanFraction, 0.5, 0, 1),
      hingeVerticalFraction: clampNumber(control.hingeVerticalFraction, 0.5, 0, 1),
      enabled: control.enabled !== false,
    }));
}
function normalizeSurfaceCaptures(value) {
  if (!Array.isArray(value)) return [];
  return value
    .filter((capture) => capture && typeof capture === "object")
    .map((capture, index) => ({
      id: typeof capture.id === "string" && capture.id.trim() ? capture.id : `surface-${index + 1}`,
      title: typeof capture.title === "string" && capture.title.trim() ? capture.title.trim() : `Surface setup ${index + 1}`,
      geometryFingerprint: typeof capture.geometryFingerprint === "string" ? capture.geometryFingerprint : undefined,
      createdAt: Number.isFinite(capture.createdAt) ? capture.createdAt : Date.now(),
      componentCount: Number.isFinite(capture.componentCount) ? capture.componentCount : undefined,
      movementControls: normalizeMovementControls(capture.movementControls),
    }));
}
function clampNumber(value, fallback, min, max) {
  return Number.isFinite(value) ? Math.min(Math.max(Number(value), min), max) : fallback;
}
function sanitize(value) {
  return String(value || "cadex").replace(/[^a-zA-Z0-9_.-]+/g, "_").replace(/^_+|_+$/g, "") || "cadex";
}
function dihedralDeg(shape, geom) {
  if (typeof shape.dihedralLiftM !== "number") return 0;
  return Math.atan2(shape.dihedralLiftM, Math.max(geom.spanM / 2, 0.01)) * 180 / Math.PI;
}
function rotateIncidence(point, origin, degrees, vertical = false) {
  const angle = degrees * Math.PI / 180;
  const x = point[0] - origin[0];
  const z = point[2] - origin[2];
  const xr = x * Math.cos(angle) + z * Math.sin(angle);
  const zr = -x * Math.sin(angle) + z * Math.cos(angle);
  if (vertical) return [origin[0] + xr, point[1] + z, origin[2] + zr];
  return [origin[0] + xr, point[1], origin[2] + zr];
}
function stitchGrid(triangles, grid, flip) {
  for (let i = 0; i < grid.length - 1; i += 1) {
    for (let j = 0; j < grid[i].length - 1; j += 1) {
      const a = grid[i][j], b = grid[i + 1][j], c = grid[i + 1][j + 1], d = grid[i][j + 1];
      triangles.push(flip ? [a, c, b] : [a, b, c], flip ? [a, d, c] : [a, c, d]);
    }
  }
}
function capSection(triangles, upper, lower, flip) {
  for (let j = 0; j < upper.length - 1; j += 1) {
    const a = upper[j], b = upper[j + 1], c = lower[j + 1], d = lower[j];
    triangles.push(flip ? [a, c, b] : [a, b, c], flip ? [a, d, c] : [a, c, d]);
  }
}
function capSpanEdge(triangles, upper, lower, chordIndex, flip) {
  for (let i = 0; i < upper.length - 1; i += 1) {
    const a = upper[i][chordIndex], b = upper[i + 1][chordIndex], c = lower[i + 1][chordIndex], d = lower[i][chordIndex];
    pushTriangleIfValid(triangles, flip ? [a, c, b] : [a, b, c]);
    pushTriangleIfValid(triangles, flip ? [a, d, c] : [a, c, d]);
  }
}
function pushTriangleIfValid(triangles, tri) {
  if (mag(cross(sub(tri[1], tri[0]), sub(tri[2], tri[0]))) > 1e-12) triangles.push(tri);
}
function normal(tri) {
  return normalize(cross(sub(tri[1], tri[0]), sub(tri[2], tri[0])));
}
function surfaceArea(triangles) {
  return sum(triangles.map((tri) => mag(cross(sub(tri[1], tri[0]), sub(tri[2], tri[0]))) / 2));
}
function boundsFor(points) {
  const min = [0, 1, 2].map((i) => Math.min(...points.map((p) => p[i])));
  const max = [0, 1, 2].map((i) => Math.max(...points.map((p) => p[i])));
  return { min: min.map(round), max: max.map(round), size: max.map((v, i) => round(v - min[i])), center: max.map((v, i) => round((v + min[i]) / 2)) };
}
function mergeBounds(bounds) {
  const min = [0, 1, 2].map((i) => Math.min(...bounds.map((b) => b.min[i])));
  const max = [0, 1, 2].map((i) => Math.max(...bounds.map((b) => b.max[i])));
  return { min: min.map(round), max: max.map(round), size: max.map((v, i) => round(v - min[i])), center: max.map((v, i) => round((v + min[i]) / 2)) };
}
function centroidFor(triangles) {
  const pts = triangles.flatMap((tri) => tri);
  return [0, 1, 2].map((i) => sum(pts.map((p) => p[i])) / pts.length);
}
function round(v) {
  return Math.round(v * 1e6) / 1e6;
}
function sum(values) {
  return values.reduce((a, b) => a + b, 0);
}
function lerp(a, b, t) {
  return a + (b - a) * t;
}
function add(a, b) {
  return a.map((v, i) => v + b[i]);
}
function sub(a, b) {
  return a.map((v, i) => v - b[i]);
}
function scale(a, s) {
  return a.map((v) => v * s);
}
function cross(a, b) {
  return [a[1] * b[2] - a[2] * b[1], a[2] * b[0] - a[0] * b[2], a[0] * b[1] - a[1] * b[0]];
}
function mag(a) {
  return Math.sqrt(sum(a.map((v) => v * v)));
}
function normalize(a) {
  const m = Math.max(mag(a), 1e-12);
  return a.map((v) => v / m);
}
function basis(dir) {
  const seed = Math.abs(dir[2]) < 0.9 ? [0, 0, 1] : [0, 1, 0];
  const u = normalize(cross(dir, seed));
  return [u, normalize(cross(dir, u))];
}
function tail(text) {
  return String(text ?? "").split("\n").slice(-80).join("\n");
}
function fail(message) {
  const report = { ok: false, solver: "OpenFOAM", message };
  if (jsonOnly) {
    process.stdout.write(JSON.stringify(report, null, 2));
    process.exit(0);
  }
  throw new Error(message);
}
