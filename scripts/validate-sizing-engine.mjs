import assert from "node:assert/strict";
import {
  bodyMassEstimate,
  bodySurfaceAreaEstimate,
  batteryMassEstimate,
  computeSizingAnalysis,
  liftingSurfaceMassEstimate,
  liftingSurfaceSkinAreaEstimate,
  motorMassEstimate,
  rotorMassPerRotorEstimate,
  rotorTotalMassEstimate,
} from "../src/sizing/index.ts";

const carbonFibreDensityKgM3 = 1600;
const thicknessM = 0.0012;
const payloadKg = 1;
const batteryMassKg = 0.62;
const inferredBatteryMassKg = 0.2 * 0.1 * 0.028 * 1700;

const bodySurfaceAreaM2 = 2 * Math.PI * 0.05 * 0.1 + 2 * Math.PI * 0.1 * 1 + 2 * Math.PI * 0.05 * 0.1;
const bodyMassKg = bodySurfaceAreaM2 * thicknessM * carbonFibreDensityKgM3;
const offsetBodyHalfAreaM2 = 0.1;
const offsetBodyPerimeterM = 2.2;
const offsetBodySurfaceAreaM2 = (offsetBodyHalfAreaM2 * 2 + offsetBodyPerimeterM * thicknessM) * 2;
const localMirrorBodySurfaceAreaM2 = bodySurfaceAreaM2;

const wingHalfAreaM2 = 0.2;
const wingSurfaceAreaM2 = wingHalfAreaM2 * 2;
const wingMassKg = wingSurfaceAreaM2 * thicknessM * carbonFibreDensityKgM3;

const totalMassKg = bodyMassKg + wingMassKg + payloadKg + inferredBatteryMassKg;
const expectedComY = (bodyMassKg * 0 + wingMassKg * 0 + payloadKg * 0.05 + inferredBatteryMassKg * -0.12) / totalMassKg;

const project = {
  mission: {
    payloadKg,
    cruiseSpeedMS: 17,
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
      bodyMaterial: "carbonFibre",
      bodyThicknessMm: 1.2,
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
      liftingSurfaceKind: "wing",
      label: "Wing",
      drawMode: "line",
      bodyMaterial: "carbonFibre",
      bodyThicknessMm: 1.2,
      points: [
        { xM: 0, yM: 0.1 },
        { xM: 1, yM: 0.1 },
        { xM: 1, yM: -0.1 },
        { xM: 0, yM: -0.1 },
      ],
    },
    {
      id: "payload",
      role: "part",
      partType: "payload",
      label: "Payload",
      drawMode: "line",
      massKg: payloadKg,
      points: [
        { xM: 0, yM: 0.05 },
        { xM: 0.05, yM: 0.05 },
      ],
    },
    {
      id: "battery",
      role: "part",
      partType: "battery",
      label: "Battery",
      drawMode: "line",
      massKg: batteryMassKg,
      points: [
        { xM: 0, yM: -0.07 },
        { xM: 0.1, yM: -0.07 },
        { xM: 0.1, yM: -0.17 },
        { xM: 0, yM: -0.17 },
      ],
    },
  ],
};

const analysis = computeSizingAnalysis(project);

