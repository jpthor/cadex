import { useEffect, useMemo, useRef } from "react";
import * as THREE from "three";
import { ArcballControls } from "three/examples/jsm/controls/ArcballControls.js";
import type { SizeCadGeometry, SizePoint, SizeShape } from "../../sizing";
import type { CanvasViewMode } from "../types";
import {
  airfoilCamberAtStation,
  airfoilThicknessRatio,
  cadGeometryForShape,
  chordExtentsAtX,
  effectiveZOffsetM,
  incidenceAtStation,
  liftingSurfaceCenterZAtX,
  nacaSymmetricHalfThickness,
  shapeTouchesMirrorAxis,
  shapeTouchesMirrorPlane,
  sideViewStationX,
  topViewReferenceLine3DPoints,
  verticalReferenceX,
} from "../geometry";

type RevolvedBodyPreview = {
  axis: RevolveAxis;
  geometry: Extract<SizeCadGeometry, { kind: "revolvedBody" }>;
  id: string;
  label: string;
  mirrored?: boolean;
  movementTransform?: PreviewMovementTransform;
  profile: SizePoint[];
  shape: SizeShape;
};

type RevolveAxis = {
  end: SizePoint;
  label: string;
  start: SizePoint;
};

type LiftingSurfacePreview = {
  id: string;
  label: string;
  mirrored?: boolean;
  movementTransform?: PreviewMovementTransform;
  planform?: THREE.Vector3[];
  sections: THREE.Vector3[][];
};

type PartBoxPreview = {
  center: THREE.Vector3;
  id: string;
  label: string;
  mirrored?: boolean;
  movementTransform?: PreviewMovementTransform;
  size: THREE.Vector3;
};

type MotorCylinderPreview = {
  axis: THREE.Vector3;
  center: THREE.Vector3;
  id: string;
  label: string;
  lengthM: number;
  mirrored?: boolean;
  movementTransform?: PreviewMovementTransform;
  radiusM: number;
};

type RotorPreview = {
  bladeCount: number;
  center: THREE.Vector3;
  id: string;
  label: string;
  mirrored?: boolean;
  movementTransform?: PreviewMovementTransform;
  radial: THREE.Vector3;
  radiusM: number;
  rootChordM: number;
  tipChordM: number;
};

type PreviewMovementTransform = {
  angleDeg: number;
  axisEnd: THREE.Vector3;
  axisStart: THREE.Vector3;
};

export function Sketch3DPreview({
  active,
  cameraCommandSerial,
  onOrbitStart,
  selectedShapeId,
  showGuides,
  shapes,
  viewMode,
}: {
  active: boolean;
  cameraCommandSerial: number;
  onOrbitStart: () => void;
  selectedShapeId: string;
  showGuides: boolean;
  shapes: SizeShape[];
  viewMode: CanvasViewMode;
}) {
  const hostRef = useRef<HTMLDivElement | null>(null);
  const sceneRef = useRef<THREE.Scene | null>(null);
  const cameraRef = useRef<THREE.OrthographicCamera | null>(null);
  const controlsRef = useRef<ArcballControls | null>(null);
  const groupRef = useRef<THREE.Group | null>(null);
  const referenceGroupRef = useRef<THREE.Group | null>(null);
  const hasFitRef = useRef(false);

  const bodies = useMemo(() => revolvedBodiesForPreview(shapes), [shapes]);
  const liftingSurfaces = useMemo(() => liftingSurfacesForPreview(shapes), [shapes]);
  const partBoxes = useMemo(() => partBoxesForPreview(shapes), [shapes]);
  const motorCylinders = useMemo(() => motorCylindersForPreview(shapes), [shapes]);
  const rotors = useMemo(() => rotorsForPreview(shapes), [shapes]);
  const sideSketches = useMemo(() => sideSketchesForPreview(shapes), [shapes]);
  const referenceBounds = useMemo(() => referenceBoundsForPreview(shapes, bodies), [bodies, shapes]);

  useEffect(() => {
    if (!hostRef.current) return;
    const host = hostRef.current;
    const scene = new THREE.Scene();
    scene.background = new THREE.Color("#0c141d");
    sceneRef.current = scene;

    const aspect = host.clientWidth / Math.max(host.clientHeight, 1);
    const camera = new THREE.OrthographicCamera(-aspect, aspect, 1, -1, 0.001, 100);
    camera.position.set(0, 0, 1);
    cameraRef.current = camera;

    const renderer = new THREE.WebGLRenderer({ antialias: true, alpha: false });
    renderer.setPixelRatio(window.devicePixelRatio);
    renderer.setSize(host.clientWidth, host.clientHeight);
    renderer.domElement.className = "sketch-3d-canvas";
    host.appendChild(renderer.domElement);

    const controls = new ArcballControls(camera, renderer.domElement, scene);
    controls.adjustNearFar = true;
    controls.cursorZoom = true;
    controls.dampingFactor = 18;
    controls.enableAnimations = true;
    controls.enableFocus = false;
    controls.enablePan = true;
    controls.enableRotate = active;
    controls.enableZoom = true;
    controls.rotateSpeed = 1.25;
    controls.scaleFactor = 1.08;
    controls.setGizmosVisible(false);
    arcballTarget(controls).set(0, 0, 0);
    controlsRef.current = controls;
    controls.addEventListener("start", onOrbitStart);

    scene.add(new THREE.HemisphereLight("#e8f4fb", "#10202d", 1.7));
    const keyLight = new THREE.DirectionalLight("#ffffff", 2.4);
    keyLight.position.set(1.2, -1.6, 1.8);
    scene.add(keyLight);
    const fillLight = new THREE.DirectionalLight("#7dd3fc", 0.85);
    fillLight.position.set(-1.2, 0.8, 0.7);
    scene.add(fillLight);

    const referenceGroup = new THREE.Group();
    referenceGroupRef.current = referenceGroup;
    scene.add(referenceGroup);

    const group = new THREE.Group();
    groupRef.current = group;
    scene.add(group);

    const resize = () => {
      const aspect = host.clientWidth / Math.max(host.clientHeight, 1);
      const viewHeight = camera.top - camera.bottom;
      camera.left = (-viewHeight * aspect) / 2;
      camera.right = (viewHeight * aspect) / 2;
      camera.updateProjectionMatrix();
      renderer.setSize(host.clientWidth, host.clientHeight);
    };
    window.addEventListener("resize", resize);

    let frame = 0;
    const render = () => {
      frame = requestAnimationFrame(render);
      controls.update();
      renderer.render(scene, camera);
    };
    render();

    return () => {
      cancelAnimationFrame(frame);
      window.removeEventListener("resize", resize);
      controls.removeEventListener("start", onOrbitStart);
      controls.dispose();
      disposeObject(group);
      disposeObject(referenceGroup);
      renderer.dispose();
      if (renderer.domElement.parentElement === host) host.removeChild(renderer.domElement);
    };
  }, []);

  useEffect(() => {
    if (controlsRef.current) controlsRef.current.enableRotate = active;
  }, [active]);

  useEffect(() => {
    const referenceGroup = referenceGroupRef.current;
    if (!referenceGroup) return;
    referenceGroup.clear();
    if (showGuides) referenceGroup.add(createReferenceLayer(referenceBounds, shapes));
  }, [referenceBounds, shapes, showGuides]);

  useEffect(() => {
    const group = groupRef.current;
    const referenceGroup = referenceGroupRef.current;
    const camera = cameraRef.current;
    const controls = controlsRef.current;
    if (!group || !camera || !controls) return;

    group.clear();
    for (const body of bodies) {
      const bodyGroup = createRevolvedBodyGroup(body, body.id === selectedShapeId);
      group.add(bodyGroup);
    }
    for (const liftingSurface of liftingSurfaces) {
      group.add(createLiftingSurfaceGroup(liftingSurface, liftingSurface.id === selectedShapeId));
    }
    for (const partBox of partBoxes) {
      group.add(createPartBoxGroup(partBox, partBox.id === selectedShapeId));
    }
    for (const motor of motorCylinders) {
      group.add(createMotorCylinderGroup(motor, motor.id === selectedShapeId));
    }
    for (const rotor of rotors) {
      group.add(createRotorGroup(rotor, rotor.id === selectedShapeId));
    }
    for (const sideSketch of sideSketches) {
      group.add(createSideSketchGroup(sideSketch, sideSketch.id === selectedShapeId));
    }

    if (!hasFitRef.current || bodies.some((body) => body.id === selectedShapeId)) {
      fitCameraToGroups(camera, controls, [group, referenceGroup]);
      hasFitRef.current = bodies.length > 0 || liftingSurfaces.length > 0 || partBoxes.length > 0 || motorCylinders.length > 0 || rotors.length > 0;
    }
  }, [bodies, liftingSurfaces, motorCylinders, partBoxes, rotors, selectedShapeId, sideSketches]);

  useEffect(() => {
    const group = groupRef.current;
    const referenceGroup = referenceGroupRef.current;
    const camera = cameraRef.current;
    const controls = controlsRef.current;
    if (!group || !camera || !controls || (!bodies.length && !liftingSurfaces.length && !partBoxes.length && !motorCylinders.length && !rotors.length)) return;
    setCameraToView(camera, controls, [group, referenceGroup], active ? "orbit" : viewMode);
  }, [active, bodies.length, cameraCommandSerial, liftingSurfaces.length, motorCylinders.length, partBoxes.length, rotors.length, sideSketches.length, viewMode]);

  return (
    <div
      aria-label="3D sketch revolve preview"
      className={`sketch-3d-preview ${active ? "interactive" : ""}`}
      ref={hostRef}
    />
  );
}

function revolvedBodiesForPreview(shapes: SizeShape[]): RevolvedBodyPreview[] {
  return shapes.flatMap((shape) => {
    if (shape.role !== "body") return [];
    if (shape.sketchViewMode === "side") return [];
    const geometry = cadGeometryForShape(shape, shapes) ?? shape.cadGeometry;
    if (!geometry || geometry.kind !== "revolvedBody") return [];
    const axis = revolveAxisForShape(shape, shapes);
    const profile = geometry.profile?.length ? geometry.profile : shape.points.map((point) => ({ ...point, xM: Math.abs(point.xM) }));
    if (profile.length < 2) return [];
    const body = { axis, geometry, id: shape.id, label: shape.label, profile, shape };
    const previews = shouldMirrorAcrossImplicitX(shape) ? [body, mirroredBodyPreview(body)] : [body];
    return previews.map((preview) => ({
      ...preview,
      movementTransform: movementTransformForShape(shape, shapes, bodyPreviewCenter(preview)),
    }));
  });
}

