#!/usr/bin/env node
import fs from "node:fs";
import path from "node:path";
import { spawnSync } from "node:child_process";
import { createHash } from "node:crypto";

const inputPath = path.resolve(process.argv[2] ?? "aircraft/dart80kg/aircraft.json");
const outDir = path.resolve(process.argv[3] ?? "exports/paraview");
const jsonOnly = process.argv.includes("--json-only");
const forceSolve = process.argv.includes("--force-solve");
const meshVersion = 3;

fs.mkdirSync(outDir, { recursive: true });

const input = JSON.parse(fs.readFileSync(inputPath, "utf8"));
const name = input.name ?? input.project?.name ?? "CadexAircraft";
const stem = sanitize(name);
const renderOptions = normalizeRenderOptions(input.renderOptions);
const geometryHash = createHash("sha256").update(JSON.stringify({ name, sizing: input.sizing ?? input.project?.sizing })).digest("hex");
const renderHash = createHash("sha256").update(JSON.stringify(renderOptions)).digest("hex");
const inputHash = createHash("sha256").update(JSON.stringify({ geometryHash, renderHash })).digest("hex");
const openFoamOutDir = path.resolve("exports/openfoam");
const expectedCaseDir = path.join(openFoamOutDir, `${stem}_cruise`);
const manifestPath = path.join(outDir, `${stem}_paraview_manifest.json`);
const solvedCase = solvedOpenFoamCase(expectedCaseDir);
const previousManifest = readJsonIfExists(manifestPath);
const previousGeometryHash = previousManifest?.geometryHash ?? previousManifest?.inputHash;
const canReuseSolvedCase = solvedCase && !forceSolve && previousGeometryHash === geometryHash && previousManifest?.meshVersion === meshVersion;
let openFoamReport = canReuseSolvedCase ? readExistingOpenFoamReport(openFoamOutDir, stem) : undefined;
if (!openFoamReport) {
  const openFoamArgs = ["scripts/analyze-openfoam.mjs", inputPath, openFoamOutDir, "--json-only", "--cruise", "--mesh", "--solve"];
  const openFoamRun = spawnSync("node", openFoamArgs, { cwd: process.cwd(), encoding: "utf8", maxBuffer: 80 * 1024 * 1024 });
  if (openFoamRun.status !== 0) {
    writeReport({
      ok: false,
      backendReady: false,
      solver: "ParaView",
      message: "OpenFOAM analysis failed before ParaView rendering.",
      stdout: openFoamRun.stdout,
      stderr: openFoamRun.stderr,
    });
  }
  try {
    openFoamReport = JSON.parse(openFoamRun.stdout);
  } catch (error) {
    writeReport({
      ok: false,
      backendReady: false,
      solver: "ParaView",
      message: `OpenFOAM returned invalid JSON: ${error}`,
      stdout: openFoamRun.stdout,
      stderr: openFoamRun.stderr,
    });
  }
}

const variant = openFoamReport.variants?.find((entry) => entry.id === "cruise") ?? openFoamReport.variants?.[0];
const caseDir = canReuseSolvedCase ? expectedCaseDir : variant?.caseDir ?? expectedCaseDir;
const latestTime = latestNumericTime(caseDir);
const availableTimes = numericTimes(caseDir);
const renderTime = chooseRenderTime(renderOptions.time, availableTimes, latestTime);
const components = (openFoamReport.verification?.components ?? [])
  .map((component) => ({
    ...component,
    filePath: path.join(openFoamReport.geometryDir, `${sanitize(component.name)}.stl`),
  }))
  .filter((component) => fs.existsSync(component.filePath));

if (!latestTime) {
  writeReport({
    ok: false,
    backendReady: false,
    solver: "ParaView",
    message: "OpenFOAM case exists, but no solved numeric time directory with p/U fields was found.",
    caseDir,
    componentCount: components.length,
    openFoamReportPath: openFoamReport.reportPath,
    verification: openFoamReport.verification,
  });
}

const executable = findParaViewPython();
const scriptPath = path.join(outDir, `${stem}_render.py`);
const foamPath = path.join(caseDir, "case.foam");
const views = buildViews(stem, outDir, renderOptions);
fs.writeFileSync(foamPath, "");
fs.writeFileSync(manifestPath, JSON.stringify({ caseDir, components, foamPath, geometryHash, inputHash, meshVersion, renderHash, renderOptions, latestTime, openFoamReportPath: openFoamReport.reportPath, views }, null, 2));
fs.writeFileSync(scriptPath, paraViewScript({ bounds: openFoamReport.verification?.bounds, cameraPreset: renderOptions.cameraPreset, components, foamPath, renderTime, views }));

