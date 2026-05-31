#!/usr/bin/env node
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { spawnSync } from "node:child_process";

const inputPath = path.resolve(process.argv[2] ?? "aircraft/dart80kg/aircraft.json");
const outDir = path.resolve(process.argv[3] ?? "exports/paraview");
const jsonOnly = process.argv.includes("--json-only");

fs.mkdirSync(outDir, { recursive: true });

const input = JSON.parse(fs.readFileSync(inputPath, "utf8"));
const name = input.name ?? input.project?.name ?? "CadexAircraft";
const stem = sanitize(name);
const openFoamOutDir = path.join(outDir, "geometry");
const openFoamRun = spawnSync(
  "node",
  ["scripts/analyze-openfoam.mjs", inputPath, openFoamOutDir, "--json-only"],
  { cwd: process.cwd(), encoding: "utf8", maxBuffer: 40 * 1024 * 1024 },
);

if (openFoamRun.status !== 0) {
  writeReport({
    ok: false,
    backendReady: false,
    solver: "ParaView",
    message: "Aircraft geometry export failed before ParaView render.",
    stdout: openFoamRun.stdout,
    stderr: openFoamRun.stderr,
  });
}

let geometryReport;
try {
  geometryReport = JSON.parse(openFoamRun.stdout);
} catch (error) {
  writeReport({
    ok: false,
    backendReady: false,
    solver: "ParaView",
    message: `Geometry exporter returned invalid JSON: ${error}`,
    stdout: openFoamRun.stdout,
    stderr: openFoamRun.stderr,
  });
}

const components = (geometryReport.verification?.components ?? [])
  .map((component) => ({
    ...component,
    filePath: path.join(geometryReport.geometryDir, `${sanitize(component.name)}.stl`),
  }))
  .filter((component) => fs.existsSync(component.filePath));

const executable = findParaViewPython();
const scriptPath = path.join(outDir, `${stem}_render.py`);
const imagePath = path.join(outDir, `${stem}_paraview.png`);
const manifestPath = path.join(outDir, `${stem}_paraview_manifest.json`);
fs.writeFileSync(manifestPath, JSON.stringify({ components, geometryReportPath: geometryReport.reportPath }, null, 2));
fs.writeFileSync(scriptPath, paraViewScript({ components, imagePath }));

if (!executable) {
  writeReport({
    ok: false,
    backendReady: false,
    solver: "ParaView",
    message: "ParaView backend is not installed. Install ParaView or set PARAVIEW_PYTHON to pvpython/pvbatch, then render again.",
    geometryReady: components.length > 0,
    componentCount: components.length,
    geometryDir: geometryReport.geometryDir,
    manifestPath,
    scriptPath,
    imagePath: undefined,
    renderDataUrl: undefined,
    verification: geometryReport.verification,
  });
}

const renderRun = spawnSync(executable, [scriptPath], { cwd: process.cwd(), encoding: "utf8", maxBuffer: 20 * 1024 * 1024 });
const rendered = renderRun.status === 0 && fs.existsSync(imagePath);
writeReport({
  ok: rendered,
  backendReady: true,
  solver: "ParaView",
  message: rendered ? "ParaView rendered the exported aircraft geometry." : "ParaView was found, but rendering failed.",
  executable,
  geometryReady: components.length > 0,
  componentCount: components.length,
  geometryDir: geometryReport.geometryDir,
  manifestPath,
  scriptPath,
  imagePath: rendered ? imagePath : undefined,
  renderDataUrl: rendered ? `data:image/png;base64,${fs.readFileSync(imagePath).toString("base64")}` : undefined,
  stdout: renderRun.stdout,
  stderr: renderRun.stderr,
  verification: geometryReport.verification,
});

function writeReport(report) {
  const reportPath = path.join(outDir, `${stem}_paraview_report.json`);
  const payload = { ...report, reportPath };
  fs.writeFileSync(reportPath, JSON.stringify(payload, null, 2));
  const text = JSON.stringify(payload, null, 2);
  if (jsonOnly) process.stdout.write(text);
  else console.log(text);
  process.exit(report.ok || report.geometryReady !== false ? 0 : 1);
}