function liftingSurfacesForPreview(shapes: SizeShape[]): LiftingSurfacePreview[] {
  return shapes.flatMap((shape) => {
    if (shape.role !== "liftingSurface" || shape.sketchViewMode === "side" || shape.points.length < 3) return [];
    const preview = liftingSurfacePreviewFromShape(shape, shapes);
    if (!preview) return [];
    const localMirrors = shapes
      .filter((candidate) => candidate.role === "mirrorPlane" && candidate.id !== shape.id && shapeTouchesMirrorPlane(shape, candidate))
      .map((plane, index) => mirrorLiftingSurfacePreviewAcrossPlane(preview, plane, index))
      .filter((entry): entry is LiftingSurfacePreview => Boolean(entry));
    const originMirrors = shouldMirrorLiftingSurfaceAcrossImplicitX(shape)
      ? [preview, ...localMirrors].map(mirrorLiftingSurfacePreview)
      : [];
    return [preview, ...localMirrors, ...originMirrors].map((surface) => ({
      ...surface,
      movementTransform: movementTransformForShape(shape, shapes, liftingSurfacePreviewCenter(surface)),
    }));
  });
}

function partBoxesForPreview(shapes: SizeShape[]): PartBoxPreview[] {
  return shapes.flatMap((shape) => {
    const partType = shape.partType ?? "payload";
    if (shape.role !== "part" || (partType !== "payload" && partType !== "battery") || shape.points.length < 3) return [];
    const geometry = cadGeometryForShape(shape, shapes) ?? shape.cadGeometry;
    if (!geometry || geometry.kind !== "box") return [];
    const centerline = shapeTouchesMirrorAxis(shape);
    const centerX = centerline ? 0 : geometry.centerM[1];
    const box = {
      center: new THREE.Vector3(centerX, geometry.centerM[0], geometry.centerM[2]),
      id: shape.id,
      label: shape.label,
      size: new THREE.Vector3(geometry.sizeM[1], geometry.sizeM[0], geometry.sizeM[2]),
    };
    const previews = shouldMirrorPartBoxAcrossImplicitY(shape) ? [box, mirrorPartBoxPreview(box)] : [box];
    return previews.map((preview) => ({
      ...preview,
      movementTransform: movementTransformForShape(shape, shapes, preview.center),
    }));
  });
}

function shouldMirrorPartBoxAcrossImplicitY(shape: SizeShape) {
  if (!shape.points.length || shapeTouchesMirrorAxis(shape)) return false;
  const minX = Math.min(...shape.points.map((point) => point.xM));
  const maxX = Math.max(...shape.points.map((point) => point.xM));
  return minX >= -0.001 && maxX > 0.001;
}

function mirrorPartBoxPreview(box: PartBoxPreview): PartBoxPreview {
  return {
    ...box,
    center: new THREE.Vector3(-box.center.x, box.center.y, box.center.z),
    id: `${box.id}:mirror-y`,
    label: `${box.label} mirror`,
    mirrored: true,
  };
}

function motorCylindersForPreview(shapes: SizeShape[]): MotorCylinderPreview[] {
  return shapes.flatMap((shape) => {
    if (shape.role !== "part" || shape.partType !== "motor" || shape.points.length < 2) return [];
    const geometry = cadGeometryForShape(shape, shapes) ?? shape.cadGeometry;
    if (!geometry || geometry.kind !== "cylinder") return [];
    const motor = {
      axis: new THREE.Vector3(geometry.axisM[1], geometry.axisM[0], geometry.axisM[2]).normalize(),
      center: new THREE.Vector3(geometry.centerM[1], geometry.centerM[0], geometry.centerM[2]),
      id: shape.id,
      label: shape.label,
      lengthM: geometry.lengthM,
      radiusM: geometry.radiusM,
    };
    const previews = shouldMirrorPartBoxAcrossImplicitY(shape) ? [motor, mirrorMotorCylinderPreview(motor)] : [motor];
    return previews.map((preview) => ({
      ...preview,
      movementTransform: movementTransformForShape(shape, shapes, preview.center),
    }));
  });
}

function mirrorMotorCylinderPreview(motor: MotorCylinderPreview): MotorCylinderPreview {
  return {
    ...motor,
    axis: new THREE.Vector3(-motor.axis.x, motor.axis.y, motor.axis.z).normalize(),
    center: new THREE.Vector3(-motor.center.x, motor.center.y, motor.center.z),
    id: `${motor.id}:mirror-y`,
    label: `${motor.label} mirror`,
    mirrored: true,
  };
}

function rotorsForPreview(shapes: SizeShape[]): RotorPreview[] {
  return shapes.flatMap((shape) => {
    if (shape.role !== "part" || shape.partType !== "rotor" || shape.points.length < 2) return [];
    const geometry = cadGeometryForShape(shape, shapes) ?? shape.cadGeometry;
    if (!geometry || geometry.kind !== "rotor") return [];
    const radial = new THREE.Vector3(geometry.axisM[1], geometry.axisM[0], geometry.axisM[2]).normalize();
    const rotor = {
      bladeCount: geometry.bladeCount,
      center: new THREE.Vector3(geometry.centerM[1], geometry.centerM[0], geometry.centerM[2]),
      id: shape.id,
      label: shape.label,
      radial: radial.lengthSq() > 1e-9 ? radial : new THREE.Vector3(1, 0, 0),
      radiusM: geometry.radiusM,
      rootChordM: geometry.rootChordM,
      tipChordM: geometry.tipChordM,
    };
    const previews = shouldMirrorPartBoxAcrossImplicitY(shape) ? [rotor, mirrorRotorPreview(rotor)] : [rotor];
    return previews.map((preview) => ({
      ...preview,
      movementTransform: movementTransformForShape(shape, shapes, preview.center),
    }));
  });
}

function mirrorRotorPreview(rotor: RotorPreview): RotorPreview {
  return {
    ...rotor,
    center: new THREE.Vector3(-rotor.center.x, rotor.center.y, rotor.center.z),
    id: `${rotor.id}:mirror-y`,
    label: `${rotor.label} mirror`,
    mirrored: true,
    radial: new THREE.Vector3(-rotor.radial.x, rotor.radial.y, rotor.radial.z).normalize(),
  };
}

function movementTransformForShape(shape: SizeShape, shapes: SizeShape[], previewCenter: THREE.Vector3): PreviewMovementTransform | undefined {
  const movement = shape.movement;
  if (!movement?.enabled || !movement.hingeLineId) return undefined;
  const referenceLine = shapes.find((candidate) => candidate.id === movement.hingeLineId && candidate.role === "referenceLine" && candidate.points.length >= 2);
  if (!referenceLine) return undefined;
  const axis = referenceLineAxisForPreview(referenceLine, shapes);
  if (!axis || axis.axisEnd.distanceToSquared(axis.axisStart) <= 1e-10) return undefined;
  const minDeg = clampNumber(movement.minDeg, -25, -90, 90);
  const maxDeg = clampNumber(movement.maxDeg, 25, -90, 90);
  const requestedAngle = clampNumber(movement.deflectionDeg, 0, -90, 90) - clampNumber(movement.neutralDeg, 0, -90, 90);
  const clampedAngle = Math.min(Math.max(requestedAngle, Math.min(minDeg, maxDeg)), Math.max(minDeg, maxDeg));
  if (Math.abs(clampedAngle) < 1e-6) return undefined;
  const axisCenterX = (axis.axisStart.x + axis.axisEnd.x) / 2;
  const shouldMirrorAxis = Math.abs(axisCenterX) > 0.001 && Math.abs(previewCenter.x) > 0.001 && Math.sign(axisCenterX) !== Math.sign(previewCenter.x);
  if (!shouldMirrorAxis) return { ...axis, angleDeg: clampedAngle };
  return {
    angleDeg: -clampedAngle,
    axisEnd: new THREE.Vector3(-axis.axisEnd.x, axis.axisEnd.y, axis.axisEnd.z),
    axisStart: new THREE.Vector3(-axis.axisStart.x, axis.axisStart.y, axis.axisStart.z),
  };
}

function referenceLineAxisForPreview(shape: SizeShape, shapes: SizeShape[]): Omit<PreviewMovementTransform, "angleDeg"> | undefined {
  const [start, end] = shape.points;
  if (!start || !end) return undefined;
  if (shape.sketchViewMode === "side") {
    const stationX = sideViewStationX(shape, shapes) ?? 0;
    const zOffset = effectiveZOffsetM(shape, shapes);
    return {
      axisEnd: new THREE.Vector3(stationX, end.yM, end.xM + zOffset),
      axisStart: new THREE.Vector3(stationX, start.yM, start.xM + zOffset),
    };
  }
  const points = topViewReferenceLine3DPoints(shape, shapes);
  if (points.length < 2) return undefined;
  return {
    axisEnd: new THREE.Vector3(points[1].xM, points[1].yM, points[1].zM),
    axisStart: new THREE.Vector3(points[0].xM, points[0].yM, points[0].zM),
  };
}

function liftingSurfacePreviewCenter(surface: LiftingSurfacePreview) {
  const points = surface.planform?.length ? surface.planform : surface.sections.flat();
  return vectorCenter(points);
}

function bodyPreviewCenter(body: RevolvedBodyPreview) {
  return new THREE.Vector3(
    (body.axis.start.xM + body.axis.end.xM) / 2,
    (body.axis.start.yM + body.axis.end.yM) / 2,
    body.geometry.centerM[2] ?? 0,
  );
}

function vectorCenter(points: THREE.Vector3[]) {
  if (!points.length) return new THREE.Vector3();
  return points.reduce((sum, point) => sum.add(point), new THREE.Vector3()).multiplyScalar(1 / points.length);
}

function clampNumber(value: unknown, fallback: number, min: number, max: number) {
  return typeof value === "number" && Number.isFinite(value) ? Math.min(Math.max(value, min), max) : fallback;
}

function shouldMirrorLiftingSurfaceAcrossImplicitX(shape: SizeShape) {
  if (!shape.points.length) return false;
  const minX = Math.min(...shape.points.map((point) => point.xM));
  const maxX = Math.max(...shape.points.map((point) => point.xM));
  const thresholdM = 0.001;
  return maxX > thresholdM && minX >= -thresholdM;
}

function liftingSurfacePreviewFromShape(shape: SizeShape, shapes: SizeShape[]): LiftingSurfacePreview | null {
  if (shape.liftingSurfaceKind === "lex") return flatLexPreviewFromShape(shape, shapes);
  const bounds = signedShapeBounds(shape);
  const rootX = Math.abs(bounds.minX) <= 0.002 ? 0 : bounds.minX;
  const tipX = Math.abs(bounds.maxX - rootX) < 0.01 ? rootX + 0.05 : bounds.maxX;
  const span = Math.max(tipX - rootX, 0.01);
  const airfoil = shape.airfoil ?? shape.airfoilStations?.root ?? "NACA 0012";
  const stations = Array.from({ length: 15 }, (_, index) => index / 14);
  const sections = stations.map((station) => {
    const xM = rootX + span * station;
    const extents = chordExtentsAtX(shape.points, xM) ?? nearestChordExtentsAtX(shape.points, xM, rootX, tipX) ?? { minY: bounds.minY, maxY: bounds.maxY };
    const leadingY = Math.max(extents.maxY, extents.minY);
    const trailingY = Math.min(extents.maxY, extents.minY);
    const chordM = Math.max(leadingY - trailingY, 0.001);
    return airfoilSection3D({
      airfoil,
      chordM,
      incidenceDeg: incidenceAtStation(shape, station),
      leadingY,
      xM,
      zOffsetM: liftingSurfaceCenterZAtX(shape, shapes, xM),
    });
  });
  if (sections.some((section) => section.length < 4)) return null;
  return { id: shape.id, label: shape.label, sections };
}