approx(bodySurfaceAreaEstimate(project.shapes[0]), bodySurfaceAreaM2, "body mirrored surface area");
approx(bodyMassEstimate(project.shapes[0]), bodyMassKg, "body material mass");
approx(
  bodySurfaceAreaEstimate({
    id: "offset-body",
    role: "body",
    label: "Offset body",
    drawMode: "line",
    bodyMaterial: "carbonFibre",
    bodyThicknessMm: 1.2,
    points: [
      { xM: 0.2, yM: 0.5 },
      { xM: 0.3, yM: 0.5 },
      { xM: 0.3, yM: -0.5 },
      { xM: 0.2, yM: -0.5 },
    ],
  }),
  offsetBodySurfaceAreaM2,
  "offset body top, bottom, side area mirrored once",
);
approx(
  bodySurfaceAreaEstimate(
    {
      id: "local-mirror-body",
      role: "body",
      label: "Local mirror body",
      drawMode: "line",
      bodyMaterial: "carbonFibre",
      bodyThicknessMm: 1.2,
      points: [
        { xM: 0.2, yM: 0.5 },
        { xM: 0.3, yM: 0.5 },
        { xM: 0.3, yM: -0.5 },
        { xM: 0.2, yM: -0.5 },
      ],
    },
    [
      {
        id: "tailboom-mirror",
        role: "mirrorPlane",
        label: "Tailboom mirror",
        drawMode: "line",
        points: [
          { xM: 0.2, yM: 0.6 },
          { xM: 0.2, yM: -0.6 },
        ],
      },
    ],
  ),
  localMirrorBodySurfaceAreaM2,
  "body touching a created mirror plane revolves around that plane",
);
approx(liftingSurfaceSkinAreaEstimate(project.shapes[1]), wingSurfaceAreaM2, "lifting surface mirrored skin area");
approx(liftingSurfaceMassEstimate(project.shapes[1]), wingMassKg, "lifting surface material mass");
approx(batteryMassEstimate(project.shapes[3]), inferredBatteryMassKg, "battery mass ignores stale manual mass and uses inferred LiPo volume");
approx(
  motorMassEstimate({
    id: "motor",
    role: "part",
    partType: "motor",
    label: "Motor",
    drawMode: "line",
    points: [
      { xM: 0.2, yM: 0.15 },
      { xM: 0.25, yM: 0.15 },
      { xM: 0.25, yM: 0.1 },
      { xM: 0.2, yM: 0.1 },
    ],
  }),
  Math.PI * Math.pow(0.05 / 2, 2) * 0.05 * 2 * 3200,
  "motor mass from X diameter and Y length",
);
approx(
  motorMassEstimate({
    id: "motor-stale-manual",
    role: "part",
    partType: "motor",
    label: "Motor stale manual",
    drawMode: "line",
    massKg: 0.78,
    points: [
      { xM: 0.2, yM: 0.15 },
      { xM: 0.25, yM: 0.15 },
      { xM: 0.25, yM: 0.1 },
      { xM: 0.2, yM: 0.1 },
    ],
  }),
  Math.PI * Math.pow(0.05 / 2, 2) * 0.05 * 2 * 3200,
  "motor mass ignores stale manual mass and uses X diameter/Y length volume",
);
approx(
  motorMassEstimate({
    id: "motor-line",
    role: "part",
    partType: "motor",
    label: "Motor line",
    drawMode: "line",
    points: [
      { xM: 0.2, yM: 0.15 },
      { xM: 0.25, yM: 0.15 },
    ],
  }),
  Math.PI * Math.pow(0.1 / 2, 2) * 2 * 0.02 * 3200,
  "center-axis motor fallback mass from radial X handle and minimum Y length",
);
const rotorShape = {
  id: "rotor",
  role: "part",
  partType: "rotor",
  massKg: 0,
  rotorBladeCount: 2,
  label: "Rotor",
  drawMode: "line",
  points: [
    { xM: 0.2, yM: 0.1 },
    { xM: 0.5, yM: 0.1 },
  ],
};
const rotorDiameterM = 0.6;
const rotorMassPerRotorKg = 2 * (rotorDiameterM / 2) * 0.92 * ((rotorDiameterM * 0.055 + rotorDiameterM * 0.028) / 2) * (rotorDiameterM * 0.003) * 1600;
approx(rotorMassPerRotorEstimate(rotorShape), rotorMassPerRotorKg, "carbon fibre rotor mass per rotor");
approx(rotorTotalMassEstimate(rotorShape), rotorMassPerRotorKg * 2, "off-axis rotor mirrors across origin");
approx(rotorTotalMassEstimate({ ...rotorShape, massKg: 0 }), rotorMassPerRotorKg * 2, "rotor total ignores stale manual zero mass");
approx(analysis.totalMassKg, totalMassKg, "total mass");
approx(analysis.wingAreaM2, wingSurfaceAreaM2, "mirrored wing area");
approx(analysis.meanChordM, 0.2, "mean chord");
approx(analysis.com.xM, 0, "symmetric CoM x");
approx(analysis.com.yM, expectedComY, "mass-weighted CoM y");
approx(analysis.cop.xM, 0, "symmetric CoP x");
approx(analysis.cop.yM, 0.05, "quarter-chord CoP y");