const cachedRenderReady =
  previousManifest?.geometryHash === geometryHash &&
  previousManifest?.meshVersion === meshVersion &&
  previousManifest?.renderHash === renderHash &&
  views.every((view) => fs.existsSync(view.imagePath));
if (cachedRenderReady && !forceSolve) {
  writeReport({
    ok: true,
    backendReady: true,
    solver: "ParaView",
    message: "Loaded saved ParaView render.",
    caseDir,
    geometryHash,
    inputHash,
    meshVersion,
    renderHash,
    renderOptions,
    availableTimes,
    latestTime,
    renderTime,
    componentCount: components.length,
    manifestPath,
    scriptPath,
    openFoamReportPath: openFoamReport.reportPath,
    views,
    verification: openFoamReport.verification,
  });
}

if (!executable) {
  writeReport({
    ok: false,
    backendReady: false,
    solver: "ParaView",
    message: "ParaView backend is not installed. Install ParaView or set PARAVIEW_PYTHON to pvpython/pvbatch, then render again.",
    caseDir,
    componentCount: components.length,
    manifestPath,
    scriptPath,
    openFoamReportPath: openFoamReport.reportPath,
    verification: openFoamReport.verification,
  });
}

const renderRun = spawnSync(executable, [scriptPath], { cwd: process.cwd(), encoding: "utf8", maxBuffer: 40 * 1024 * 1024 });
const renderedViews = views
  .filter((view) => renderRun.status === 0 && fs.existsSync(view.imagePath))
  .map((view) => ({ ...view }));

writeReport({
  ok: renderedViews.length === views.length,
  backendReady: true,
  solver: "ParaView",
  message: renderedViews.length === views.length
    ? "OpenFOAM cruise case rendered through ParaView."
    : "ParaView was found, but one or more FOAM result views failed to render.",
  executable,
  caseDir,
  geometryHash,
  inputHash,
  meshVersion,
  renderHash,
  renderOptions,
  availableTimes,
  latestTime,
  renderTime,
  componentCount: components.length,
  manifestPath,
  scriptPath,
  openFoamReportPath: openFoamReport.reportPath,
  views: renderedViews,
  stdout: trimLog(renderRun.stdout),
  stderr: trimLog(renderRun.stderr),
  verification: openFoamReport.verification,
});

function solvedOpenFoamCase(caseDir) {
  const time = latestNumericTime(caseDir);
  if (!time) return false;
  return fs.existsSync(path.join(caseDir, time, "p")) && fs.existsSync(path.join(caseDir, time, "U"));
}

function readExistingOpenFoamReport(openFoamOutDir, stem) {
  const reportPath = path.join(openFoamOutDir, `${stem}_openfoam_report.json`);
  if (!fs.existsSync(reportPath)) return undefined;
  return JSON.parse(fs.readFileSync(reportPath, "utf8"));
}

function readJsonIfExists(filePath) {
  if (!fs.existsSync(filePath)) return undefined;
  try {
    return JSON.parse(fs.readFileSync(filePath, "utf8"));
  } catch {
    return undefined;
  }
}

function latestNumericTime(caseDir) {
  return numericTimes(caseDir).at(-1);
}

function numericTimes(caseDir) {
  if (!fs.existsSync(caseDir)) return undefined;
  return fs.readdirSync(caseDir)
    .map((entry) => ({ entry, value: Number(entry) }))
    .filter((entry) => Number.isFinite(entry.value) && entry.value > 0)
    .sort((a, b) => a.value - b.value)
    .map((entry) => entry.entry);
}

function chooseRenderTime(requested, times = [], latest) {
  if (requested === "latest" || requested == null) return latest;
  const requestedNumber = Number(requested);
  if (!Number.isFinite(requestedNumber)) return latest;
  return times.find((time) => Number(time) === requestedNumber) ?? latest;
}

function writeReport(report) {
  const reportPath = path.join(outDir, `${stem}_paraview_report.json`);
  const payload = { ...report, reportPath };
  fs.writeFileSync(reportPath, JSON.stringify(payload, null, 2));
  const text = JSON.stringify(payload, null, 2);
  if (jsonOnly) process.stdout.write(text);
  else console.log(text);
  process.exit(report.ok || report.caseDir ? 0 : 1);
}

function trimLog(log) {
  const value = String(log ?? "").trim();
  if (!value) return undefined;
  return value.length > 4000 ? `${value.slice(0, 1800)}\n...\n${value.slice(-1800)}` : value;
}

