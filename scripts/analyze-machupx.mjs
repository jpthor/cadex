#!/usr/bin/env node
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { spawnSync } from "node:child_process";

let auditedEngine;
try {
  auditedEngine = await import("../src/sizing/auditedSizingEngine.ts");
} catch {
  auditedEngine = undefined;
}

const aircraftPath = path.resolve(process.argv[2] ?? "aircraft/dartv1/aircraft.json");
const outDir = path.resolve(process.argv[3] ?? "exports/machupx");
const jsonOnly = process.argv.includes("--json-only");

const aircraft = JSON.parse(fs.readFileSync(aircraftPath, "utf8"));
const sizing = aircraft.sizing;
if (!sizing?.shapes?.length) fail("No sizing sketch found.");

fs.mkdirSync(outDir, { recursive: true });

const generated = buildMachUpXInput(aircraft.name ?? aircraft.project?.name ?? "CadexAircraft", sizing);
const stem = sanitize(aircraft.name ?? aircraft.project?.name ?? "cadex_aircraft");
const scenePath = path.join(outDir, `${stem}_machupx_scene.json`);
const aircraftMxPath = path.join(outDir, `${stem}_machupx_aircraft.json`);
const reportPath = path.join(outDir, `${stem}_machupx_report.json`);
generated.scene.scene.aircraft.cadex.file = aircraftMxPath;
fs.writeFileSync(scenePath, JSON.stringify(generated.scene, null, 2));
fs.writeFileSync(aircraftMxPath, JSON.stringify(generated.aircraft, null, 2));

const python = process.env.MACHUPX_PYTHON || "python3";
const run = spawnSync(python, [path.join(path.dirname(new URL(import.meta.url).pathname), "run-machupx.py"), scenePath, String(generated.targetCL)], {
  cwd: process.cwd(),
  encoding: "utf8",
  maxBuffer: 10 * 1024 * 1024,
});

const report = {
  ok: run.status === 0,
  solver: "MachUpX",
  scenePath,
  aircraftPath: aircraftMxPath,
  reportPath,
  targetCL: generated.targetCL,
  geometry: generated.geometry,
  stdout: run.stdout,
  stderr: run.stderr,
  result: undefined,
};

if (run.status === 0) {
  const parsed = JSON.parse(run.stdout);
  report.result = parsed;
} else {
  report.message = "MachUpX did not run. Install with: python3 -m pip install --user git+https://github.com/usuaero/MachUpX.git";
}

fs.writeFileSync(reportPath, JSON.stringify(report, null, 2));
if (jsonOnly) {
  process.stdout.write(JSON.stringify(report, null, 2));
} else {
  console.log(JSON.stringify(report, null, 2));
}

function buildMachUpXInput(name, sizingProject) {
  const shapes = sizingProject.shapes;
  const wingShapes = shapes.filter((shape) => shape.role === "liftingSurface" && (shape.liftingSurfaceKind ?? "wing") === "wing");
  const horizontalSurfaces = shapes.filter(
    (shape) => shape.role === "liftingSurface" && (shape.liftingSurfaceKind ?? "wing") !== "fin" && shape.sketchViewMode !== "side",
  );
  if (!wingShapes.length) fail("MachUpX requires at least one lifting surface marked Wing.");

  const analysis = auditedEngine?.computeSizingAnalysis?.(sizingProject);
  const weightN = Math.max((analysis?.totalMassKg ?? totalMassKg(shapes)) * 9.80665, 0.1);
  const speedMS = Math.max(sizingProject.mission?.cruiseSpeedMS ?? 15, 0.1);
  const rho = 1.225;
  const wingAreaM2 = analysis?.wingAreaM2 ?? sum(wingShapes.map((shape) => liftingArea(shape, shapes)));
  const wingSpanM = Math.max(...wingShapes.map((shape) => liftingSpan(shape, shapes)), 0.01);
  const meanChordM = wingAreaM2 / wingSpanM;
  const targetCL = weightN / Math.max(0.5 * rho * speedMS * speedMS * wingAreaM2, 1e-9);

  const airfoils = {};
  const wings = {};
  let id = 1;
  for (const surface of horizontalSurfaces) {
    const spec = liftingSurfaceMachUpSpec(surface, shapes);
    if (!spec) continue;
    const airfoilName = normalizeAirfoil(surface.airfoilStations?.root10 ?? surface.airfoil ?? "NACA 0012");
    airfoils[airfoilName] = airfoilDefinition(airfoilName);
    wings[sanitize(surface.label || `surface_${id}`)] = {
      ID: id,
      is_main: (surface.liftingSurfaceKind ?? "wing") === "wing",
      side: "both",
      connect_to: { ID: 0, dx: spec.rootLeadingX, dy: 0, dz: 0, y_offset: spec.rootY },
      semispan: spec.semispan,
      sweep: spec.sweepDeg,
      dihedral: spec.dihedralDeg,
      chord: [
        [0, spec.rootChord],
        [1, spec.tipChord],
      ],
      twist: [
        [0, surface.incidenceStationsDeg?.root10 ?? surface.incidenceDeg ?? 0],
        [1, surface.incidenceStationsDeg?.tip90 ?? surface.incidenceDeg ?? 0],
      ],
      airfoil: airfoilName,
      grid: { N: Math.max(12, Math.min(40, Math.round(spec.semispan / 0.04))) },
    };
    id += 1;
  }

  const aircraft = {
    tag: `${name} generated from CADEX sketch`,
    weight: weightN,
    CG: [-(analysis?.com?.yM ?? 0), 0, 0],
    reference: {
      area: wingAreaM2,
      longitudinal_length: meanChordM,
      lateral_length: wingSpanM,
    },
    airfoils,
    wings,
  };
  const scene = {
    tag: "CADEX MachUpX validation",
    solver: { type: "linear" },
    units: "SI",
    scene: {
      atmosphere: { rho },
      aircraft: {
        cadex: {
          file: "",
          state: { velocity: speedMS, alpha: 0, beta: 0 },
        },
      },
    },
  };
  return { scene, aircraft, targetCL, geometry: { wingAreaM2, wingSpanM, meanChordM, speedMS, weightN } };
}

