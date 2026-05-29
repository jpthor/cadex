import assert from "node:assert/strict";
import {
  cadGeometryForShape,
  dimensionTargetPoints,
  effectiveZOffsetM,
  frontProjectionShape,
  frontSectionCenterX,
  liftingSurfaceCenterZAtX,
  liftingSurfaceZStations,
  measureDimension,
  mirrorPoints,
  mirrorPointsAcrossPlane,
  motorDiameterM,
  motorLengthM,
  partZHeightM,
  pathForPoints,
  projectedShape,
  rotorDiskDiameterM,
  sideProjectionShapeFinal,
  shapePlacementZ,
  topViewReferenceLine3DPoints,
  topProjectionShape,
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
const lex = {
  id: "lex",
  role: "liftingSurface",
  liftingSurfaceKind: "lex",
  label: "LEX",
  drawMode: "line",
  points: [
    { xM: 0, yM: -0.1 },
    { xM: 0.35, yM: -0.35 },
    { xM: 0, yM: -0.42 },
  ],
};

const shapes = [body, wing, lex, battery, payload, motor, rotor];
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
const sideMirrorPlane = {
  id: "side-mirror-plane",
  role: "mirrorPlane",
  label: "Side Mirror Plane",
  drawMode: "line",
  sketchViewMode: "side",
  sideViewStationId: "fuselage-reference",
  points: [
    { xM: 0.2, yM: -0.4 },
    { xM: 0.8, yM: -1.2 },
  ],
};
const sideReferenceLine = {
  id: "side-reference-line",
  role: "referenceLine",
  label: "Side Reference Line",
  drawMode: "line",
  sketchViewMode: "side",
  sideViewStationId: "fuselage-reference",
  points: [
    { xM: 0.2, yM: -0.4 },
    { xM: 0.8, yM: -1.2 },
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
approx(Math.min(...centerlineBatteryFront.points.map((point) => point.xM)), 0, "centerline battery front view starts on X-axis mirror");
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
approx(frontSectionCenterX(snappedFuselageBody, [fuselageReference]), 0, "body touching X-axis mirror keeps it as revolve axis over snapped references");
const snappedFuselageFront = frontProjectionShape(snappedFuselageBody, 1, [fuselageReference]);
approx(Math.min(...snappedFuselageFront.points.map((point) => point.xM)), 0, "X-axis mirror body front section starts on the revolve axis");
approx(Math.max(...snappedFuselageFront.points.map((point) => point.xM)), 0.1, "X-axis mirror body front section uses body radius from mirror axis");
const fuselageReferenceFront = frontProjectionShape(fuselageReference, 1, [fuselageReference]);
approx(range(fuselageReferenceFront.points, "xM"), 0, "top-authored vertical reference line front view stays at one X station");
approx(range(fuselageReferenceFront.points, "yM"), 0, "top-authored vertical reference line front view collapses to one Z station");
approx(fuselageReferenceFront.points[0].xM, 0.1, "top-authored vertical reference line keeps reference X station");
const sideMirrorFront = frontProjectionShape(sideMirrorPlane, 1, [fuselageReference, sideMirrorPlane]);
approx(range(sideMirrorFront.points, "xM"), 0, "side-authored mirror plane front view is edge-on at one station");
approx(sideMirrorFront.points[0].xM, 0.1, "side-authored mirror plane front view uses its station reference");
approx(range(sideMirrorFront.points, "yM"), 0.6, "side-authored mirror plane front view keeps its vertical Z extent");
const sideReferenceFront = frontProjectionShape(sideReferenceLine, 1, [fuselageReference, sideReferenceLine]);
approx(range(sideReferenceFront.points, "xM"), 0, "side-authored reference line front view collapses to one X station");
approx(range(sideReferenceFront.points, "yM"), 0, "side-authored reference line front view collapses to one Z height");
approx(sideReferenceFront.points[0].yM, 0.5, "side-authored reference line front view keeps positive side sketch X as positive aircraft Z");
approx(sideReferenceFront.points[0].xM, 0.1, "side-authored reference line front view uses its station reference");
const podZStation = {
  ...sideReferenceLine,
  id: "pod-z-station",
  label: "PodZ",
  points: [
    { xM: 0.1, yM: -0.4 },
    { xM: 0.1, yM: -1.2 },
  ],
};
const podZTopReference = {
  id: "pod-z-top-reference",
  role: "referenceLine",
  label: "Pod Z top reference",
  drawMode: "line",
  zStationId: "pod-z-station",
  points: [
    { xM: 0.2, yM: 0 },
    { xM: 0.2, yM: -0.8 },
  ],
};
const podZTopReferenceFront = frontProjectionShape(podZTopReference, 1, [podZStation, podZTopReference]);
approx(podZTopReferenceFront.points[0].yM, 0.1, "top reference assigned to PodZ +100 mm renders at +100 mm Z in front view");
const podZTopReference3D = topViewReferenceLine3DPoints(podZTopReference, [podZStation, podZTopReference]);
approx(range(podZTopReference3D, "xM"), 0, "top vertical reference line 3D preview stays at one X station");
approx(range(podZTopReference3D, "yM"), 0.8, "top vertical reference line 3D preview preserves aircraft Y length");
approx(range(podZTopReference3D, "zM"), 0, "top vertical reference line 3D preview stays at one Z station");
approx(podZTopReference3D[0].xM, 0.2, "top vertical reference line 3D preview uses top-view X station");
approx(podZTopReference3D[0].zM, 0.1, "top vertical reference line 3D preview uses selected Z station");
const sideReferenceTop = topProjectionShape(sideReferenceLine, [fuselageReference, sideReferenceLine]);
approx(range(sideReferenceTop.points, "xM"), 0, "side-authored reference line top view stays at one station");
approx(sideReferenceTop.points[0].xM, 0.1, "side-authored reference line top view uses its station reference");
approx(range(sideReferenceTop.points, "yM"), 0.8, "side-authored reference line top view keeps aircraft Y length");
const zStationedTopReference = { ...fuselageReference, id: "z-stationed-top-reference", zStationId: sideReferenceLine.id };
const zStationedTopFront = frontProjectionShape(zStationedTopReference, 1, [sideReferenceLine, zStationedTopReference]);
approx(range(zStationedTopFront.points, "yM"), 0, "z-stationed top-view reference line front view remains a single point");
approx(zStationedTopFront.points[0].yM, 0.5, "top-view reference line can use a side-view line as a non-zero Z station in front view");
const zStationedTopSide = sideProjectionShapeFinal(zStationedTopReference, [sideReferenceLine, zStationedTopReference]);
approx(range(zStationedTopSide.points, "xM"), 0, "top-view reference line side view stays at one selected Z station");
approx(zStationedTopSide.points[0].xM, 0.5, "top-view reference line side view uses selected side reference as Z station");
const dihedralSnapWing = {
  id: "dihedral-snap-wing",
  role: "liftingSurface",
  liftingSurfaceKind: "wing",
  label: "Dihedral Snap Wing",
  drawMode: "line",
  points: [
    { xM: 0, yM: -0.2, snapAttachment: { kind: "segment", shapeId: "implicit-x-axis-mirror", segmentIndex: 0, t: 0.5 } },
    { xM: 0.2, yM: -0.2, snapAttachment: { kind: "segment", shapeId: "pod-z-top-reference", segmentIndex: 0, t: 0.5 } },
    { xM: 0.2, yM: -0.5, snapAttachment: { kind: "segment", shapeId: "pod-z-top-reference", segmentIndex: 0, t: 0.5 } },
    { xM: 0, yM: -0.5, snapAttachment: { kind: "segment", shapeId: "implicit-x-axis-mirror", segmentIndex: 0, t: 0.5 } },
  ],
};
const dihedralSnapShapes = [podZStation, podZTopReference, dihedralSnapWing];
const dihedralStations = liftingSurfaceZStations(dihedralSnapWing, dihedralSnapShapes);
approx(dihedralStations[0].zM, 0, "lifting surface root snapped to origin axis uses Z=0");
approx(dihedralStations[1].zM, 0.1, "lifting surface tip snapped to Podline uses its Z station");
approx(liftingSurfaceCenterZAtX(dihedralSnapWing, dihedralSnapShapes, 0.1), 0.05, "lifting surface Z interpolates between root and snapped tip");
const dihedralSnapFront = frontProjectionShape(dihedralSnapWing, 1, dihedralSnapShapes);
approx(Math.min(...dihedralSnapFront.points.filter((point) => Math.abs(point.xM - 0) < 0.001).map((point) => point.yM)), -0.018, "front dihedral root section is centered on Z=0");
approx(Math.max(...dihedralSnapFront.points.filter((point) => Math.abs(point.xM - 0.2) < 0.001).map((point) => point.yM)), 0.118, "front dihedral tip section is centered on snapped Z station");
const podlineSnappedMotor = {
  id: "podline-snapped-motor",
  role: "part",
  partType: "motor",
  label: "Podline Motor",
  drawMode: "line",
  points: [
    { xM: 0.2, yM: -0.2, snapAttachment: { kind: "segment", shapeId: "pod-z-top-reference", segmentIndex: 0, t: 0.5 } },
    { xM: 0.24, yM: -0.34 },
  ],
};
const podlineSnappedRotor = {
  id: "podline-snapped-rotor",
  role: "part",
  partType: "rotor",
  label: "Podline Rotor",
  drawMode: "line",
  points: [
    { xM: 0.2, yM: -0.2, snapAttachment: { kind: "segment", shapeId: "pod-z-top-reference", segmentIndex: 0, t: 0.5 } },
    { xM: 0.34, yM: -0.2 },
  ],
};
const podlineSnappedBattery = {
  id: "podline-snapped-battery",
  role: "part",
  partType: "battery",
  label: "Podline Battery",
  drawMode: "line",
  points: [
    { xM: 0.2, yM: -0.2, snapAttachment: { kind: "segment", shapeId: "pod-z-top-reference", segmentIndex: 0, t: 0.5 } },
    { xM: 0.32, yM: -0.2 },
    { xM: 0.32, yM: -0.5 },
    { xM: 0.2, yM: -0.5 },
  ],
};
const snappedPartShapes = [podZStation, podZTopReference, podlineSnappedMotor, podlineSnappedRotor, podlineSnappedBattery];
approx(shapePlacementZ(podlineSnappedMotor, snappedPartShapes), 0.1, "motor inherits Z station from snapped Podline");
approx(cadGeometryForShape(podlineSnappedMotor, snappedPartShapes)?.centerM[2] ?? NaN, 0.1, "motor CAD centre inherits snapped reference Z");
approx(cadGeometryForShape(podlineSnappedRotor, snappedPartShapes)?.centerM[2] ?? NaN, 0.1, "rotor CAD centre inherits snapped reference Z");
approx(cadGeometryForShape(podlineSnappedBattery, snappedPartShapes)?.centerM[2] ?? NaN, 0.1, "box part CAD centre inherits snapped reference Z");
const zStationedMirrorPlane = {
  id: "z-stationed-mirror-plane",
  role: "mirrorPlane",
  label: "Mirror Podline",
  drawMode: "line",
  zStationId: "pod-z-station",
  points: [
    { xM: 0.2, yM: -0.2 },
    { xM: 0.2, yM: -0.7 },
  ],
};
const zStationedMirrorBody = {
  id: "z-stationed-mirror-body",
  role: "body",
  label: "Mirrored Body",
  drawMode: "line",
  points: [
    { xM: 0.2, yM: -0.25 },
    { xM: 0.28, yM: -0.28 },
    { xM: 0.28, yM: -0.64 },
    { xM: 0.2, yM: -0.68 },
  ],
};
const zMirrorShapes = [podZStation, zStationedMirrorPlane, zStationedMirrorBody];
const zMirrorBodyCad = cadGeometryForShape(zStationedMirrorBody, zMirrorShapes);
approx(zMirrorBodyCad?.centerM[2] ?? NaN, 0.1, "body mirrored around a z-stationed mirror plane inherits the mirror plane Z");
approx(effectiveZOffsetM(zStationedMirrorPlane, zMirrorShapes), 0.1, "mirror plane resolves its selected Z station");
const zStationedMirrorWing = {
  id: "z-stationed-mirror-wing",
  role: "liftingSurface",
  liftingSurfaceKind: "wing",
  label: "Wing On Mirror Plane",
  drawMode: "line",
  points: [
    { xM: 0.2, yM: -0.2 },
    { xM: 0.5, yM: -0.2 },
    { xM: 0.5, yM: -0.5 },
    { xM: 0.2, yM: -0.5 },
  ],
};
const zMirrorWingShapes = [podZStation, zStationedMirrorPlane, zStationedMirrorWing];
const zMirrorWingStations = liftingSurfaceZStations(zStationedMirrorWing, zMirrorWingShapes);
approx(zMirrorWingStations[0].zM, 0.1, "lifting surface touching a z-stationed mirror plane inherits that plane Z at root");
approx(zMirrorWingStations[zMirrorWingStations.length - 1].zM, 0.1, "lifting surface touching a z-stationed mirror plane inherits that plane Z at tip");
approx(cadGeometryForShape(zStationedMirrorWing, zMirrorWingShapes)?.rootLeadingEdgeM[2] ?? NaN, 0.1, "wing CAD root inherits touched mirror plane Z");
const zMirrorWingFront = frontProjectionShape(zStationedMirrorWing, 1, zMirrorWingShapes);
approx((Math.max(...zMirrorWingFront.points.map((point) => point.yM)) + Math.min(...zMirrorWingFront.points.map((point) => point.yM))) / 2, 0.1, "wing front projection is centered on touched mirror plane Z");
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
const lexFront = frontProjectionShape(lex, 1, shapes);
const lexSide = sideProjectionShapeFinal(lex, shapes);
approx(range(lexFront.points, "yM"), 0, "LEX front view has no vertical extent");
approx(range(lexSide.points, "xM"), 0, "LEX side view has no vertical extent");
approx(range(lexSide.points, "yM"), 0.32, "LEX side view keeps the drawn longitudinal profile");

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
const splineMirrorSource = [
  { xM: 0, yM: -0.1, curveMode: "spline", segmentOutMode: "spline", tangentOut: { xM: 0.08, yM: -0.04 } },
  { xM: 0.25, yM: -0.35, curveMode: "spline", segmentInMode: "spline", tangentIn: { xM: -0.04, yM: 0.08 } },
];
const originMirroredSpline = mirrorPoints(splineMirrorSource);
assert.equal(originMirroredSpline[0].segmentOutMode, "spline", "origin mirror preserves spline segment mode");
approx(originMirroredSpline[0].tangentOut.xM, -0.08, "origin mirror reflects tangent X");
approx(originMirroredSpline[0].tangentOut.yM, -0.04, "origin mirror preserves tangent Y");
const localMirroredSpline = mirrorPointsAcrossPlane(splineMirrorSource, {
  id: "vertical-mirror",
  role: "mirrorPlane",
  label: "Vertical Mirror",
  drawMode: "line",
  points: [
    { xM: 0.1, yM: -1 },
    { xM: 0.1, yM: 1 },
  ],
});
assert.equal(localMirroredSpline[0].segmentOutMode, "spline", "local mirror preserves spline segment mode");
approx(localMirroredSpline[0].tangentOut.xM, -0.08, "local mirror reflects tangent X");
approx(localMirroredSpline[0].tangentOut.yM, -0.04, "local mirror preserves tangent Y");
const splicedBodyProjection = sideProjectionShapeFinal({
  id: "spliced-body",
  role: "body",
  label: "Spliced body",
  drawMode: "spline",
  points: [
    { xM: 0, yM: 0, curveMode: "corner", segmentOutMode: "spline" },
    { xM: 0.1, yM: -0.1, curveMode: "corner", segmentInMode: "spline", segmentOutMode: "spline" },
    { xM: 0.1, yM: -0.8, curveMode: "corner", segmentInMode: "spline", segmentOutMode: "spline" },
    { xM: 0, yM: -0.9, curveMode: "corner", segmentInMode: "spline" },
  ],
}, []);
assert.equal(
  pathForPoints(splicedBodyProjection.points, { width: 1000, height: 1000, originX: 500, originY: 100, scale: 100 }).includes(" C "),
  false,
  "corner splice nodes force straight side projection even if stale spline segment flags remain",
);
const splineBodyShape = {
  id: "spline-body",
  role: "body",
  label: "Spline body",
  drawMode: "spline",
  points: [
    { xM: 0, yM: 0, curveMode: "spline", segmentOutMode: "spline", tangentOut: { xM: 0.04, yM: -0.01 } },
    { xM: 0.1, yM: -0.12, curveMode: "spline", segmentInMode: "spline", tangentIn: { xM: -0.01, yM: 0.06 } },
    { xM: 0.1, yM: -0.78, curveMode: "spline", segmentOutMode: "spline", tangentOut: { xM: 0, yM: -0.06 } },
    { xM: 0, yM: -0.9, curveMode: "spline", segmentInMode: "spline", tangentIn: { xM: 0.03, yM: 0.01 } },
  ],
};
const splineBodyProjectionPath = pathForPoints(sideProjectionShapeFinal(splineBodyShape, []).points, { width: 1000, height: 1000, originX: 500, originY: 100, scale: 100 });
assert.equal(
  splineBodyProjectionPath.includes(" C "),
  true,
  "spline body side projection preserves authored curve tangents",
);
const renderedSplineBodyProjectionPath = pathForPoints(projectedShape(splineBodyShape, 1, [], "side").points, { width: 1000, height: 1000, originX: 500, originY: 100, scale: 100 });
assert.equal(
  renderedSplineBodyProjectionPath.includes(" C "),
  true,
  "final rendered side projection preserves authored curve tangents",
);

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