function findParaViewPython() {
  const candidates = [
    process.env.PARAVIEW_PYTHON,
    "pvpython",
    "pvbatch",
    "/Applications/ParaView.app/Contents/bin/pvpython",
    "/Applications/ParaView.app/Contents/MacOS/pvpython",
    "/opt/homebrew/bin/pvpython",
    "/usr/local/bin/pvpython",
  ].filter(Boolean);
  for (const candidate of candidates) {
    const probe = spawnSync(candidate, ["--version"], { encoding: "utf8" });
    if (probe.status === 0) return candidate;
  }
  return undefined;
}

function paraViewScript({ components, imagePath }) {
  const bounds = mergeBounds(components.map((component) => component.bounds));
  const center = [
    (bounds.min[0] + bounds.max[0]) / 2,
    (bounds.min[1] + bounds.max[1]) / 2,
    (bounds.min[2] + bounds.max[2]) / 2,
  ];
  const size = [
    Math.max(bounds.max[0] - bounds.min[0], 0.1),
    Math.max(bounds.max[1] - bounds.min[1], 0.1),
    Math.max(bounds.max[2] - bounds.min[2], 0.1),
  ];
  const maxDim = Math.max(...size, 1);
  const camera = [
    center[0] + maxDim * 1.02,
    center[1] - maxDim * 0.46,
    center[2] + maxDim * 0.32,
  ];
  return `from paraview.simple import *\n` +
    `paraview.simple._DisableFirstRenderCameraReset()\n` +
    `view = CreateView('RenderView')\n` +
    `view.ViewSize = [1600, 950]\n` +
    `view.Background = [0.027, 0.063, 0.094]\n` +
    components.map((component) => {
      const color = colorFor(component.kind);
      return `reader_${safePy(component.name)} = STLReader(registrationName='${escapePy(component.name)}', FileNames=['${escapePy(component.filePath)}'])\n` +
        `display_${safePy(component.name)} = Show(reader_${safePy(component.name)}, view, 'GeometryRepresentation')\n` +
        `display_${safePy(component.name)}.Representation = 'Surface'\n` +
        `display_${safePy(component.name)}.DiffuseColor = [${color.join(", ")}]\n` +
        `display_${safePy(component.name)}.Specular = 0.18\n`;
    }).join("") +
    `view.CameraPosition = [${camera.join(", ")}]\n` +
    `view.CameraFocalPoint = [${center.join(", ")}]\n` +
    `view.CameraViewUp = [0, 0, 1]\n` +
    `view.CameraParallelProjection = 0\n` +
    `ResetCamera(view)\n` +
    `view.CameraPosition = [${camera.join(", ")}]\n` +
    `view.CameraFocalPoint = [${center.join(", ")}]\n` +
    `view.CameraViewUp = [0, 0, 1]\n` +
    `Render(view)\n` +
    `SaveScreenshot('${escapePy(imagePath)}', view, ImageResolution=[1600, 950], TransparentBackground=0)\n`;
}

function mergeBounds(boundsList) {
  const valid = boundsList.filter((bounds) => bounds?.min && bounds?.max);
  if (!valid.length) return { min: [-1, -1, -1], max: [1, 1, 1] };
  return {
    min: [0, 1, 2].map((axis) => Math.min(...valid.map((bounds) => bounds.min[axis]))),
    max: [0, 1, 2].map((axis) => Math.max(...valid.map((bounds) => bounds.max[axis]))),
  };
}

function colorFor(kind) {
  if (kind === "wing") return [0.43, 0.72, 1.0];
  if (kind === "wingevon") return [0.51, 0.95, 0.78];
  if (kind === "lex") return [1.0, 0.81, 0.4];
  if (kind === "tailplane") return [0.71, 0.61, 1.0];
  if (kind === "fin") return [0.95, 0.55, 0.66];
  if (kind === "rotor") return [0.9, 0.93, 0.96];
  if (kind === "body") return [0.83, 0.87, 0.91];
  return [0.62, 0.7, 0.75];
}

function sanitize(value) {
  return String(value ?? "cadex").replace(/[^a-zA-Z0-9_-]+/g, "_") || "cadex";
}

function safePy(value) {
  return sanitize(value).replace(/^[^a-zA-Z_]/, "_$&");
}

function escapePy(value) {
  return String(value).replace(/\\/g, "\\\\").replace(/'/g, "\\'");
}