function flatLexPreviewFromShape(shape: SizeShape, shapes: SizeShape[]): LiftingSurfacePreview | null {
  const points = shape.points
    .filter((point) => Number.isFinite(point.xM) && Number.isFinite(point.yM))
    .map((point) => new THREE.Vector3(point.xM, point.yM, liftingSurfaceCenterZAtX(shape, shapes, point.xM)));
  if (points.length < 3) return null;
  return { id: shape.id, label: shape.label, planform: points, sections: [] };
}

function nearestChordExtentsAtX(points: SizePoint[], xM: number, rootX: number, tipX: number) {
  const span = Math.max(tipX - rootX, 0.001);
  const direction = Math.abs(xM - rootX) <= Math.abs(xM - tipX) ? 1 : -1;
  for (const offset of [0.0025, 0.005, 0.01, 0.02]) {
    const sampleX = Math.min(Math.max(xM + direction * span * offset, rootX), tipX);
    const extents = chordExtentsAtX(points, sampleX);
    if (extents) return extents;
  }
  return undefined;
}

function airfoilSection3D({
  airfoil,
  chordM,
  incidenceDeg,
  leadingY,
  xM,
  zOffsetM,
}: {
  airfoil: string;
  chordM: number;
  incidenceDeg: number;
  leadingY: number;
  xM: number;
  zOffsetM: number;
}) {
  const upper: THREE.Vector3[] = [];
  const lower: THREE.Vector3[] = [];
  const thicknessRatio = Math.max(airfoilThicknessRatio(airfoil), 0.04);
  const incidenceRad = (incidenceDeg * Math.PI) / 180;
  const cos = Math.cos(incidenceRad);
  const sin = Math.sin(incidenceRad);
  for (let index = 0; index <= 28; index += 1) {
    const t = index / 28;
    const chordOffsetM = -chordM * t;
    const halfThicknessM = nacaSymmetricHalfThickness(t, thicknessRatio, chordM);
    const camberM = airfoilCamberAtStation(airfoil, t, chordM);
    upper.push(airfoilPoint3D(xM, leadingY, chordOffsetM, camberM + halfThicknessM, cos, sin, zOffsetM));
    lower.unshift(airfoilPoint3D(xM, leadingY, chordOffsetM, camberM - halfThicknessM, cos, sin, zOffsetM));
  }
  return [...upper, ...lower, upper[0].clone()];
}

function airfoilPoint3D(xM: number, leadingY: number, chordOffsetM: number, heightM: number, cos: number, sin: number, zOffsetM: number) {
  const yM = leadingY + chordOffsetM * cos - heightM * sin;
  const zM = zOffsetM + chordOffsetM * sin + heightM * cos;
  return new THREE.Vector3(xM, yM, zM);
}

function applyMovementTransformToGroup(group: THREE.Group, transform?: PreviewMovementTransform) {
  if (!transform) return group;
  const axis = transform.axisEnd.clone().sub(transform.axisStart);
  if (axis.lengthSq() <= 1e-10) return group;
  axis.normalize();
  const movementMatrix = new THREE.Matrix4()
    .makeTranslation(transform.axisStart.x, transform.axisStart.y, transform.axisStart.z)
    .multiply(new THREE.Matrix4().makeRotationAxis(axis, THREE.MathUtils.degToRad(transform.angleDeg)))
    .multiply(new THREE.Matrix4().makeTranslation(-transform.axisStart.x, -transform.axisStart.y, -transform.axisStart.z));
  group.applyMatrix4(movementMatrix);
  return group;
}

function createLiftingSurfaceGroup(surface: LiftingSurfacePreview, selected: boolean) {
  const group = new THREE.Group();
  if (surface.planform?.length) return createFlatLiftingSurfaceGroup(surface, selected);
  if (surface.sections.length < 2 || surface.sections.some((section) => section.length !== surface.sections[0].length)) return group;
  const root = surface.sections[0];
  const tip = surface.sections[surface.sections.length - 1];
  const vertices: number[] = [];
  for (const section of surface.sections) {
    for (const point of section) vertices.push(point.x, point.y, point.z);
  }
  const indices: number[] = [];
  const sectionSize = root.length;
  for (let sectionIndex = 0; sectionIndex < surface.sections.length - 1; sectionIndex += 1) {
    const current = sectionIndex * sectionSize;
    const next = (sectionIndex + 1) * sectionSize;
    for (let pointIndex = 0; pointIndex < sectionSize - 1; pointIndex += 1) {
      indices.push(current + pointIndex, current + pointIndex + 1, next + pointIndex + 1, current + pointIndex, next + pointIndex + 1, next + pointIndex);
    }
  }
  const geometry = new THREE.BufferGeometry();
  geometry.setAttribute("position", new THREE.Float32BufferAttribute(vertices, 3));
  geometry.setIndex(indices);
  geometry.computeVertexNormals();
  const color = surface.mirrored ? "#5fb6d6" : "#7dd3fc";
  group.add(new THREE.Mesh(
    geometry,
    new THREE.MeshStandardMaterial({
      color,
      depthWrite: false,
      metalness: 0.04,
      opacity: surface.mirrored ? 0.34 : selected ? 0.58 : 0.46,
      roughness: 0.48,
      side: THREE.DoubleSide,
      transparent: true,
    }),
  ));
  group.add(createAirfoilCapMesh(root, selected ? "#facc15" : "#bae6fd", selected ? 0.32 : 0.22));
  group.add(createAirfoilCapMesh(tip, selected ? "#facc15" : "#e0f2fe", selected ? 0.36 : 0.28));
  group.add(new THREE.LineLoop(new THREE.BufferGeometry().setFromPoints(root), new THREE.LineBasicMaterial({ color: selected ? "#facc15" : "#e0f2fe", depthTest: false })));
  group.add(new THREE.LineLoop(new THREE.BufferGeometry().setFromPoints(tip), new THREE.LineBasicMaterial({ color: selected ? "#facc15" : "#bae6fd", depthTest: false })));
  const label = createTextSprite(surface.label, "#e0f2fe", 0.024);
  const center = [...root, ...tip].reduce((sum, point) => sum.add(point), new THREE.Vector3()).multiplyScalar(1 / (root.length + tip.length));
  label.position.copy(center).add(new THREE.Vector3(0, 0, 0.02));
  group.add(label);
  return applyMovementTransformToGroup(group, surface.movementTransform);
}

function createFlatLiftingSurfaceGroup(surface: LiftingSurfacePreview, selected: boolean) {
  const group = new THREE.Group();
  const points = surface.planform ?? [];
  if (points.length < 3) return group;
  const geometry = new THREE.BufferGeometry().setFromPoints(points);
  const indices: number[] = [];
  for (let index = 1; index < points.length - 1; index += 1) {
    indices.push(0, index, index + 1);
  }
  geometry.setIndex(indices);
  geometry.computeVertexNormals();
  const color = surface.mirrored ? "#5fb6d6" : "#7dd3fc";
  group.add(new THREE.Mesh(
    geometry,
    new THREE.MeshStandardMaterial({
      color,
      depthWrite: false,
      metalness: 0.02,
      opacity: surface.mirrored ? 0.32 : selected ? 0.56 : 0.44,
      roughness: 0.52,
      side: THREE.DoubleSide,
      transparent: true,
    }),
  ));
  group.add(new THREE.LineLoop(
    new THREE.BufferGeometry().setFromPoints(points),
    new THREE.LineBasicMaterial({ color: selected ? "#facc15" : "#e0f2fe", depthTest: false }),
  ));
  const label = createTextSprite(surface.label, "#e0f2fe", 0.024);
  const center = points.reduce((sum, point) => sum.add(point), new THREE.Vector3()).multiplyScalar(1 / points.length);
  label.position.copy(center).add(new THREE.Vector3(0, 0, 0.02));
  group.add(label);
  return applyMovementTransformToGroup(group, surface.movementTransform);
}

function createAirfoilCapMesh(section: THREE.Vector3[], color: string, opacity: number) {
  const uniqueSection = section.slice(0, -1);
  const center = uniqueSection.reduce((sum, point) => sum.add(point), new THREE.Vector3()).multiplyScalar(1 / Math.max(uniqueSection.length, 1));
  const vertices = [center, ...uniqueSection];
  const geometry = new THREE.BufferGeometry().setFromPoints(vertices);
  const indices: number[] = [];
  for (let index = 1; index < vertices.length; index += 1) {
    const next = index === vertices.length - 1 ? 1 : index + 1;
    indices.push(0, index, next);
  }
  geometry.setIndex(indices);
  geometry.computeVertexNormals();
  return new THREE.Mesh(
    geometry,
    new THREE.MeshBasicMaterial({
      color,
      depthWrite: false,
      opacity,
      side: THREE.DoubleSide,
      transparent: true,
    }),
  );
}

function createPartBoxGroup(part: PartBoxPreview, selected: boolean) {
  const group = new THREE.Group();
  group.name = part.label;
  const geometry = new THREE.BoxGeometry(
    Math.max(part.size.x, 0.001),
    Math.max(part.size.y, 0.001),
    Math.max(part.size.z, 0.001),
  );
  geometry.translate(part.center.x, part.center.y, part.center.z);
  const color = part.mirrored ? "#fb7185" : "#f43f5e";
  group.add(new THREE.Mesh(
    geometry,
    new THREE.MeshStandardMaterial({
      color,
      depthWrite: false,
      metalness: 0.02,
      opacity: selected ? 0.62 : part.mirrored ? 0.32 : 0.46,
      roughness: 0.58,
      side: THREE.DoubleSide,
      transparent: true,
    }),
  ));
  group.add(new THREE.LineSegments(
    new THREE.EdgesGeometry(geometry),
    new THREE.LineBasicMaterial({ color: selected ? "#facc15" : "#fecdd3", depthTest: false, transparent: true, opacity: selected ? 0.95 : 0.62 }),
  ));
  const label = createTextSprite(part.label, "#fecdd3", 0.024);
  label.position.copy(part.center).add(new THREE.Vector3(0, 0, part.size.z / 2 + 0.018));
  group.add(label);
  return applyMovementTransformToGroup(group, part.movementTransform);
}

