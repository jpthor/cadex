import assert from "node:assert/strict";
import {
  cadGeometryForShape,
  dimensionTargetPoints,
  frontProjectionShape,
  frontSectionCenterX,
  measureDimension,
  motorDiameterM,
  motorLengthM,
  partZHeightM,
  rotorDiskDiameterM,
  sideProjectionShapeFinal,
} from "../src/sketch/geometry.ts";

const origin = { xM: 0, yM: 0 };

const battery = {
  id: "battery",
  role: "part",
  partType: "battery",
  label: "Battery",
  drawMode: "line",
  points: [
    { xM: 0, yM: -1.0 },
    { xM: 0.3, yM: -1.0 },
    { xM: 0.3, yM: -2.0 },
    { xM: 0, yM: -2.0 },
  ],
};
const centerlineBattery = {
  id: "centerline-battery",
  role: "part",
  partType: "battery",
  label: "Centerline Battery",
  drawMode: "line",
  points: [
    { xM: 0, yM: -0.1 },
    { xM: 0.11, yM: -0.1 },
    { xM: 0.11, yM: -0.46 },
    { xM: 0, yM: -0.46 },
  ],
};

const payload = {
  id: "payload",
  role: "part",
  partType: "payload",
  label: "Payload",
  drawMode: "line",
  massKg: 2,
  points: [
    { xM: 0.1, yM: -0.2 },
    { xM: 0.35, yM: -0.2 },
    { xM: 0.35, yM: -0.6 },
    { xM: 0.1, yM: -0.6 },
  ],
};

const motor = {
  id: "motor",
  role: "part",
  partType: "motor",
  label: "Motor",
  drawMode: "line",
  points: [
    { xM: 0.5, yM: -1.1 },
    { xM: 0.7, yM: -1.1 },
    { xM: 0.7, yM: -1.5 },
    { xM: 0.5, yM: -1.5 },
  ],
};

const rotor = {
  id: "rotor",
  role: "part",
  partType: "rotor",
  label: "Rotor",
  drawMode: "line",
  points: [
    { xM: 0.5, yM: -1.1 },
    { xM: 0.9, yM: -1.1 },
  ],
};

const body = {
  id: "body",
  role: "body",
  label: "Body",
  drawMode: "line",
  points: [
    { xM: 0, yM: 0 },
    { xM: 0.25, yM: -0.2 },
    { xM: 0.25, yM: -1.2 },
    { xM: 0, yM: -1.4 },
  ],
};

const wing = {
  id: "wing",
  role: "liftingSurface",
  liftingSurfaceKind: "wing",
  label: "Wing",
  drawMode: "line",
  airfoil: "NACA 0012",
  points: [
    { xM: 0, yM: -0.4 },
    { xM: 1, yM: -0.4 },
    { xM: 1, yM: -0.7 },
    { xM: 0, yM: -0.7 },
  ],
};

const shapes = [body, wing, battery, payload, motor, rotor];
const tailboomMirror = {
  id: "tailboom-mirror",
  role: "mirrorPlane",
  label: "Tailboom Mirror",
  drawMode: "line",
  points: [
    { xM: 0.45, yM: -0.4 },
    { xM: 0.45, yM: -1.4 },
  ],
};
const tailboomBody = {
  id: "tailboom-body",
  role: "body",
  label: "Tailboom",
  drawMode: "line",
  points: [
    { xM: 0.45, yM: -0.1 },
    { xM: 0.55, yM: -0.1 },
    { xM: 0.55, yM: -0.8 },
    { xM: 0.45, yM: -0.8 },
  ],
};
const snappedFuselageBody = {
  id: "snapped-fuselage-body",
  role: "body",
  label: "Snapped Fuselage",
  drawMode: "line",
  points: [
    { xM: 0, yM: 0 },
    { xM: 0.1, yM: 0, snapAttachment: { kind: "segment", shapeId: "fuselage-reference", segmentIndex: 0, t: 0.5 } },
    { xM: 0.1, yM: -1, snapAttachment: { kind: "segment", shapeId: "fuselage-reference", segmentIndex: 0, t: 0.5 } },
    { xM: 0, yM: -1 },
  ],
};
const fuselageReference = {
  id: "fuselage-reference",
  role: "referenceLine",
  label: "Fuselage Reference",
  drawMode: "line",
  points: [
    { xM: 0.1, yM: 0.2 },
    { xM: 0.1, yM: -1.2 },
  ],
};
const dimensionShapes = [
  {
    id: "reference-a",
    role: "referenceLine",
    label: "Reference A",
    drawMode: "line",
    points: [
      { xM: 0, yM: 0 },
      { xM: 1, yM: 0 },
    ],
  },
  {
    id: "reference-b",
    role: "referenceLine",
    label: "Reference B",
    drawMode: "line",
    points: [
      { xM: 0.25, yM: 0.35 },
      { xM: 1.25, yM: 0.35 },
    ],
  },
  {
    id: "plain-edge",
    role: "liftingSurface",
    liftingSurfaceKind: "wing",
    label: "Plain Edge",
    drawMode: "line",
    points: [
      { xM: 0, yM: 0 },
      { xM: 1, yM: 0 },
    ],
  },
];