const tailProject = {
  mission: project.mission,
  shapes: [
    project.shapes[1],
    {
      id: "tail",
      role: "liftingSurface",
      liftingSurfaceKind: "tailplane",
      label: "Tail",
      drawMode: "line",
      bodyMaterial: "carbonFibre",
      bodyThicknessMm: 1.2,
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
const tailEffectiveness = 0.9;
const expectedTailWeightedCop =
  (0.05 * wingSurfaceAreaM2 + (-0.68 - 0.08 * 0.25) * tailArea * tailEffectiveness) /
  (wingSurfaceAreaM2 + tailArea * tailEffectiveness);
approx(tailAnalysis.cop.yM, expectedTailWeightedCop, "effectiveness-weighted wing and tailplane CoP");
approx(tailAnalysis.wingAreaM2, wingSurfaceAreaM2, "wing reference area ignores tailplane");

const localMirroredTailProject = {
  mission: project.mission,
  shapes: [
    project.shapes[1],
    {
      id: "tail-mirror",
      role: "mirrorPlane",
      label: "Tail mirror",
      drawMode: "line",
      points: [
        { xM: 0.25, yM: -0.8 },
        { xM: 0.25, yM: -0.6 },
      ],
    },
    {
      id: "tail-half",
      role: "liftingSurface",
      liftingSurfaceKind: "tailplane",
      label: "Tail half",
      drawMode: "line",
      bodyMaterial: "carbonFibre",
      bodyThicknessMm: 1.2,
      points: [
        { xM: 0.25, yM: -0.68 },
        { xM: 0.5, yM: -0.68 },
        { xM: 0.5, yM: -0.76 },
        { xM: 0.25, yM: -0.76 },
      ],
    },
  ],
};
const localMirroredTailArea = 0.25 * 0.08 * 2 * 2;
const localMirroredTailAnalysis = computeSizingAnalysis(localMirroredTailProject);
approx(
  liftingSurfaceSkinAreaEstimate(localMirroredTailProject.shapes[2], localMirroredTailProject.shapes),
  localMirroredTailArea,
  "tailplane mirrors locally, then mirrors across origin",
);
const expectedLocalMirroredTailCop =
  (0.05 * wingSurfaceAreaM2 + (-0.68 - 0.08 * 0.25) * localMirroredTailArea * tailEffectiveness) /
  (wingSurfaceAreaM2 + localMirroredTailArea * tailEffectiveness);
approx(localMirroredTailAnalysis.cop.yM, expectedLocalMirroredTailCop, "local mirrored tailplane contributes doubled aerodynamic area");

const distantMirrorPlaneTail = {
  mission: project.mission,
  shapes: [
    {
      id: "short-mirror",
      role: "mirrorPlane",
      label: "Short mirror",
      drawMode: "line",
      points: [
        { xM: 0.25, yM: 0.4 },
        { xM: 0.25, yM: 0.6 },
      ],
    },
    localMirroredTailProject.shapes[2],
  ],
};
approx(
  liftingSurfaceSkinAreaEstimate(distantMirrorPlaneTail.shapes[1], distantMirrorPlaneTail.shapes),
  0.25 * 0.08 * 2,
  "local mirror only applies when geometry touches the drawn mirror segment",
);

const canardProject = {
  mission: project.mission,
  shapes: [
    project.shapes[1],
    {
      id: "canard",
      role: "liftingSurface",
      liftingSurfaceKind: "canard",
      label: "Canard",
      drawMode: "line",
      bodyMaterial: "carbonFibre",
      bodyThicknessMm: 1.2,
      points: [
        { xM: 0, yM: 0.7 },
        { xM: 0.35, yM: 0.7 },
        { xM: 0.35, yM: 0.62 },
        { xM: 0, yM: 0.62 },
      ],
    },
  ],
};
const canardAnalysis = computeSizingAnalysis(canardProject);
assert.ok(canardAnalysis.cop.yM > analysis.cop.yM, "canard pulls neutral point forward");

console.log("Sizing engine validation passed.");

function approx(actual, expected, label, tolerance = 1e-9) {
  assert.ok(
    Math.abs(actual - expected) <= tolerance,
    `${label}: expected ${expected}, got ${actual}`,
  );
}