function createMotorCylinderGroup(motor: MotorCylinderPreview, selected: boolean) {
  const group = new THREE.Group();
  group.name = motor.label;
  const geometry = new THREE.CylinderGeometry(
    Math.max(motor.radiusM, 0.001),
    Math.max(motor.radiusM, 0.001),
    Math.max(motor.lengthM, 0.001),
    48,
    1,
    false,
  );
  const axis = motor.axis.lengthSq() > 1e-9 ? motor.axis.clone().normalize() : new THREE.Vector3(0, 1, 0);
  geometry.applyQuaternion(new THREE.Quaternion().setFromUnitVectors(new THREE.Vector3(0, 1, 0), axis));
  geometry.translate(motor.center.x, motor.center.y, motor.center.z);
  const color = motor.mirrored ? "#fb7185" : "#f43f5e";
  group.add(new THREE.Mesh(
    geometry,
    new THREE.MeshStandardMaterial({
      color,
      depthWrite: false,
      metalness: 0.12,
      opacity: selected ? 0.68 : motor.mirrored ? 0.38 : 0.52,
      roughness: 0.44,
      side: THREE.DoubleSide,
      transparent: true,
    }),
  ));
  group.add(new THREE.LineSegments(
    new THREE.EdgesGeometry(geometry, 24),
    new THREE.LineBasicMaterial({ color: selected ? "#facc15" : "#fecdd3", depthTest: false, transparent: true, opacity: selected ? 0.95 : 0.58 }),
  ));
  const halfAxis = axis.clone().multiplyScalar(motor.lengthM / 2);
  group.add(new THREE.Line(
    new THREE.BufferGeometry().setFromPoints([motor.center.clone().sub(halfAxis), motor.center.clone().add(halfAxis)]),
    new THREE.LineDashedMaterial({ color: "#f8fafc", dashSize: 0.025, depthTest: false, gapSize: 0.012, transparent: true, opacity: 0.9 }),
  ));
  const axisLine = group.children[group.children.length - 1] as THREE.Line;
  axisLine.computeLineDistances();
  const label = createTextSprite(motor.label, "#fecdd3", 0.024);
  label.position.copy(motor.center).add(new THREE.Vector3(0, 0, motor.radiusM + 0.018));
  group.add(label);
  return applyMovementTransformToGroup(group, motor.movementTransform);
}

function createRotorGroup(rotor: RotorPreview, selected: boolean) {
  const group = new THREE.Group();
  group.name = rotor.label;
  const radial = rotor.radial.lengthSq() > 1e-9 ? rotor.radial.clone().normalize() : new THREE.Vector3(1, 0, 0);
  const vertical = new THREE.Vector3(0, 0, 1);
  const normal = radial.clone().cross(vertical).normalize();
  const basis = new THREE.Matrix4().makeBasis(radial, vertical, normal.lengthSq() > 1e-9 ? normal : new THREE.Vector3(0, 1, 0));
  const discGeometry = new THREE.CircleGeometry(Math.max(rotor.radiusM, 0.001), 96);
  discGeometry.applyMatrix4(basis);
  discGeometry.translate(rotor.center.x, rotor.center.y, rotor.center.z);
  group.add(new THREE.Mesh(
    discGeometry,
    new THREE.MeshBasicMaterial({
      color: rotor.mirrored ? "#c084fc" : "#a855f7",
      depthWrite: false,
      opacity: rotor.mirrored ? 0.12 : 0.18,
      side: THREE.DoubleSide,
      transparent: true,
    }),
  ));
  group.add(new THREE.LineLoop(
    new THREE.BufferGeometry().setFromPoints(circlePointsInRotorPlane(rotor.center, radial, vertical, rotor.radiusM, 96)),
    new THREE.LineBasicMaterial({ color: selected ? "#facc15" : "#d8b4fe", depthTest: false, transparent: true, opacity: 0.9 }),
  ));

  const bladeCount = Math.max(1, Math.round(rotor.bladeCount));
  for (let index = 0; index < bladeCount; index += 1) {
    const angle = (Math.PI * 2 * index) / bladeCount;
    const bladeRadial = radial.clone().multiplyScalar(Math.cos(angle)).add(vertical.clone().multiplyScalar(Math.sin(angle))).normalize();
    const bladeTangent = radial.clone().multiplyScalar(-Math.sin(angle)).add(vertical.clone().multiplyScalar(Math.cos(angle))).normalize();
    const blade = rotorBladePoints3D(rotor.center, bladeRadial, bladeTangent, rotor.radiusM, rotor.rootChordM, rotor.tipChordM);
    const bladeGeometry = new THREE.BufferGeometry().setFromPoints(blade);
    bladeGeometry.setIndex([0, 1, 2, 0, 2, 3]);
    bladeGeometry.computeVertexNormals();
    group.add(new THREE.Mesh(
      bladeGeometry,
      new THREE.MeshBasicMaterial({
        color: selected ? "#facc15" : "#c084fc",
        depthWrite: false,
        opacity: selected ? 0.56 : 0.42,
        side: THREE.DoubleSide,
        transparent: true,
      }),
    ));
    group.add(new THREE.LineLoop(
      new THREE.BufferGeometry().setFromPoints(blade),
      new THREE.LineBasicMaterial({ color: selected ? "#fef3c7" : "#f3e8ff", depthTest: false, transparent: true, opacity: 0.78 }),
    ));
  }

  const label = createTextSprite(rotor.label, "#f3e8ff", 0.024);
  label.position.copy(rotor.center).add(vertical.clone().multiplyScalar(rotor.radiusM + 0.024));
  group.add(label);
  return applyMovementTransformToGroup(group, rotor.movementTransform);
}

function circlePointsInRotorPlane(center: THREE.Vector3, radial: THREE.Vector3, vertical: THREE.Vector3, radiusM: number, samples: number) {
  const points: THREE.Vector3[] = [];
  for (let index = 0; index < samples; index += 1) {
    const angle = (Math.PI * 2 * index) / samples;
    points.push(center.clone().add(radial.clone().multiplyScalar(Math.cos(angle) * radiusM)).add(vertical.clone().multiplyScalar(Math.sin(angle) * radiusM)));
  }
  return points;
}

function rotorBladePoints3D(center: THREE.Vector3, radial: THREE.Vector3, tangent: THREE.Vector3, radiusM: number, rootChordM: number, tipChordM: number) {
  const rootRadiusM = Math.max(radiusM * 0.08, 0.004);
  const tipRadiusM = Math.max(radiusM * 0.92, rootRadiusM + 0.005);
  const rootCenter = center.clone().add(radial.clone().multiplyScalar(rootRadiusM));
  const tipCenter = center.clone().add(radial.clone().multiplyScalar(tipRadiusM));
  const rootHalfChord = Math.max(rootChordM / 2, 0.002);
  const tipHalfChord = Math.max(tipChordM / 2, 0.001);
  return [
    rootCenter.clone().add(tangent.clone().multiplyScalar(rootHalfChord)),
    tipCenter.clone().add(tangent.clone().multiplyScalar(tipHalfChord)),
    tipCenter.clone().add(tangent.clone().multiplyScalar(-tipHalfChord)),
    rootCenter.clone().add(tangent.clone().multiplyScalar(-rootHalfChord)),
  ];
}

function mirrorLiftingSurfacePreview(surface: LiftingSurfacePreview): LiftingSurfacePreview {
  return {
    ...surface,
    id: `${surface.id}:mirror-x`,
    label: `${surface.label} mirror`,
    mirrored: true,
    planform: surface.planform?.map((point) => new THREE.Vector3(-point.x, point.y, point.z)),
    sections: surface.sections.map((section) => section.map((point) => new THREE.Vector3(-point.x, point.y, point.z))),
  };
}

function mirrorLiftingSurfacePreviewAcrossPlane(surface: LiftingSurfacePreview, plane: SizeShape, index: number): LiftingSurfacePreview | null {
  const [start, end] = plane.points;
  if (!start || !end) return null;
  const dx = end.xM - start.xM;
  const dy = end.yM - start.yM;
  const lengthSquared = dx * dx + dy * dy;
  if (lengthSquared <= 1e-9) return null;
  const mirrorPoint = (point: THREE.Vector3) => {
    const t = ((point.x - start.xM) * dx + (point.y - start.yM) * dy) / lengthSquared;
    const projectionX = start.xM + dx * t;
    const projectionY = start.yM + dy * t;
    return new THREE.Vector3(projectionX * 2 - point.x, projectionY * 2 - point.y, point.z);
  };
  return {
    ...surface,
    id: `${surface.id}:mirror-plane-${index}`,
    label: `${surface.label} mirror`,
    mirrored: true,
    planform: surface.planform?.map(mirrorPoint),
    sections: surface.sections.map((section) => section.map(mirrorPoint)),
  };
}

function signedShapeBounds(shape: SizeShape) {
  const xs = shape.points.map((point) => point.xM);
  const ys = shape.points.map((point) => point.yM);
  if (!xs.length || !ys.length) return { minX: 0, maxX: 0.05, minY: -0.025, maxY: 0.025 };
  return {
    minX: Math.min(...xs),
    maxX: Math.max(...xs),
    minY: Math.min(...ys),
    maxY: Math.max(...ys),
  };
}

type SideSketchPreview = {
  airfoilSections?: THREE.Vector3[][];
  id: string;
  label: string;
  mirrored?: boolean;
  movementTransform?: PreviewMovementTransform;
  points: THREE.Vector3[];
  revolveAxis?: {
    end: THREE.Vector3;
    label: string;
    start: THREE.Vector3;
  };
  role: SizeShape["role"];
};

function sideSketchesForPreview(shapes: SizeShape[]): SideSketchPreview[] {
  return shapes.flatMap((shape) => {
    if (shape.sketchViewMode !== "side" || referenceRolesForPreview(shape) || shape.points.length < 2) return [];
    const touchedMirrorPlane = shapes.find(
      (candidate) => candidate.sketchViewMode === "side" && candidate.role === "mirrorPlane" && candidate.id !== shape.id && shapeTouchesMirrorPlane(shape, candidate),
    );
    const stationX = (touchedMirrorPlane ? sideViewStationX(touchedMirrorPlane, shapes) : undefined) ?? sideViewStationX(shape, shapes) ?? 0;
    const zOffset = effectiveZOffsetM(shape, shapes);
    const revolveAxis = touchedMirrorPlane?.points[0] && touchedMirrorPlane.points[1]
      ? {
        end: sidePointToPreviewVector(touchedMirrorPlane.points[1], stationX, effectiveZOffsetM(touchedMirrorPlane, shapes)),
        label: touchedMirrorPlane.label,
        start: sidePointToPreviewVector(touchedMirrorPlane.points[0], stationX, effectiveZOffsetM(touchedMirrorPlane, shapes)),
      }
      : undefined;
    const preview = {
      airfoilSections: shape.role === "liftingSurface" && shape.liftingSurfaceKind !== "lex" ? sideViewAirfoilSections(shape, stationX, zOffset) : undefined,
      id: shape.id,
      label: shape.label,
      points: shape.points.map((point) => sidePointToPreviewVector(point, stationX, zOffset)),
      revolveAxis,
      role: shape.role,
    };
	    const localMirrors = touchedMirrorPlane && shape.role === "liftingSurface"
	      ? [mirrorSideSketchAcrossMirrorPlane(preview, touchedMirrorPlane, stationX, effectiveZOffsetM(touchedMirrorPlane, shapes))]
	      : shouldMirrorSideSketchAcrossCenterline(shape)
	        ? [mirrorSideSketchAcrossCenterline(preview)]
	        : [];
    const previews = [preview, ...localMirrors];
    const allPreviews = Math.abs(stationX) <= 0.001 ? previews : [...previews, ...previews.map(mirrorSideSketchPreview)];
    return allPreviews.map((entry) => ({
      ...entry,
      movementTransform: movementTransformForShape(shape, shapes, vectorCenter(entry.points)),
    }));
  });
}