assertPartProjection("battery", battery, {
  sideHeightM: 0.3,
  sideLengthM: 1.0,
  frontHeightM: 0.3,
});
assert.deepEqual(cadGeometryForShape(battery), {
  kind: "box",
  centerM: [-1.5, 0, 0],
  sizeM: [1, 0.6, 0.3],
}, "centerline battery top-down sketch creates a full-width 3D box primitive at Z=0");
const centerlineBatteryFront = frontProjectionShape(centerlineBattery, 1, shapes);
approx(Math.min(...centerlineBatteryFront.points.map((point) => point.xM)), 0, "centerline battery front view starts on Y-axis");
approx(Math.max(...centerlineBatteryFront.points.map((point) => point.xM)), 0.11, "centerline battery front view keeps full half-width");
assertPartProjection("payload", payload, {
  sideHeightM: 0.25,
  sideLengthM: 0.4,
  frontHeightM: 0.25,
});

const motorSide = sideProjectionShapeFinal(motor, shapes);
approx(range(motorSide.points, "xM"), motorDiameterM(motor), "motor side view diameter");
approx(range(motorSide.points, "yM"), motorLengthM(motor), "motor side view length");
assert(range(motorSide.points, "xM") > 0.02, "motor side view must not collapse to a line");
assert.equal(cadGeometryForShape(motor)?.kind, "cylinder", "motor creates a 3D cylinder primitive");
approx(cadGeometryForShape(motor)?.radiusM ?? NaN, 0.1, "motor X extent creates cylinder radius");
approx(cadGeometryForShape(motor)?.lengthM ?? NaN, 0.4, "motor Y extent creates cylinder length");
assert.deepEqual(cadGeometryForShape(motor)?.axisM, [1, 0, 0], "motor axis follows top-down Y length");
approx(cadGeometryForShape(motor)?.centerM[2] ?? NaN, 0, "motor centre is located at Z=0");

const rotorSide = sideProjectionShapeFinal(rotor, shapes);
approx(range(rotorSide.points, "xM"), rotorDiskDiameterM(rotor), "rotor side view disk diameter");
assert(range(rotorSide.points, "xM") > 0.7, "rotor side view must show both blade sides");
assert.equal(cadGeometryForShape(rotor)?.kind, "rotor", "rotor creates a 3D rotor primitive");
approx(cadGeometryForShape(rotor)?.centerM[2] ?? NaN, 0, "rotor centre is located at Z=0");