function liftingSurfaceMachUpSpec(shape, shapes) {
  const xs = [...new Set(shape.points.map((point) => Math.abs(point.xM)))].sort((a, b) => a - b);
  if (xs.length < 2) return undefined;
  const rootX = xs[0];
  const tipX = xs[xs.length - 1];
  const rootChord = chordAtX(shape.points, rootX + (tipX - rootX) * 0.01) ?? chordAtX(shape.points, rootX);
  const tipChord = chordAtX(shape.points, tipX - (tipX - rootX) * 0.01) ?? chordAtX(shape.points, tipX);
  if (!rootChord || !tipChord) return undefined;
  const rootQc = -rootChord.leadingY + rootChord.chord * 0.25;
  const tipQc = -tipChord.leadingY + tipChord.chord * 0.25;
  const semispan = Math.max(tipX, 0.01);
  const sweepDeg = Math.atan2(tipQc - rootQc, semispan) * 180 / Math.PI;
  const breakX = dihedralBreakX(shape, shapes) ?? tipX;
  const run = Math.max(Math.min(breakX, tipX) - rootX, 0.01);
  const dihedralDeg = Math.atan2(shape.dihedralLiftM ?? 0, run) * 180 / Math.PI;
  return {
    rootY: 0,
    semispan,
    rootLeadingX: -rootChord.leadingY,
    rootChord: rootChord.chord,
    tipChord: tipChord.chord,
    sweepDeg,
    dihedralDeg,
  };
}

function chordAtX(points, x) {
  const hits = [];
  for (let i = 0; i < points.length; i += 1) {
    const a = points[i];
    const b = points[(i + 1) % points.length];
    const x1 = Math.abs(a.xM);
    const x2 = Math.abs(b.xM);
    if (Math.abs(x2 - x1) < 1e-9) continue;
    const minX = Math.min(x1, x2);
    const maxX = Math.max(x1, x2);
    if (x < minX || x > maxX) continue;
    const t = (x - x1) / (x2 - x1);
    hits.push(a.yM + (b.yM - a.yM) * t);
  }
  if (hits.length < 2) return undefined;
  hits.sort((a, b) => a - b);
  const trailingY = hits[0];
  const leadingY = hits[hits.length - 1];
  return { leadingY, trailingY, chord: Math.max(leadingY - trailingY, 0.001) };
}

function dihedralBreakX(shape, shapes) {
  if (!shape.dihedralBreakStationId || shape.dihedralBreakStationId === "implicit-x-axis-mirror" || shape.dihedralBreakStationId === "implicit-y-axis-mirror") return 0;
  const ref = shapes.find((candidate) => candidate.id === shape.dihedralBreakStationId);
  if (!ref || ref.points.length < 2) return undefined;
  const [a, b] = ref.points;
  if (Math.abs(a.xM - b.xM) > Math.abs(a.yM - b.yM)) return undefined;
  return (a.xM + b.xM) / 2;
}

function liftingArea(shape, shapes) {
  return auditedEngine?.liftingSurfaceStats?.(shape, shapes).areaM2 ?? polygonArea(shape.points) * 2;
}

function liftingSpan(shape, shapes) {
  return auditedEngine?.liftingSurfaceStats?.(shape, shapes).spanM ?? Math.max(...shape.points.map((point) => Math.abs(point.xM))) * 2;
}

function totalMassKg(shapes) {
  return Math.max(sum(shapes.map((shape) => Math.max(shape.massKg ?? 0, 0))), 0.1);
}

function polygonArea(points) {
  if (points.length < 3) return 0;
  return Math.abs(points.reduce((total, point, index) => {
    const next = points[(index + 1) % points.length];
    return total + point.xM * next.yM - next.xM * point.yM;
  }, 0)) / 2;
}

function airfoilDefinition(name) {
  const n = name.toLowerCase().replace(/\s+/g, "");
  const cambered = n.includes("2412") || n.includes("4412") || n.includes("clark");
  return {
    type: "linear",
    aL0: cambered ? -0.035 : 0,
    CLa: 6.28318530718,
    CmL0: 0,
    Cma: 0,
    CD0: n.includes("s1223") ? 0.018 : 0.012,
    CD1: 0,
    CD2: 0.025,
    CL_max: n.includes("s1223") ? 1.7 : 1.35,
  };
}

function normalizeAirfoil(name) {
  return name.replace(/[^a-zA-Z0-9_ -]/g, "").trim().replace(/\s+/g, "_") || "NACA_0012";
}

function sanitize(value) {
  return String(value).replace(/[^a-zA-Z0-9_-]+/g, "_").replace(/^_+|_+$/g, "") || "cadex";
}

function sum(values) {
  return values.reduce((total, value) => total + value, 0);
}

function fail(message) {
  console.error(message);
  process.exit(1);
}