function sidePointToPreviewVector(point: SizePoint, stationX: number, zOffset: number) {
  return new THREE.Vector3(stationX, point.yM, point.xM + zOffset);
}

function sideViewAirfoilSections(shape: SizeShape, stationX: number, zOffset: number) {
  const bounds = signedShapeBounds(shape);
  const rootZ = Math.abs(bounds.minX) <= 0.002 ? 0 : bounds.minX;
  const tipZ = Math.abs(bounds.maxX - rootZ) < 0.01 ? rootZ + 0.05 : bounds.maxX;
  const span = Math.max(tipZ - rootZ, 0.01);
  const airfoil = shape.airfoil ?? shape.airfoilStations?.root ?? "NACA 0012";
  return [0, 1].map((station) => {
    const zM = rootZ + span * station;
    const extents = chordExtentsAtX(shape.points, zM) ?? nearestChordExtentsAtX(shape.points, zM, rootZ, tipZ) ?? { minY: bounds.minY, maxY: bounds.maxY };
    const leadingY = Math.max(extents.maxY, extents.minY);
    const trailingY = Math.min(extents.maxY, extents.minY);
    return sideViewAirfoilSection3D({
      airfoil,
      chordM: Math.max(leadingY - trailingY, 0.001),
      leadingY,
      stationX,
      zM: zM + zOffset,
    });
  });
}

function sideViewAirfoilSection3D({
  airfoil,
  chordM,
  leadingY,
  stationX,
  zM,
}: {
  airfoil: string;
  chordM: number;
  leadingY: number;
  stationX: number;
  zM: number;
}) {
  const upper: THREE.Vector3[] = [];
  const lower: THREE.Vector3[] = [];
  const thicknessRatio = Math.max(airfoilThicknessRatio(airfoil), 0.04);
  for (let index = 0; index <= 28; index += 1) {
    const t = index / 28;
    const chordOffsetM = -chordM * t;
    const halfThicknessM = nacaSymmetricHalfThickness(t, thicknessRatio, chordM);
    const camberM = airfoilCamberAtStation(airfoil, t, chordM);
    upper.push(new THREE.Vector3(stationX + camberM + halfThicknessM, leadingY + chordOffsetM, zM));
    lower.unshift(new THREE.Vector3(stationX + camberM - halfThicknessM, leadingY + chordOffsetM, zM));
  }
  return [...upper, ...lower, upper[0].clone()];
}

function shouldMirrorSideSketchAcrossCenterline(shape: SizeShape) {
  if (shape.role !== "liftingSurface" || !shape.points.length) return false;
  const minX = Math.min(...shape.points.map((point) => point.xM));
  const maxX = Math.max(...shape.points.map((point) => point.xM));
  return minX >= -0.001 && maxX > 0.001;
}

function mirrorSideSketchAcrossCenterline(sketch: SideSketchPreview): SideSketchPreview {
  const mirrorVector = (point: THREE.Vector3) => new THREE.Vector3(point.x, point.y, -point.z);
  return {
    ...sketch,
    airfoilSections: sketch.airfoilSections?.map((section) => section.map(mirrorVector)),
    id: `${sketch.id}:mirror-z`,
    label: `${sketch.label} mirror`,
    mirrored: true,
    points: sketch.points.map(mirrorVector),
    revolveAxis: sketch.revolveAxis
      ? {
        ...sketch.revolveAxis,
        end: mirrorVector(sketch.revolveAxis.end),
        start: mirrorVector(sketch.revolveAxis.start),
      }
      : undefined,
  };
}

function mirrorSideSketchAcrossMirrorPlane(sketch: SideSketchPreview, plane: SizeShape, stationX: number, zOffset: number): SideSketchPreview {
  const [start, end] = plane.points;
  if (!start || !end) return sketch;
  const start3 = sidePointToPreviewVector(start, stationX, zOffset);
  const end3 = sidePointToPreviewVector(end, stationX, zOffset);
  const dy = end3.y - start3.y;
  const dz = end3.z - start3.z;
  const lengthSquared = dy * dy + dz * dz;
  if (lengthSquared <= 1e-9) return sketch;
  const mirrorVector = (point: THREE.Vector3) => {
    const t = ((point.y - start3.y) * dy + (point.z - start3.z) * dz) / lengthSquared;
    const projectionY = start3.y + dy * t;
    const projectionZ = start3.z + dz * t;
    return new THREE.Vector3(point.x, projectionY * 2 - point.y, projectionZ * 2 - point.z);
  };
  return {
    ...sketch,
    airfoilSections: sketch.airfoilSections?.map((section) => section.map(mirrorVector)),
    id: `${sketch.id}:mirror-side-plane`,
    label: `${sketch.label} mirror`,
    mirrored: true,
    points: sketch.points.map(mirrorVector),
    revolveAxis: sketch.revolveAxis
      ? {
        ...sketch.revolveAxis,
        end: mirrorVector(sketch.revolveAxis.end),
        start: mirrorVector(sketch.revolveAxis.start),
      }
      : undefined,
  };
}

function mirrorSideSketchPreview(sketch: SideSketchPreview): SideSketchPreview {
  const mirrorVector = (point: THREE.Vector3) => new THREE.Vector3(-point.x, point.y, point.z);
  return {
    ...sketch,
    airfoilSections: sketch.airfoilSections?.map((section) => section.map(mirrorVector)),
    id: `${sketch.id}:mirror-x`,
    label: `${sketch.label} mirror`,
    mirrored: true,
    points: sketch.points.map(mirrorVector),
    revolveAxis: sketch.revolveAxis
      ? {
        ...sketch.revolveAxis,
        end: mirrorVector(sketch.revolveAxis.end),
        start: mirrorVector(sketch.revolveAxis.start),
      }
      : undefined,
  };
}

function referenceRolesForPreview(shape: SizeShape) {
  return shape.role === "referenceLine" || shape.role === "mirrorPlane";
}

function createSideSketchGroup(sketch: SideSketchPreview, selected: boolean) {
  const group = new THREE.Group();
  const points = sketch.points;
  if (points.length < 2) return group;
  const color = selected ? "#facc15" : sketch.mirrored ? "#6fb7d6" : sketch.role === "liftingSurface" ? "#7dd3fc" : "#f8fafc";

  if (sketch.role === "body" && sketch.revolveAxis && points.length >= 3) {
    const revolvedGroup = createSideRevolvedSketchGroup(sketch, color, selected);
    if (revolvedGroup) return revolvedGroup;
  }

  if (points.length >= 3) {
    const geometry = new THREE.BufferGeometry().setFromPoints(points);
    const indices = [];
    for (let index = 1; index < points.length - 1; index += 1) {
      indices.push(0, index, index + 1);
    }
    geometry.setIndex(indices);
    geometry.computeVertexNormals();
    group.add(new THREE.Mesh(
      geometry,
      new THREE.MeshBasicMaterial({ color, opacity: 0.22, side: THREE.DoubleSide, transparent: true }),
    ));
  }
  const lineGeometry = new THREE.BufferGeometry().setFromPoints(points);
  const line = points.length > 2
    ? new THREE.LineLoop(lineGeometry, new THREE.LineBasicMaterial({ color, depthTest: false }))
    : new THREE.Line(lineGeometry, new THREE.LineBasicMaterial({ color, depthTest: false }));
  group.add(line);
  if (sketch.role === "liftingSurface") {
    for (const section of sketch.airfoilSections ?? []) {
      group.add(createAirfoilCapMesh(section, selected ? "#facc15" : "#bae6fd", selected ? 0.34 : 0.24));
      group.add(new THREE.LineLoop(
        new THREE.BufferGeometry().setFromPoints(section),
        new THREE.LineBasicMaterial({ color: selected ? "#facc15" : "#e0f2fe", depthTest: false }),
      ));
    }
  }
	  const label = createTextSprite(sketch.label, "#e0f2fe", 0.024);
	  const center = points.reduce((sum, point) => sum.add(point), new THREE.Vector3()).multiplyScalar(1 / points.length);
	  label.position.copy(center).add(new THREE.Vector3(0, 0, 0.03));
	  group.add(label);
	  return applyMovementTransformToGroup(group, sketch.movementTransform);
	}