const bodySide = sideProjectionShapeFinal(body, shapes);
approx(range(bodySide.points, "xM"), 0.5, "body side view height equals mirrored body width");
approx(range(bodySide.points, "yM"), 1.4, "body side view length equals body length");
assert.equal(cadGeometryForShape(body)?.kind, "revolvedBody", "body creates a revolved body primitive");
assert.equal(cadGeometryForShape(body)?.profile?.length, body.points.length, "revolved body CAD keeps the source revolve profile");
approx(bodySide.points[0].xM, 0, "revolved body side profile keeps the sharp centerline nose");
approx(bodySide.points[0].yM, 0, "revolved body side profile starts at the source nose station");
approx(frontSectionCenterX(snappedFuselageBody, [fuselageReference]), 0, "body touching Y-axis keeps Y as revolve axis over snapped references");
const snappedFuselageFront = frontProjectionShape(snappedFuselageBody, 1, [fuselageReference]);
approx(Math.min(...snappedFuselageFront.points.map((point) => point.xM)), 0, "Y-axis body front section starts on the revolve axis");
approx(Math.max(...snappedFuselageFront.points.map((point) => point.xM)), 0.1, "Y-axis body front section uses body radius from Y-axis");
const tailboomCad = cadGeometryForShape(tailboomBody, [tailboomMirror]);
assert.equal(tailboomCad?.kind, "revolvedBody", "body touching a created mirror plane creates a revolved body");
approx(tailboomCad?.centerM[1] ?? NaN, 0.45, "local mirror body revolves around touched mirror plane X");
approx(tailboomCad?.radiusM ?? NaN, 0.1, "local mirror body radius comes from distance to touched mirror plane");
assert.deepEqual(tailboomCad?.axisM, [1, 0, 0], "vertical local mirror body axis follows the mirror plane");
const tailboomSide = sideProjectionShapeFinal(tailboomBody, [tailboomMirror]);
approx(range(tailboomSide.points, "xM"), 0.2, "local mirror body side view height is the revolved diameter");
approx(range(tailboomSide.points, "yM"), 0.7, "local mirror body side view length follows the body on its mirror plane");
approx(Math.min(...tailboomSide.points.map((point) => point.yM)), -0.8, "local mirror body side view keeps the aircraft Y location");
approx(Math.max(...tailboomSide.points.map((point) => point.yM)), -0.1, "local mirror body side view does not shift to mirror-line local coordinates");

const wingFront = frontProjectionShape(wing, 1, shapes);
approx(range(wingFront.points, "xM"), 1.0, "wing front view span");
approx(range(wingFront.points, "yM"), 0.036, "wing front view root/tip thickness from 12% chord");
assert(range(wingFront.points, "yM") > 0.02, "wing front view must not taper to zero thickness");
assert.equal(cadGeometryForShape(wing)?.kind, "liftingSurface", "wing creates a lifting surface primitive");
const wingSide = sideProjectionShapeFinal(wing, shapes);
assert.equal(wingSide.points.filter((point) => point.pathBreak).length, 1, "wing side view renders separate root and tip airfoil profiles");
approx(range(wingSide.points, "xM"), 0.036, "wing side view root/tip airfoil thickness from 12% chord", 1e-4);
approx(range(wingSide.points, "yM"), 0.3, "wing side view root/tip airfoil chord is located from the drawn wing chord");

approx(
  measureDimension(
    { kind: "segment", shapeId: "reference-a", segmentIndex: 0, t: 0.9 },
    { kind: "segment", shapeId: "reference-b", segmentIndex: 0, t: 0.1 },
    dimensionShapes,
  ),
  0.35,
  "reference line dimension measures line-to-line distance, not clicked points",
);
approx(
  measureDimension(
    { kind: "node", shapeId: "reference-a", pointIndex: 1 },
    { kind: "node", shapeId: "reference-b", pointIndex: 0 },
    dimensionShapes,
  ),
  Math.hypot(0.75, 0.35),
  "node dimension measures node-to-node distance",
);
const plainEdgePoints = dimensionTargetPoints(
  { kind: "segment", shapeId: "plain-edge", segmentIndex: 0, t: 0.9 },
  { kind: "segment", shapeId: "reference-b", segmentIndex: 0, t: 0.1 },
  dimensionShapes,
);
approx(plainEdgePoints?.start.xM ?? NaN, 0.9, "non-reference segment dimensions keep clicked X location");
approx(plainEdgePoints?.start.yM ?? NaN, 0, "non-reference segment dimensions keep clicked Y location");

console.log("Sketch projection validation passed.");

function assertPartProjection(name, shape, expected) {
  const side = sideProjectionShapeFinal(shape, shapes);
  const front = frontProjectionShape(shape, 1, shapes);
  approx(partZHeightM(shape), expected.sideHeightM, `${name} solved Z height from top-down footprint`);
  approx(range(side.points, "xM"), expected.sideHeightM, `${name} side view height`);
  approx(range(side.points, "yM"), expected.sideLengthM, `${name} side view length`);
  approx(range(front.points, "yM"), expected.frontHeightM, `${name} front view height`);
  assert(range(side.points, "xM") > 0.02, `${name} side view must not collapse to a line`);
}

function range(points, key) {
  return Math.max(...points.map((point) => point[key])) - Math.min(...points.map((point) => point[key]));
}

function approx(actual, expected, label, tolerance = 1e-6) {
  assert.ok(
    Math.abs(actual - expected) <= tolerance,
    `${label}: expected ${expected}, got ${actual}`,
  );
}
