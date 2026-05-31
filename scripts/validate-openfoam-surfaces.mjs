#!/usr/bin/env node
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { spawnSync } from "node:child_process";

const outDir = path.resolve("tmp/validate-openfoam-surfaces");
fs.rmSync(outDir, { recursive: true, force: true });

const report = runOpenFoamExport(outDir);
assert.equal(report.ok, true, report.message);
const project = JSON.parse(fs.readFileSync("aircraft/dart80kg/aircraft.json", "utf8"));
const shapes = project.sizing?.shapes ?? [];
const wingevonShape = shapes.find((shape) => shape.role === "liftingSurface" && shape.liftingSurfaceKind === "wingevon");
const wingevonHinge = shapes.find((shape) => shape.id === wingevonShape?.movement?.hingeLineId);
const wingevonHingeZ = wingevonHinge ? effectiveZOffsetM(wingevonHinge, shapes) : undefined;

const wingevons = report.verification.components.filter((component) => component.kind === "wingevon");
assert.equal(wingevons.length, 2, "Dart wingevon should export as mirrored left/right OpenFOAM surfaces");

for (const component of wingevons) {
  const absInnerSpanM = Math.min(Math.abs(component.bounds.min[1]), Math.abs(component.bounds.max[1]));
  const absOuterSpanM = Math.max(Math.abs(component.bounds.min[1]), Math.abs(component.bounds.max[1]));
  assert.ok(absInnerSpanM > 1, `${component.name} must start at the drawn inner wingevon station, not the centerline`);
  assert.ok(absOuterSpanM > 1.85 && absOuterSpanM < 2.05, `${component.name} must end near the drawn tip station after hinge deflection`);
  assert.ok(component.bounds.min[0] < -1.55, `${component.name} must include the drawn trailing edge`);
  assert.ok(component.bounds.max[0] < -0.62 && component.bounds.max[0] > -0.82, `${component.name} must include the drawn leading edge after hinge deflection`);
  if (wingevonShape?.movement?.enabled && (wingevonShape.movement.deflectionDeg ?? 0) > (wingevonShape.movement.neutralDeg ?? 0) && wingevonHingeZ !== undefined) {
    assert.ok(component.centroid[2] < wingevonHingeZ, `${component.name} must deflect downward from the sketch hinge, not upward`);
  }
  assert.ok(component.areaM2 > 1 && component.areaM2 < 1.8, `${component.name} surface area should match the outer-panel wingevon, not a full-span slab`);
  assert.ok(component.triangles > 2500, `${component.name} should be a resolved airfoil surface`);
}

const [left, right] = wingevons.sort((a, b) => a.name.localeCompare(b.name));
approx(left.bounds.min[0], right.bounds.min[0], "left/right wingevon longitudinal minimum");
approx(left.bounds.max[0], right.bounds.max[0], "left/right wingevon longitudinal maximum");
approx(Math.abs(left.bounds.min[1]), Math.abs(right.bounds.max[1]), "left/right wingevon outer span");
approx(Math.abs(left.bounds.max[1]), Math.abs(right.bounds.min[1]), "left/right wingevon inner span");

const alphaReport = runOpenFoamExport(path.join(outDir, "alpha25"), "--wingevon-alpha25");
const alphaVariants = alphaReport.variants ?? [];
assert.deepEqual(
  alphaVariants.map((variant) => variant.id),
  ["alpha25_wingevons_locked", "alpha25_wingevons_flat"],
  "wingevon alpha test exports locked and flat-to-flow variants",
);
for (const variant of alphaVariants) {
  assert.equal(variant.reference.alphaDeg, 25, `${variant.id} runs the 25 deg alpha case`);
  assert.ok(variant.airflow?.plots?.length >= 2, `${variant.id} prepares main-wing and wingevon airflow sample planes`);
  assert.ok(variant.components.some((name) => name.includes("wingevon")), `${variant.id} includes wingevon surfaces`);
}
const flatVariant = alphaVariants.find((variant) => variant.id === "alpha25_wingevons_flat");
assert.equal(flatVariant?.wingevonControl?.deflectionDeg, 25, "flat-to-flow wingevon rotates the outer panel by 25 deg");
assert.equal(flatVariant?.wingevonControl?.pivotChordFraction, 0.25, "wingevon movable surface pivots around quarter chord");

console.log("OpenFOAM wingevon surface validation passed.");

function runOpenFoamExport(directory, ...extraArgs) {
  fs.rmSync(directory, { recursive: true, force: true });
  const result = spawnSync(
    process.execPath,
    ["scripts/analyze-openfoam.mjs", "aircraft/dart80kg/aircraft.json", directory, "--json-only", ...extraArgs],
    { encoding: "utf8", maxBuffer: 180 * 1024 * 1024 },
  );

  assert.equal(result.status, 0, result.stderr || result.stdout);
  return JSON.parse(result.stdout);
}

function approx(actual, expected, label, tolerance = 1e-6) {
  assert.ok(Math.abs(actual - expected) <= tolerance, `${label}: expected ${expected}, got ${actual}`);
}

function effectiveZOffsetM(shape, shapes) {
  const station = shapes.find((candidate) => candidate.id === shape.zStationId);
  return station ? verticalReferenceX(station) + effectiveZOffsetM(station, shapes) : 0;
}

function verticalReferenceX(shape) {
  if (!shape.points?.length) return 0;
  return shape.points.reduce((total, point) => total + point.xM, 0) / shape.points.length;
}