function createSideRevolvedSketchGroup(sketch: SideSketchPreview, color: string, selected: boolean) {
  if (!sketch.revolveAxis) return null;
  const group = new THREE.Group();
  const axisStart = sketch.revolveAxis.start;
  const axisEnd = sketch.revolveAxis.end;
  const axisVector = axisEnd.clone().sub(axisStart);
  if (axisVector.lengthSq() <= 1e-10) return null;
  const axisDirection = axisVector.normalize();
  const projectedProfile = sketch.points.map((point) => {
    const projection = point.clone().sub(axisStart).dot(axisDirection);
    const closestOnAxis = axisStart.clone().add(axisDirection.clone().multiplyScalar(projection));
    const radialVector = point.clone().sub(closestOnAxis);
    return {
      projection,
      radialVector,
      radius: radialVector.length(),
    };
  });
  const minAxis = Math.min(...projectedProfile.map((point) => point.projection));
  const maxAxis = Math.max(...projectedProfile.map((point) => point.projection));
  if (!Number.isFinite(minAxis) || !Number.isFinite(maxAxis) || Math.abs(maxAxis - minAxis) <= 1e-8) return null;
  const centerAxis = (minAxis + maxAxis) / 2;
  const lathePoints = projectedProfile.map((point) => new THREE.Vector2(Math.max(0, point.radius), point.projection - centerAxis));
  const surfaceGeometry = new THREE.LatheGeometry(lathePoints, 72);
  surfaceGeometry.computeVertexNormals();

  const surface = new THREE.Mesh(
    surfaceGeometry,
    new THREE.MeshStandardMaterial({
      color,
      metalness: 0.05,
      opacity: sketch.mirrored ? 0.36 : selected ? 0.62 : 0.46,
      roughness: 0.56,
      side: THREE.DoubleSide,
      transparent: true,
    }),
  );
  const radialDirection = projectedProfile.find((point) => point.radius > 1e-6)?.radialVector.normalize() ?? new THREE.Vector3(0, 0, 1);
  const binormalDirection = radialDirection.clone().cross(axisDirection).normalize();
  const revolveBasis = new THREE.Matrix4().makeBasis(radialDirection, axisDirection, binormalDirection);
  surface.setRotationFromMatrix(revolveBasis);
  surface.position.copy(axisStart.clone().add(axisDirection.clone().multiplyScalar(centerAxis)));
  group.add(surface);

  const edges = new THREE.LineSegments(
    new THREE.EdgesGeometry(surfaceGeometry, 28),
    new THREE.LineBasicMaterial({ color: selected ? "#facc15" : "#cffafe", opacity: 0.36, transparent: true }),
  );
  edges.quaternion.copy(surface.quaternion);
  edges.position.copy(surface.position);
  group.add(edges);

  const profileGeometry = new THREE.BufferGeometry().setFromPoints(sketch.points);
  const profileLine = new THREE.Line(
    profileGeometry,
    new THREE.LineBasicMaterial({ color: "#f8fafc", depthTest: false }),
  );
  group.add(profileLine);

  const axisLine = new THREE.Line(
    new THREE.BufferGeometry().setFromPoints([
      axisStart.clone().add(axisDirection.clone().multiplyScalar(minAxis - 0.02)),
      axisStart.clone().add(axisDirection.clone().multiplyScalar(maxAxis + 0.02)),
    ]),
    new THREE.LineDashedMaterial({ color: "#facc15", dashSize: 0.025, depthTest: false, gapSize: 0.014 }),
  );
  axisLine.computeLineDistances();
  group.add(axisLine);

	  const label = createTextSprite(sketch.label, "#e0f2fe", 0.024);
	  const center = sketch.points.reduce((sum, point) => sum.add(point), new THREE.Vector3()).multiplyScalar(1 / sketch.points.length);
	  label.position.copy(center).add(new THREE.Vector3(0, 0, 0.03));
	  group.add(label);
	  return applyMovementTransformToGroup(group, sketch.movementTransform);
	}

function createRevolvedBodyGroup(body: RevolvedBodyPreview, selected: boolean) {
  const group = new THREE.Group();
  group.name = body.label;
  const sourceProfile = body.shape.points.filter((point) => Number.isFinite(point.xM) && Number.isFinite(point.yM));
  if (sourceProfile.length < 2) return group;

  const solvedZ = body.geometry.centerM[2];
  const zOffsetM = Number.isFinite(solvedZ) ? solvedZ : effectiveZOffsetM(body.shape, []);
  const axisStart = new THREE.Vector3(body.axis.start.xM, body.axis.start.yM, zOffsetM);
  const axisEnd = new THREE.Vector3(body.axis.end.xM, body.axis.end.yM, zOffsetM);
  const axisVector = axisEnd.clone().sub(axisStart);
  if (axisVector.lengthSq() <= 1e-10) return group;
  const axisDirection = axisVector.normalize();
  const projectedProfile = sourceProfile.map((point) => {
    const pointVector = new THREE.Vector3(point.xM, point.yM, zOffsetM);
    const projection = pointVector.clone().sub(axisStart).dot(axisDirection);
    const closestOnAxis = axisStart.clone().add(axisDirection.clone().multiplyScalar(projection));
    return {
      point,
      projection,
      radius: pointVector.distanceTo(closestOnAxis),
    };
  });
  const minAxis = Math.min(...projectedProfile.map((point) => point.projection));
  const maxAxis = Math.max(...projectedProfile.map((point) => point.projection));
  const centerAxis = (minAxis + maxAxis) / 2;
  const lathePoints = projectedProfile.map((point) => new THREE.Vector2(Math.max(0, point.radius), point.projection - centerAxis));
  const surfaceGeometry = new THREE.LatheGeometry(lathePoints, 72);
  surfaceGeometry.computeVertexNormals();

  const surfaceMaterial = new THREE.MeshStandardMaterial({
    color: body.mirrored ? "#8b949e" : "#aeb7c2",
    depthWrite: false,
    metalness: 0.08,
    opacity: body.mirrored ? 0.42 : 0.58,
    roughness: 0.52,
    side: THREE.DoubleSide,
    transparent: true,
  });
  const surface = new THREE.Mesh(surfaceGeometry, surfaceMaterial);
  const revolveRotation = new THREE.Quaternion().setFromUnitVectors(new THREE.Vector3(0, 1, 0), axisDirection);
  surface.quaternion.copy(revolveRotation);
  surface.position.copy(axisStart.clone().add(axisDirection.clone().multiplyScalar(centerAxis)));
  group.add(surface);

  const edgeGeometry = new THREE.EdgesGeometry(surfaceGeometry, 28);
  const edgeMaterial = new THREE.LineBasicMaterial({ color: selected ? "#facc15" : "#cbd5e1", transparent: true, opacity: 0.34 });
  const edges = new THREE.LineSegments(edgeGeometry, edgeMaterial);
  edges.quaternion.copy(surface.quaternion);
  edges.position.copy(surface.position);
  group.add(edges);

  const profileGeometry = new THREE.BufferGeometry().setFromPoints(
    sourceProfile.map((point) => new THREE.Vector3(point.xM, point.yM, zOffsetM + 0.004)),
  );
  const profileLine = new THREE.Line(
    profileGeometry,
    new THREE.LineBasicMaterial({ color: "#f8fafc", linewidth: 2 }),
  );
  group.add(profileLine);

  const axisGeometry = new THREE.BufferGeometry().setFromPoints([
    axisStart.clone().add(axisDirection.clone().multiplyScalar(minAxis - 0.02)),
    axisStart.clone().add(axisDirection.clone().multiplyScalar(maxAxis + 0.02)),
  ]);
  const axisLine = new THREE.Line(axisGeometry, new THREE.LineDashedMaterial({ color: "#facc15", dashSize: 0.025, gapSize: 0.014 }));
  axisLine.computeLineDistances();
  group.add(axisLine);

	  return applyMovementTransformToGroup(group, body.movementTransform);
	}

function shouldMirrorAcrossImplicitX(shape: SizeShape) {
  if (!shape.points.length) return false;
  const minX = Math.min(...shape.points.map((point) => point.xM));
  const maxX = Math.max(...shape.points.map((point) => point.xM));
  const thresholdM = 0.001;
  return minX > thresholdM || maxX < -thresholdM;
}

function mirroredBodyPreview(body: RevolvedBodyPreview): RevolvedBodyPreview {
  const mirrorPoint = (point: SizePoint): SizePoint => ({ ...point, xM: -point.xM });
  return {
    ...body,
    axis: {
      ...body.axis,
      end: mirrorPoint(body.axis.end),
      start: mirrorPoint(body.axis.start),
    },
    id: `${body.id}:mirror-x`,
    label: `${body.label} mirror`,
    mirrored: true,
    profile: body.profile.map(mirrorPoint),
    shape: {
      ...body.shape,
      id: `${body.shape.id}:mirror-x`,
      label: `${body.shape.label} mirror`,
      points: body.shape.points.map(mirrorPoint),
    },
  };
}

function revolveAxisForShape(shape: SizeShape, shapes: SizeShape[]): RevolveAxis {
  const touchedPlane = shapes.find(
    (candidate) => candidate.role === "mirrorPlane" && candidate.id !== shape.id && shapeTouchesMirrorPlane(shape, candidate),
  );
  if (touchedPlane?.points[0] && touchedPlane.points[1]) {
    return { start: touchedPlane.points[0], end: touchedPlane.points[1], label: touchedPlane.label };
  }
  const yValues = shape.points.map((point) => point.yM);
  const minY = Math.min(...yValues, -0.1);
  const maxY = Math.max(...yValues, 0.1);
  return {
    start: { xM: 0, yM: minY },
    end: { xM: 0, yM: maxY },
    label: "X=0 mirror",
  };
}

function createReferenceLayer(bounds: PreviewBounds, shapes: SizeShape[]) {
  const group = new THREE.Group();
  group.add(createScaleGrid(bounds));
  group.add(createAxisReference(bounds));
  group.add(createReferenceLines(shapes));
  group.add(createMirrorPlanes(shapes, bounds));
  return group;
}

function createScaleGrid(bounds: PreviewBounds) {
  const group = new THREE.Group();
  const gridSize = Math.max(bounds.widthM, bounds.lengthM, 0.2);
  const divisions = Math.max(8, Math.ceil(gridSize / 0.05));
  const tickLabelHeight = Math.min(0.12, Math.max(0.06, gridSize * 0.028));
  const grid = new THREE.GridHelper(gridSize, divisions, "#2f4657", "#172633");
  grid.rotation.x = Math.PI / 2;
  grid.position.set(bounds.centerX, bounds.centerY, -0.001);
  group.add(grid);

  const tickStep = scaleTickStep(gridSize);
  const xLabelY = bounds.minY - tickStep * 0.55;
  const yLabelX = bounds.maxX + tickStep * 0.55;
  const xStart = Math.ceil(bounds.minX / tickStep) * tickStep;
  const xEnd = Math.floor(bounds.maxX / tickStep) * tickStep;
  for (let x = xStart; x <= xEnd + tickStep / 2; x += tickStep) {
    if (Math.abs(x) < tickStep / 10) continue;
    group.add(lineFromPoints([new THREE.Vector3(x, bounds.minY, 0.006), new THREE.Vector3(x, bounds.maxY, 0.006)], new THREE.LineBasicMaterial({ color: "#355064", transparent: true, opacity: 0.34 })));
    const label = createTextSprite(`${Math.round(x * 1000)}`, "#e5f6ff", tickLabelHeight, { background: false });
    label.position.set(x, xLabelY, 0.02);
    label.renderOrder = 18;
    group.add(label);
  }

  const yStart = Math.ceil(bounds.minY / tickStep) * tickStep;
  const yEnd = Math.floor(bounds.maxY / tickStep) * tickStep;
  for (let y = yStart; y <= yEnd + tickStep / 2; y += tickStep) {
    if (Math.abs(y) < tickStep / 10) continue;
    group.add(lineFromPoints([new THREE.Vector3(bounds.minX, y, 0.006), new THREE.Vector3(bounds.maxX, y, 0.006)], new THREE.LineBasicMaterial({ color: "#355064", transparent: true, opacity: 0.34 })));
    const label = createTextSprite(`${Math.round(y * 1000)}`, "#e5f6ff", tickLabelHeight, { background: false });
    label.position.set(yLabelX, y, 0.02);
    label.renderOrder = 18;
    group.add(label);
  }

  return group;
}