function findParaViewPython() {
  const candidates = [
    process.env.PARAVIEW_PYTHON,
    "pvpython",
    "pvbatch",
    "/Applications/ParaView-6.1.1.app/Contents/bin/pvpython",
    "/Applications/ParaView-6.1.1.app/Contents/bin/pvbatch",
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

function normalizeRenderOptions(value) {
  const cameraPreset = ["aftHighRight", "top", "side"].includes(value?.cameraPreset) ? value.cameraPreset : "aftHighRight";
  const modes = Array.isArray(value?.modes) && value.modes.length
    ? value.modes.filter((mode) => defaultViewModes().some((entry) => entry.id === mode))
    : defaultViewModes().slice(0, 3).map((entry) => entry.id);
  const time = value?.time === "latest" || Number.isFinite(Number(value?.time)) ? String(value.time) : "latest";
  return { cameraPreset, modes: modes.length ? [...new Set(modes)] : defaultViewModes().slice(0, 3).map((entry) => entry.id), time };
}

function defaultViewModes() {
  return [
    { id: "pressure", title: "Pressure surface", field: "p", component: undefined },
    { id: "velocity", title: "Velocity surface", field: "U", component: "Magnitude" },
    { id: "vorticity", title: "Vorticity surface", field: "vorticity", component: "Magnitude" },
    { id: "turbulenceK", title: "Turbulence k", field: "k", component: undefined },
    { id: "omega", title: "Specific dissipation", field: "omega", component: undefined },
    { id: "nut", title: "Turbulent viscosity", field: "nut", component: undefined },
  ];
}

function buildViews(stem, outDir, renderOptions) {
  const modes = defaultViewModes();
  return renderOptions.modes
    .map((id) => modes.find((mode) => mode.id === id))
    .filter(Boolean)
    .map((mode) => ({
      ...mode,
      imagePath: path.join(outDir, `${stem}_${mode.id}_${renderOptions.cameraPreset}_t${sanitize(renderOptions.time)}.png`),
    }));
}

function paraViewScript({ bounds, cameraPreset, components, foamPath, renderTime, views }) {
  const mergedBounds = bounds?.min && bounds?.max ? bounds : mergeBounds(components.map((component) => component.bounds));
  const focal = [
    (mergedBounds.min[0] + mergedBounds.max[0]) / 2,
    (mergedBounds.min[1] + mergedBounds.max[1]) / 2,
    (mergedBounds.min[2] + mergedBounds.max[2]) / 2,
  ];
  const size = [
    Math.max(mergedBounds.max[0] - mergedBounds.min[0], 0.1),
    Math.max(mergedBounds.max[1] - mergedBounds.min[1], 0.1),
    Math.max(mergedBounds.max[2] - mergedBounds.min[2], 0.1),
  ];
  const maxDim = Math.max(...size, 1);
  const camera = cameraForPreset(cameraPreset, focal, maxDim);
  const timeValue = Number(renderTime) || 0;
  return `from paraview.simple import *\n` +
    `paraview.simple._DisableFirstRenderCameraReset()\n` +
    `foam = OpenFOAMReader(registrationName='Cadex OpenFOAM case', FileName='${escapePy(foamPath)}')\n` +
    `foam.MeshRegions = ['internalMesh']\n` +
    `foam.CellArrays = ['p', 'U', 'vorticity', 'k', 'omega', 'nut']\n` +
    `scene = GetAnimationScene()\n` +
    `scene.UpdateAnimationUsingDataTimeSteps()\n` +
    `scene.AnimationTime = ${timeValue}\n` +
    `UpdatePipeline(time=${timeValue})\n` +
    helperPython(components, foamPath) +
    views.map((view) => renderViewPython({ camera, component: view.component, field: view.field, focal, imagePath: view.imagePath, timeValue, title: view.title })).join("\n");
}

function helperPython(components, foamPath) {
  return `
def add_aircraft(view):
    stl_files = ${pythonList(components.map((component) => ({ ...component, color: colorFor(component.kind) })))}
    for name, color, file_path in stl_files:
        reader = STLReader(registrationName=name, FileNames=[file_path])
        display = Show(reader, view, 'GeometryRepresentation')
        display.Representation = 'Surface With Edges'
        display.DiffuseColor = color
        display.Opacity = 0.16
        display.Specular = 0.12

def aircraft_regions(reader):
    excluded = set(['patch/inlet', 'patch/outlet', 'patch/farfield', 'patch/wall'])
    return [region for region in reader.MeshRegions.Available if region.startswith('patch/') and region not in excluded]

def add_result_surface(view, field, component):
    surface = OpenFOAMReader(registrationName='Cadex aircraft result surface', FileName='${escapePy(foamPath)}')
    surface.MeshRegions = aircraft_regions(surface)
    surface.CellArrays = ['p', 'U', 'vorticity', 'k', 'omega', 'nut']
    UpdatePipeline(proxy=surface)
    display = Show(surface, view, 'GeometryRepresentation')
    display.Representation = 'Surface With Edges'
    if component:
        ColorBy(display, ('CELLS', field, component))
    else:
        ColorBy(display, ('CELLS', field))
    display.RescaleTransferFunctionToDataRange(True, False)
    display.SetScalarBarVisibility(view, True)
    display.Opacity = 1.0
    display.Specular = 0.18
    return surface

def add_title(view, text):
    annotation = Text(Text=text)
    annotation_display = Show(annotation, view)
    annotation_display.FontSize = 18
    annotation_display.Color = [0.92, 0.97, 1.0]
    annotation_display.WindowLocation = 'Upper Center'
`;
}

function cameraForPreset(preset, focal, maxDim) {
  if (preset === "top") return [focal[0] + maxDim * 0.08, focal[1] - maxDim * 0.02, focal[2] + maxDim * 2.1];
  if (preset === "side") return [focal[0] + maxDim * 0.12, focal[1] - maxDim * 2.1, focal[2] + maxDim * 0.2];
  return [focal[0] + maxDim * 1.35, focal[1] - maxDim * 0.88, focal[2] + maxDim * 0.5];
}

function renderViewPython({ camera, component, field, focal, imagePath, timeValue, title }) {
  const viewName = safePy(title);
  const colorBy = component ? `('${"CELLS"}', '${field}', '${component}')` : `('CELLS', '${field}')`;
  const pyComponent = component ? `'${escapePy(component)}'` : "None";
  return `
view_${viewName} = CreateView('RenderView')
view_${viewName}.ViewSize = [1600, 950]
view_${viewName}.Background = [0.027, 0.063, 0.094]
slice_${viewName} = Slice(registrationName='${escapePy(title)}', Input=foam)
slice_${viewName}.SliceType = 'Plane'
slice_${viewName}.SliceType.Origin = [${focal.join(", ")}]
slice_${viewName}.SliceType.Normal = [0, 1, 0]
UpdatePipeline(time=${timeValue}, proxy=slice_${viewName})
display_${viewName} = Show(slice_${viewName}, view_${viewName}, 'GeometryRepresentation')
display_${viewName}.Representation = 'Surface'
ColorBy(display_${viewName}, ${colorBy})
display_${viewName}.RescaleTransferFunctionToDataRange(True, False)
display_${viewName}.Opacity = 0.08
display_${viewName}.Visibility = 0
surface_${viewName} = add_result_surface(view_${viewName}, '${escapePy(field)}', ${pyComponent})
add_aircraft(view_${viewName})
add_title(view_${viewName}, '${escapePy(title)}')
view_${viewName}.CameraPosition = [${camera.join(", ")}]
view_${viewName}.CameraFocalPoint = [${focal.join(", ")}]
view_${viewName}.CameraViewUp = [0, 0, 1]
view_${viewName}.CameraParallelProjection = 0
Render(view_${viewName})
SaveScreenshot('${escapePy(imagePath)}', view_${viewName}, ImageResolution=[1600, 950], TransparentBackground=0)
`;
}

function mergeBounds(boundsEntries) {
  const valid = boundsEntries.filter((bounds) => bounds?.min && bounds?.max);
  if (!valid.length) return { min: [-3, -2, -0.3], max: [0.1, 2, 1] };
  return valid.reduce((acc, bounds) => ({
    min: acc.min.map((value, index) => Math.min(value, bounds.min[index])),
    max: acc.max.map((value, index) => Math.max(value, bounds.max[index])),
  }), {
    min: [Number.POSITIVE_INFINITY, Number.POSITIVE_INFINITY, Number.POSITIVE_INFINITY],
    max: [Number.NEGATIVE_INFINITY, Number.NEGATIVE_INFINITY, Number.NEGATIVE_INFINITY],
  });
}

function pythonList(entries) {
  return `[${entries.map((entry) => `('${escapePy(entry.name)}', [${entry.color.join(", ")}], '${escapePy(entry.filePath)}')`).join(", ")}]`;
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
