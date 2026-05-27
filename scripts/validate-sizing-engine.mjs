import assert from "node:assert/strict";
import { bodyMassEstimate, bodySurfaceAreaEstimate, computeSizingAnalysis } from "../src/sizingEngine.ts";

const rho = 1.225;
const speed = 17;
const payloadKg = 1;
const batteryMassKg = Math.max(payloadKg * 0.62, 0.35);
const bodyShellAreaM2 = 2 * Math.PI * 0.05 * 0.1 + 2 * Math.PI * 0.1 * 1 + 2 * Math.PI * 0.05 * 0.1;
const bodyMassKg = bodyShellAreaM2 * 0.0012 * 1600;
const totalMassKg = bodyMassKg + 0.5 + payloadKg + batteryMassKg;
const weightN = totalMassKg * 9.81;
const wingAreaM2 = 0.4;
const spanM = 2;
const meanChordM = wingAreaM2 / spanM;
const aspectRatio = (spanM * spanM) / wingAreaM2;
const clCruise = weightN / (0.5 * rho * speed * speed * wingAreaM2);
const cdEstimate = 0.04 + (clCruise * clCruise) / (Math.PI * 0.74 * aspectRatio);
const expectedComY = (payloadKg * 0.05 + batteryMassKg * -0.12) / totalMassKg;

const project = {
  mission: {
    payloadKg,
    cruiseSpeedMS: speed,
    enduranceMin: 20,
    batteryEnergyDensityWhKg: 190,
    motorCount: 2,
  },
  shapes: [
    {
      id: "body",
      role: "body",
      label: "Body",
      drawMode: "line",
      massKg: 1,
      points: [
        { xM: 0, yM: 0.5 },
        { xM: 0.1, yM: 0.5 },
        { xM: 0.1, yM: -0.5 },
        { xM: 0, yM: -0.5 },
      ],
    },
    {
      id: "wing",
      role: "liftingSurface",
      label: "Wing",
      drawMode: "line",
      massKg: 0.5,
      points: [
        { xM: 0, yM: 0.1 },
        { xM: 1, yM: 0.1 },
        { xM: 1, yM: -0.1 },
        { xM: 0, yM: -0.1 },
      ],
    },
  ],
};

const analysis = computeSizingAnalysis(project);

approx(bodySurfaceAreaEstimate(project.shapes[0]), bodyShellAreaM2, "body shell surface area");
approx(bodyMassEstimate(project.shapes[0]), bodyMassKg, "body material mass");
approx(analysis.totalMassKg, totalMassKg, "total mass");
approx(analysis.wingAreaM2, wingAreaM2, "mirrored wing area");
approx(analysis.meanChordM, meanChordM, "mean chord");
approx(analysis.com.xM, 0, "symmetric CoM x");
approx(analysis.com.yM, expectedComY, "mass-weighted CoM y");
approx(analysis.cop.xM, 0, "symmetric CoP x");
approx(analysis.cop.yM, 0.05, "quarter-chord CoP y");
approx(analysis.clCruise, clCruise, "CL from lift equation");
approx(analysis.cdEstimate, cdEstimate, "CD polar estimate");
approx(analysis.liftDragRatio, clCruise / cdEstimate, "L/D");
approx(analysis.stallSpeedMS, Math.sqrt((2 * weightN) / (rho * wingAreaM2 * 1.2)), "stall speed");
approx(analysis.thrustToWeight, (2 * 7.2) / weightN, "thrust-to-weight");
approx(analysis.batteryAvailableWh, batteryMassKg * 190, "battery available");
approx(analysis.batteryRequiredWh, (totalMassKg * 95 * (20 / 60)) / 0.72, "battery required");
approx(analysis.wingLoadingKgM2, totalMassKg / wingAreaM2, "wing loading");

const tailProject = {
  mission: project.mission,
  shapes: [
    project.shapes[1],
    {
      id: "tail",
      role: "liftingSurface",
      label: "Tail",
      drawMode: "line",
      massKg: 0.1,
      points: [
        { xM: 0, yM: -0.68 },
        { xM: 0.5, yM: -0.68 },
        { xM: 0.5, yM: -0.76 },
        { xM: 0, yM: -0.76 },
      ],
    },
  ],
};
const tailAnalysis = computeSizingAnalysis(tailProject);
const tailArea = 0.5 * 0.08 * 2;
const expectedAreaWeightedCop = (0.05 * wingAreaM2 + (-0.68 - 0.08 * 0.25) * tailArea) / (wingAreaM2 + tailArea);
approx(tailAnalysis.cop.yM, expectedAreaWeightedCop, "area-weighted wing and tail CoP");

// VSPAERO reference values sent to OpenVSP should match the sizing analysis.
const vspaeroSpan = tailAnalysis.wingAreaM2 / tailAnalysis.meanChordM;
approx(vspaeroSpan, sum(tailProject.shapes.filter((s) => s.role === "liftingSurface").map((shape) => {
  const xs = shape.points.map((p) => Math.abs(p.xM));
  return Math.max(...xs, 0.05) * 2;
})), "VSPAERO bref from analysis");

console.log("Sizing engine validation passed.");

function sum(values) {
  return values.reduce((total, value) => total + value, 0);
}

function approx(actual, expected, label, tolerance = 1e-9) {
  assert.ok(
    Math.abs(actual - expected) <= tolerance,
    `${label}: expected ${expected}, got ${actual}`,
  );
}