function createAxisReference(bounds: PreviewBounds) {
  const group = new THREE.Group();
  const xMaterial = new THREE.LineBasicMaterial({ color: "#7dd3fc", transparent: true, opacity: 0.72 });
  const yMaterial = new THREE.LineBasicMaterial({ color: "#facc15", transparent: true, opacity: 0.78 });
  const zMaterial = new THREE.LineBasicMaterial({ color: "#34d399", transparent: true, opacity: 0.72 });
  const labelPad = Math.max(bounds.widthM, bounds.lengthM, bounds.maxZ - bounds.minZ, 0.2) * 0.08;
  const axisLabelHeight = Math.min(0.28, Math.max(0.14, Math.max(bounds.widthM, bounds.lengthM, bounds.maxZ - bounds.minZ, 0.2) * 0.065));
  group.add(lineFromPoints([new THREE.Vector3(bounds.minX - labelPad, 0, 0.01), new THREE.Vector3(bounds.maxX + labelPad, 0, 0.01)], xMaterial));
  group.add(lineFromPoints([new THREE.Vector3(0, bounds.minY - labelPad, 0.012), new THREE.Vector3(0, bounds.maxY + labelPad, 0.012)], yMaterial));
  group.add(lineFromPoints([new THREE.Vector3(0, 0, bounds.minZ - labelPad), new THREE.Vector3(0, 0, bounds.maxZ + labelPad)], zMaterial));
  const xLabel = createTextSprite("X", "#7dd3fc", axisLabelHeight, { background: false });
  xLabel.position.set(bounds.maxX + labelPad, 0, axisLabelHeight * 0.7);
  xLabel.renderOrder = 20;
  group.add(xLabel);
  const yLabel = createTextSprite("Y", "#facc15", axisLabelHeight, { background: false });
  yLabel.position.set(0, bounds.maxY + labelPad, axisLabelHeight * 0.7);
  yLabel.renderOrder = 20;
  group.add(yLabel);
  const zLabel = createTextSprite("Z", "#34d399", axisLabelHeight, { background: false });
  zLabel.position.set(0, 0, bounds.maxZ + axisLabelHeight * 0.5);
  zLabel.renderOrder = 20;
  group.add(zLabel);
  const originLabel = createTextSprite("origin", "#dbeafe", axisLabelHeight * 0.45, { background: false });
  originLabel.position.set(0.012, 0.012, 0.016);
  group.add(originLabel);
  group.add(createOriginAxisGizmo(bounds));
  return group;
}

function createOriginAxisGizmo(bounds: PreviewBounds) {
  const group = new THREE.Group();
  const size = Math.min(0.48, Math.max(0.16, Math.max(bounds.widthM, bounds.lengthM, bounds.maxZ - bounds.minZ, 0.2) * 0.13));
  const labelHeight = size * 0.38;
  const arrowRadius = size * 0.035;
  const arrowHeadLength = size * 0.18;
  const arrowHeadWidth = size * 0.1;
  const axes = [
    { color: "#7dd3fc", dir: new THREE.Vector3(1, 0, 0), label: "X" },
    { color: "#facc15", dir: new THREE.Vector3(0, 1, 0), label: "Y" },
    { color: "#34d399", dir: new THREE.Vector3(0, 0, 1), label: "Z" },
  ];
  for (const axis of axes) {
    const arrow = new THREE.ArrowHelper(axis.dir, new THREE.Vector3(0, 0, 0), size, axis.color, arrowHeadLength, arrowHeadWidth);
    arrow.line.material = new THREE.LineBasicMaterial({ color: axis.color, depthTest: false, linewidth: arrowRadius });
    arrow.cone.material = new THREE.MeshBasicMaterial({ color: axis.color, depthTest: false });
    group.add(arrow);
    const label = createTextSprite(axis.label, axis.color, labelHeight, { background: false, fontPx: 74 });
    label.position.copy(axis.dir.clone().multiplyScalar(size + labelHeight * 0.5));
    label.renderOrder = 30;
    group.add(label);
  }
  group.add(createOriginPlanePatch([
    new THREE.Vector3(0, 0, 0),
    new THREE.Vector3(size * 0.55, 0, 0),
    new THREE.Vector3(size * 0.55, size * 0.55, 0),
    new THREE.Vector3(0, size * 0.55, 0),
  ], "#7dd3fc"));
  group.add(createOriginPlanePatch([
    new THREE.Vector3(0, 0, 0),
    new THREE.Vector3(size * 0.45, 0, 0),
    new THREE.Vector3(size * 0.45, 0, size * 0.45),
    new THREE.Vector3(0, 0, size * 0.45),
  ], "#34d399"));
  group.add(createOriginPlanePatch([
    new THREE.Vector3(0, 0, 0),
    new THREE.Vector3(0, size * 0.45, 0),
    new THREE.Vector3(0, size * 0.45, size * 0.45),
    new THREE.Vector3(0, 0, size * 0.45),
  ], "#facc15"));
  return group;
}

function createOriginPlanePatch(points: THREE.Vector3[], color: string) {
  const group = new THREE.Group();
  const geometry = new THREE.BufferGeometry().setFromPoints(points);
  geometry.setIndex([0, 1, 2, 0, 2, 3]);
  geometry.computeVertexNormals();
  group.add(new THREE.Mesh(
    geometry,
    new THREE.MeshBasicMaterial({ color, depthWrite: false, opacity: 0.1, side: THREE.DoubleSide, transparent: true }),
  ));
  group.add(new THREE.LineLoop(new THREE.BufferGeometry().setFromPoints(points), new THREE.LineBasicMaterial({ color, depthTest: false, transparent: true, opacity: 0.65 })));
  return group;
}

function createMirrorPlanes(shapes: SizeShape[], bounds: PreviewBounds) {
  const group = new THREE.Group();
  const implicitPlane = createVerticalMirrorPlane(
    new THREE.Vector3(0, bounds.minY, 0),
    new THREE.Vector3(0, bounds.maxY, 0),
    bounds,
    "X=0 mirror",
  );
  group.add(implicitPlane);

  for (const shape of shapes) {
    if (shape.role !== "mirrorPlane" || shape.points.length < 2) continue;
    if (shape.sketchViewMode === "side") {
      group.add(createSideViewMirrorPlane(shape, shapes, bounds));
      continue;
    }
    const [start, end] = shape.points;
    const zOffset = effectiveZOffsetM(shape, shapes);
    group.add(createVerticalMirrorPlane(
      new THREE.Vector3(start.xM, start.yM, zOffset),
      new THREE.Vector3(end.xM, end.yM, zOffset),
      bounds,
      shape.label,
    ));
  }
  return group;
}

function createReferenceLines(shapes: SizeShape[]) {
  const group = new THREE.Group();
  for (const shape of shapes) {
    if (shape.role !== "referenceLine" || shape.points.length < 2) continue;
    const lineGroup = shape.sketchViewMode === "side" ? createSideViewReferenceLine(shape, shapes) : createTopViewReferenceLine(shape, shapes);
    group.add(lineGroup);
  }
  return group;
}

function createTopViewReferenceLine(shape: SizeShape, shapes: SizeShape[]) {
  const group = new THREE.Group();
  const points = topViewReferenceLine3DPoints(shape, shapes).map((point) => new THREE.Vector3(point.xM, point.yM, point.zM));
  group.add(createDashedReferencePolyline(points, "#86efac", 0.9));
  if (!points.some((point) => Math.abs(point.x) <= 0.001)) {
    group.add(createDashedReferencePolyline(points.map((point) => new THREE.Vector3(-point.x, point.y, point.z)), "#86efac", 0.44));
  }
  const center = points.reduce((sum, point) => sum.add(point), new THREE.Vector3()).multiplyScalar(1 / points.length);
  const label = createTextSprite(shape.label, "#dcfce7", 0.022);
  label.position.copy(center).add(new THREE.Vector3(0, 0, 0.018));
  group.add(label);
  return group;
}

function createSideViewReferenceLine(shape: SizeShape, shapes: SizeShape[]) {
  const group = new THREE.Group();
  const stationX = sideViewStationX(shape, shapes) ?? 0;
  const zOffset = effectiveZOffsetM(shape, shapes);
  const points = shape.points.map((point) => new THREE.Vector3(stationX, point.yM, point.xM + zOffset));
  group.add(createDashedReferencePolyline(points, "#86efac", 0.9));
  if (Math.abs(stationX) > 0.001) {
    group.add(createDashedReferencePolyline(points.map((point) => new THREE.Vector3(-point.x, point.y, point.z)), "#86efac", 0.44));
  }
  const center = points.reduce((sum, point) => sum.add(point), new THREE.Vector3()).multiplyScalar(1 / points.length);
  const label = createTextSprite(shape.label, "#dcfce7", 0.022);
  label.position.copy(center).add(new THREE.Vector3(0, 0, 0.018));
  group.add(label);
  return group;
}

function createDashedReferencePolyline(points: THREE.Vector3[], color: string, opacity: number) {
  const line = new THREE.Line(
    new THREE.BufferGeometry().setFromPoints(points),
    new THREE.LineDashedMaterial({ color, dashSize: 0.025, depthTest: false, gapSize: 0.014, transparent: true, opacity }),
  );
  line.computeLineDistances();
  return line;
}

function createSideViewMirrorPlane(shape: SizeShape, shapes: SizeShape[], bounds: PreviewBounds) {
  const [start, end] = shape.points;
  const stationX = sideViewStationX(shape, shapes) ?? 0;
  const zOffset = effectiveZOffsetM(shape, shapes);
  const start3 = new THREE.Vector3(stationX, start.yM, start.xM + zOffset);
  const end3 = new THREE.Vector3(stationX, end.yM, end.xM + zOffset);
  const ySpan = Math.max(Math.abs(end.yM - start.yM), 0.08);
  const zSpan = Math.max(Math.abs(end.xM - start.xM), 0.08);
  const zMin = Math.min(start3.z, end3.z) - zSpan * 0.5;
  const zMax = Math.max(start3.z, end3.z) + zSpan * 0.5;
  const yMin = Math.min(start3.y, end3.y) - ySpan * 0.5;
  const yMax = Math.max(start3.y, end3.y) + ySpan * 0.5;
  const group = new THREE.Group();
  const geometry = new THREE.BufferGeometry().setFromPoints([
    new THREE.Vector3(stationX, yMin, zMin),
    new THREE.Vector3(stationX, yMax, zMin),
    new THREE.Vector3(stationX, yMax, zMax),
    new THREE.Vector3(stationX, yMin, zMax),
  ]);
  geometry.setIndex([0, 1, 2, 0, 2, 3]);
  geometry.computeVertexNormals();
  group.add(new THREE.Mesh(
    geometry,
    new THREE.MeshBasicMaterial({ color: "#22d3ee", depthWrite: false, opacity: 0.16, side: THREE.DoubleSide, transparent: true }),
  ));

  const line = new THREE.Line(
    new THREE.BufferGeometry().setFromPoints([start3, end3]),
    new THREE.LineDashedMaterial({ color: "#67e8f9", dashSize: 0.025, depthTest: false, gapSize: 0.014, transparent: true, opacity: 0.96 }),
  );
  line.computeLineDistances();
  group.add(line);
  const labelSprite = createTextSprite(shape.label, "#cffafe", 0.024);
  labelSprite.position.set(stationX, (start3.y + end3.y) / 2, Math.max(zMax, bounds.maxZ) + 0.015);
  group.add(labelSprite);
  return group;
}

function createVerticalMirrorPlane(start: THREE.Vector3, end: THREE.Vector3, bounds: PreviewBounds, label: string) {
  const group = new THREE.Group();
  const zMin = Math.min(bounds.minZ, -0.015);
  const zMax = Math.max(bounds.maxZ, 0.08);
  const planeGeometry = new THREE.BufferGeometry().setFromPoints([
    new THREE.Vector3(start.x, start.y, zMin),
    new THREE.Vector3(end.x, end.y, zMin),
    new THREE.Vector3(end.x, end.y, zMax),
    new THREE.Vector3(start.x, start.y, zMax),
  ]);
  planeGeometry.setIndex([0, 1, 2, 0, 2, 3]);
  planeGeometry.computeVertexNormals();
  group.add(new THREE.Mesh(
    planeGeometry,
    new THREE.MeshBasicMaterial({ color: "#22d3ee", opacity: 0.12, side: THREE.DoubleSide, transparent: true }),
  ));

  const line = new THREE.Line(
    new THREE.BufferGeometry().setFromPoints([start, end]),
    new THREE.LineDashedMaterial({ color: "#67e8f9", dashSize: 0.025, gapSize: 0.014, transparent: true, opacity: 0.9 }),
  );
  line.computeLineDistances();
  group.add(line);
  const labelSprite = createTextSprite(label, "#cffafe", 0.024);
  labelSprite.position.set((start.x + end.x) / 2, (start.y + end.y) / 2, zMax + 0.015);
  group.add(labelSprite);
  return group;
}

function lineFromPoints(points: THREE.Vector3[], material: THREE.Material) {
  return new THREE.Line(new THREE.BufferGeometry().setFromPoints(points), material);
}

function createTextSprite(text: string, color: string, heightM: number, options: { background?: boolean; fontPx?: number } = {}) {
  const canvas = document.createElement("canvas");
  canvas.width = 512;
  canvas.height = 128;
  const context = canvas.getContext("2d");
  let labelWidthPx = 80;
  if (context) {
    context.clearRect(0, 0, canvas.width, canvas.height);
    const fontPx = options.fontPx ?? 54;
    context.font = `900 ${fontPx}px Inter, ui-sans-serif, system-ui, -apple-system, BlinkMacSystemFont, Segoe UI, sans-serif`;
    labelWidthPx = Math.min(canvas.width - 12, Math.max(54, context.measureText(text).width + 20));
    if (options.background ?? true) {
      context.fillStyle = "rgba(5, 12, 18, 0.86)";
      context.fillRect((canvas.width - labelWidthPx) / 2, 18, labelWidthPx, 88);
    }
    context.fillStyle = color;
    context.textAlign = "center";
    context.textBaseline = "middle";
    if (!(options.background ?? true)) {
      context.lineJoin = "round";
      context.lineWidth = Math.max(5, fontPx * 0.11);
      context.strokeStyle = "rgba(5, 12, 18, 0.94)";
      context.strokeText(text, canvas.width / 2, canvas.height / 2);
    }
    context.fillText(text, canvas.width / 2, canvas.height / 2);
  }
  const texture = new THREE.CanvasTexture(canvas);
  texture.colorSpace = THREE.SRGBColorSpace;
  texture.generateMipmaps = false;
  texture.minFilter = THREE.LinearFilter;
  texture.magFilter = THREE.LinearFilter;
  const material = new THREE.SpriteMaterial({ map: texture, transparent: true, depthTest: false });
  const sprite = new THREE.Sprite(material);
  sprite.scale.set(heightM * Math.max(1.35, labelWidthPx / 80), heightM, 1);
  return sprite;
}

type PreviewBounds = {
  centerX: number;
  centerY: number;
  lengthM: number;
  maxX: number;
  maxY: number;
  maxZ: number;
  minX: number;
  minY: number;
  minZ: number;
  widthM: number;
};

function referenceBoundsForPreview(shapes: SizeShape[], bodies: RevolvedBodyPreview[]): PreviewBounds {
  const xs = [0];
  const ys = [0];
  const zs = [0];
  let radius = 0.08;
  for (const body of bodies) {
    for (const point of body.shape.points) {
      xs.push(point.xM);
      ys.push(point.yM);
      radius = Math.max(radius, distancePointToAxis(point, body.axis.start, body.axis.end));
    }
    xs.push(body.axis.start.xM, body.axis.end.xM);
    ys.push(body.axis.start.yM, body.axis.end.yM);
    zs.push(-radius, radius);
  }
  for (const shape of shapes) {
    if (shape.sketchViewMode === "side") {
      const touchedMirrorPlane = shapes.find(
        (candidate) => candidate.sketchViewMode === "side" && candidate.role === "mirrorPlane" && candidate.id !== shape.id && shapeTouchesMirrorPlane(shape, candidate),
      );
      const stationX = (touchedMirrorPlane ? sideViewStationX(touchedMirrorPlane, shapes) : undefined) ?? sideViewStationX(shape, shapes) ?? 0;
      xs.push(stationX);
      if (Math.abs(stationX) > 0.001) xs.push(-stationX);
      for (const point of shape.points) {
        ys.push(point.yM);
        const zOffset = effectiveZOffsetM(shape, shapes);
        zs.push(point.xM + zOffset);
      }
      continue;
    }
    if (!referenceRolesForPreview(shape)) continue;
    const stationX = shape.role === "referenceLine" ? verticalReferenceX(shape) : undefined;
    for (const point of shape.points) {
      xs.push(stationX ?? point.xM);
      ys.push(point.yM);
      const zOffset = effectiveZOffsetM(shape, shapes);
      zs.push(zOffset);
    }
    if (shape.role === "referenceLine" && shape.points.every((point) => Math.abs(point.xM) > 0.001)) {
      for (const point of shape.points) xs.push(-point.xM);
    }
  }
  const minX = Math.min(...xs, -radius) - 0.08;
  const maxX = Math.max(...xs, radius) + 0.08;
  const minY = Math.min(...ys) - 0.08;
  const maxY = Math.max(...ys) + 0.08;
  return {
    centerX: (minX + maxX) / 2,
    centerY: (minY + maxY) / 2,
    lengthM: maxY - minY,
    maxX,
    maxY,
    maxZ: Math.max(...zs, radius, 0.08) + 0.03,
    minX,
    minY,
    minZ: Math.min(...zs, -radius, -0.08) - 0.03,
    widthM: maxX - minX,
  };
}

function scaleTickStep(sizeM: number) {
  if (sizeM <= 0.25) return 0.05;
  if (sizeM <= 0.8) return 0.1;
  if (sizeM <= 2) return 0.25;
  if (sizeM <= 5) return 0.5;
  return 1;
}

function distancePointToAxis(point: SizePoint, start: SizePoint, end: SizePoint) {
  const dx = end.xM - start.xM;
  const dy = end.yM - start.yM;
  const length = Math.hypot(dx, dy);
  if (length <= 1e-9) return 0;
  return Math.abs((dy * point.xM - dx * point.yM + end.xM * start.yM - end.yM * start.xM) / length);
}

function fitCameraToGroups(camera: THREE.OrthographicCamera, controls: ArcballControls, groups: Array<THREE.Group | null>) {
  setCameraToView(camera, controls, groups, "top");
}

function setCameraToView(camera: THREE.OrthographicCamera, controls: ArcballControls, groups: Array<THREE.Group | null>, viewMode: CanvasViewMode | "orbit") {
  const box = boxForGroups(groups);
  if (box.isEmpty()) {
    camera.position.set(0, 0, 1);
    arcballTarget(controls).set(0, 0, 0);
    controls.update();
    return;
  }
  const size = box.getSize(new THREE.Vector3());
  const center = box.getCenter(new THREE.Vector3());
  const maxSize = Math.max(size.x, size.y, size.z, 0.08);
  const distance = maxSize * 4;
  const aspect = Math.max((camera.right - camera.left) / Math.max(camera.top - camera.bottom, 1e-6), 1e-6);
  const viewHeight = Math.max(maxSize * 1.45, 0.08);
  camera.left = (-viewHeight * aspect) / 2;
  camera.right = (viewHeight * aspect) / 2;
  camera.top = viewHeight / 2;
  camera.bottom = -viewHeight / 2;
  const offsets: Record<CanvasViewMode | "orbit", THREE.Vector3> = {
    top: new THREE.Vector3(0, 0, distance),
    front: new THREE.Vector3(0, -distance, 0),
    orbit: new THREE.Vector3(distance * 0.55, -distance * 0.75, distance * 0.45),
    side: new THREE.Vector3(distance, 0, 0),
  };
  const ups: Record<CanvasViewMode | "orbit", THREE.Vector3> = {
    top: new THREE.Vector3(0, 1, 0),
    front: new THREE.Vector3(0, 0, 1),
    orbit: new THREE.Vector3(0, 0, 1),
    side: new THREE.Vector3(0, 1, 0),
  };
  camera.up.copy(ups[viewMode]);
  camera.position.copy(center).add(offsets[viewMode]);
  camera.near = Math.max(distance / 100, 0.001);
  camera.far = Math.max(distance * 100, 10);
  camera.zoom = 1;
  camera.updateProjectionMatrix();
  arcballTarget(controls).copy(center);
  controls.update();
}

function arcballTarget(controls: ArcballControls) {
  return (controls as ArcballControls & { target: THREE.Vector3 }).target;
}

function boxForGroups(groups: Array<THREE.Group | null>) {
  const box = new THREE.Box3();
  for (const group of groups) {
    if (!group) continue;
    const groupBox = new THREE.Box3().setFromObject(group);
    if (!groupBox.isEmpty()) box.union(groupBox);
  }
  return box;
}

function disposeObject(object: THREE.Object3D) {
  object.traverse((child) => {
    const mesh = child as THREE.Mesh;
    const geometry = mesh.geometry as THREE.BufferGeometry | undefined;
    if (geometry) geometry.dispose();
    const material = (mesh.material ?? undefined) as THREE.Material | THREE.Material[] | undefined;
    if (Array.isArray(material)) {
      material.forEach((item) => item.dispose());
    } else if (material) {
      material.dispose();
    }
  });
}
