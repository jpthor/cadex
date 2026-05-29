import { useEffect, useMemo, useRef } from "react";
import * as THREE from "three";
import { OrbitControls } from "three/examples/jsm/controls/OrbitControls.js";
import type { SizeCadGeometry, SizePoint, SizeShape } from "../../sizing";
import type { CanvasViewMode } from "../types";
import {
  airfoilCamberAtStation,
  airfoilThicknessRatio,
  cadGeometryForShape,
  chordExtentsAtX,
  incidenceAtStation,
  nacaSymmetricHalfThickness,
  shapeTouchesMirrorPlane,
  sideViewStationX,
} from "../geometry";

type RevolvedBodyPreview = {
  axis: RevolveAxis;
  geometry: Extract<SizeCadGeometry, { kind: "revolvedBody" }>;
  id: string;
  label: string;
  mirrored?: boolean;
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
  sections: THREE.Vector3[][];
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
  const controlsRef = useRef<OrbitControls | null>(null);
  const groupRef = useRef<THREE.Group | null>(null);
  const referenceGroupRef = useRef<THREE.Group | null>(null);
  const hasFitRef = useRef(false);

  const bodies = useMemo(() => revolvedBodiesForPreview(shapes), [shapes]);
  const liftingSurfaces = useMemo(() => liftingSurfacesForPreview(shapes), [shapes]);
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

    const controls = new OrbitControls(camera, renderer.domElement);
    controls.enableDamping = true;
    controls.dampingFactor = 0.08;
    controls.enablePan = true;
    controls.enableRotate = active;
    controls.enableZoom = true;
    controls.target.set(0, 0, 0);
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
    for (const sideSketch of sideSketches) {
      group.add(createSideSketchGroup(sideSketch, sideSketch.id === selectedShapeId));
    }

    if (!hasFitRef.current || bodies.some((body) => body.id === selectedShapeId)) {
      fitCameraToGroups(camera, controls, [group, referenceGroup]);
      hasFitRef.current = bodies.length > 0 || liftingSurfaces.length > 0;
    }
  }, [bodies, liftingSurfaces, selectedShapeId, sideSketches]);

  useEffect(() => {
    const group = groupRef.current;
    const referenceGroup = referenceGroupRef.current;
    const camera = cameraRef.current;
    const controls = controlsRef.current;
    if (!group || !camera || !controls || (!bodies.length && !liftingSurfaces.length)) return;
    setCameraToView(camera, controls, [group, referenceGroup], active ? "orbit" : viewMode);
  }, [active, bodies.length, cameraCommandSerial, liftingSurfaces.length, sideSketches.length, viewMode]);

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
    const geometry = shape.cadGeometry ?? cadGeometryForShape(shape, shapes);
    if (!geometry || geometry.kind !== "revolvedBody") return [];
    const axis = revolveAxisForShape(shape, shapes);
    const profile = geometry.profile?.length ? geometry.profile : shape.points.map((point) => ({ ...point, xM: Math.abs(point.xM) }));
    if (profile.length < 2) return [];
    const body = { axis, geometry, id: shape.id, label: shape.label, profile, shape };
    return shouldMirrorAcrossImplicitY(shape) ? [body, mirroredBodyPreview(body)] : [body];
  });
}

function liftingSurfacesForPreview(shapes: SizeShape[]): LiftingSurfacePreview[] {
  return shapes.flatMap((shape) => {
    if (shape.role !== "liftingSurface" || shape.sketchViewMode === "side" || shape.points.length < 3) return [];
    const preview = liftingSurfacePreviewFromShape(shape);
    if (!preview) return [];
    const mirrors: LiftingSurfacePreview[] = [];
    if (shouldMirrorLiftingSurfaceAcrossImplicitY(shape)) mirrors.push(mirrorLiftingSurfacePreview(preview));
    const localMirrors = shapes
      .filter((candidate) => candidate.role === "mirrorPlane" && candidate.id !== shape.id && shapeTouchesMirrorPlane(shape, candidate))
      .map((plane, index) => mirrorLiftingSurfacePreviewAcrossPlane(preview, plane, index))
      .filter((entry): entry is LiftingSurfacePreview => Boolean(entry));
    return [preview, ...mirrors, ...localMirrors];
  });
}

function shouldMirrorLiftingSurfaceAcrossImplicitY(shape: SizeShape) {
  if (!shape.points.length) return false;
  const minX = Math.min(...shape.points.map((point) => point.xM));
  const maxX = Math.max(...shape.points.map((point) => point.xM));
  const thresholdM = 0.001;
  return maxX > thresholdM && minX >= -thresholdM;
}

function liftingSurfacePreviewFromShape(shape: SizeShape): LiftingSurfacePreview | null {
  const bounds = signedShapeBounds(shape);
  const rootX = Math.abs(bounds.minX) <= 0.002 ? 0 : bounds.minX;
  const tipX = Math.abs(bounds.maxX - rootX) < 0.01 ? rootX + 0.05 : bounds.maxX;
  const span = Math.max(tipX - rootX, 0.01);
  const rootAirfoil = shape.airfoilStations?.root ?? shape.airfoil ?? "NACA 0012";
  const tipAirfoil = shape.airfoilStations?.tip ?? shape.airfoil ?? rootAirfoil;
  const stations = Array.from({ length: 15 }, (_, index) => index / 14);
  const sections = stations.map((station) => {
    const xM = rootX + span * station;
    const extents = chordExtentsAtX(shape.points, xM) ?? nearestChordExtentsAtX(shape.points, xM, rootX, tipX) ?? { minY: bounds.minY, maxY: bounds.maxY };
    const leadingY = Math.max(extents.maxY, extents.minY);
    const trailingY = Math.min(extents.maxY, extents.minY);
    const chordM = Math.max(leadingY - trailingY, 0.001);
    return airfoilSection3D({
      airfoil: rootAirfoil,
      blendT: station,
      chordM,
      incidenceDeg: incidenceAtStation(shape, station),
      leadingY,
      tipAirfoil,
      xM,
      zOffsetM: shape.zOffsetM ?? 0,
    });
  });
  if (sections.some((section) => section.length < 4)) return null;
  return { id: shape.id, label: shape.label, sections };
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
  blendT = 0,
  chordM,
  incidenceDeg,
  leadingY,
  tipAirfoil,
  xM,
  zOffsetM,
}: {
  airfoil: string;
  blendT?: number;
  chordM: number;
  incidenceDeg: number;
  leadingY: number;
  tipAirfoil?: string;
  xM: number;
  zOffsetM: number;
}) {
  const upper: THREE.Vector3[] = [];
  const lower: THREE.Vector3[] = [];
  const thicknessRatio = Math.max(mix(airfoilThicknessRatio(airfoil), airfoilThicknessRatio(tipAirfoil ?? airfoil), blendT), 0.04);
  const incidenceRad = (incidenceDeg * Math.PI) / 180;
  const cos = Math.cos(incidenceRad);
  const sin = Math.sin(incidenceRad);
  for (let index = 0; index <= 28; index += 1) {
    const t = index / 28;
    const chordOffsetM = -chordM * t;
    const halfThicknessM = nacaSymmetricHalfThickness(t, thicknessRatio, chordM);
    const camberM = mix(airfoilCamberAtStation(airfoil, t, chordM), airfoilCamberAtStation(tipAirfoil ?? airfoil, t, chordM), blendT);
    upper.push(airfoilPoint3D(xM, leadingY, chordOffsetM, camberM + halfThicknessM, cos, sin, zOffsetM));
    lower.unshift(airfoilPoint3D(xM, leadingY, chordOffsetM, camberM - halfThicknessM, cos, sin, zOffsetM));
  }
  return [...upper, ...lower, upper[0].clone()];
}

function mix(from: number, to: number, progress: number) {
  const t = Math.min(Math.max(progress, 0), 1);
  return from + (to - from) * t;
}

function airfoilPoint3D(xM: number, leadingY: number, chordOffsetM: number, heightM: number, cos: number, sin: number, zOffsetM: number) {
  const yM = leadingY + chordOffsetM * cos - heightM * sin;
  const zM = zOffsetM + chordOffsetM * sin + heightM * cos;
  return new THREE.Vector3(xM, yM, zM);
}

function createLiftingSurfaceGroup(surface: LiftingSurfacePreview, selected: boolean) {
  const group = new THREE.Group();
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
  const color = selected ? "#facc15" : surface.mirrored ? "#5fb6d6" : "#7dd3fc";
  group.add(new THREE.Mesh(
    geometry,
    new THREE.MeshStandardMaterial({
      color,
      metalness: 0.04,
      opacity: surface.mirrored ? 0.34 : 0.46,
      roughness: 0.48,
      side: THREE.DoubleSide,
      transparent: true,
    }),
  ));
  group.add(new THREE.LineLoop(new THREE.BufferGeometry().setFromPoints(root), new THREE.LineBasicMaterial({ color: "#e0f2fe", depthTest: false })));
  group.add(new THREE.LineLoop(new THREE.BufferGeometry().setFromPoints(tip), new THREE.LineBasicMaterial({ color: "#bae6fd", depthTest: false })));
  const label = createTextSprite(surface.label, "#e0f2fe", 0.024);
  const center = [...root, ...tip].reduce((sum, point) => sum.add(point), new THREE.Vector3()).multiplyScalar(1 / (root.length + tip.length));
  label.position.copy(center).add(new THREE.Vector3(0, 0, 0.02));
  group.add(label);
  return group;
}

function mirrorLiftingSurfacePreview(surface: LiftingSurfacePreview): LiftingSurfacePreview {
  return {
    ...surface,
    id: `${surface.id}:mirror-y`,
    label: `${surface.label} mirror`,
    mirrored: true,
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
  id: string;
  label: string;
  mirrored?: boolean;
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
    const zOffset = shape.zOffsetM ?? 0;
    const revolveAxis = touchedMirrorPlane?.points[0] && touchedMirrorPlane.points[1]
      ? {
        end: sidePointToPreviewVector(touchedMirrorPlane.points[1], stationX, touchedMirrorPlane.zOffsetM ?? 0),
        label: touchedMirrorPlane.label,
        start: sidePointToPreviewVector(touchedMirrorPlane.points[0], stationX, touchedMirrorPlane.zOffsetM ?? 0),
      }
      : undefined;
    const preview = {
      id: shape.id,
      label: shape.label,
      points: shape.points.map((point) => sidePointToPreviewVector(point, stationX, zOffset)),
      revolveAxis,
      role: shape.role,
    };
    if (Math.abs(stationX) <= 0.001) return [preview];
    return [preview, mirrorSideSketchPreview(preview)];
  });
}

function sidePointToPreviewVector(point: SizePoint, stationX: number, zOffset: number) {
  return new THREE.Vector3(stationX, point.yM, point.xM + zOffset);
}

function mirrorSideSketchPreview(sketch: SideSketchPreview): SideSketchPreview {
  const mirrorVector = (point: THREE.Vector3) => new THREE.Vector3(-point.x, point.y, point.z);
  return {
    ...sketch,
    id: `${sketch.id}:mirror-y`,
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
  const label = createTextSprite(sketch.label, "#e0f2fe", 0.024);
  const center = points.reduce((sum, point) => sum.add(point), new THREE.Vector3()).multiplyScalar(1 / points.length);
  label.position.copy(center).add(new THREE.Vector3(0, 0, 0.03));
  group.add(label);
  return group;
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
  const profileLine = new THREE.LineLoop(
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
  return group;
}

function createRevolvedBodyGroup(body: RevolvedBodyPreview, selected: boolean) {
  const group = new THREE.Group();
  group.name = body.label;
  const sourceProfile = body.shape.points.filter((point) => Number.isFinite(point.xM) && Number.isFinite(point.yM));
  if (sourceProfile.length < 2) return group;

  const axisStart = new THREE.Vector3(body.axis.start.xM, body.axis.start.yM, 0);
  const axisEnd = new THREE.Vector3(body.axis.end.xM, body.axis.end.yM, 0);
  const axisVector = axisEnd.clone().sub(axisStart);
  if (axisVector.lengthSq() <= 1e-10) return group;
  const axisDirection = axisVector.normalize();
  const projectedProfile = sourceProfile.map((point) => {
    const pointVector = new THREE.Vector3(point.xM, point.yM, 0);
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
    color: body.mirrored ? "#6fb7d6" : selected ? "#7dd3fc" : "#90cdf4",
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
    sourceProfile.map((point) => new THREE.Vector3(point.xM, point.yM, 0.004)),
  );
  const profileLine = new THREE.LineLoop(
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

  return group;
}

function shouldMirrorAcrossImplicitY(shape: SizeShape) {
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
    id: `${body.id}:mirror-y`,
    label: `${body.label} mirror`,
    mirrored: true,
    profile: body.profile.map(mirrorPoint),
    shape: {
      ...body.shape,
      id: `${body.shape.id}:mirror-y`,
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
    label: "Y=0 mirror",
  };
}

function createReferenceLayer(bounds: PreviewBounds, shapes: SizeShape[]) {
  const group = new THREE.Group();
  group.add(createScaleGrid(bounds));
  group.add(createAxisReference(bounds));
  group.add(createMirrorPlanes(shapes, bounds));
  return group;
}

function createScaleGrid(bounds: PreviewBounds) {
  const group = new THREE.Group();
  const gridSize = Math.max(bounds.widthM, bounds.lengthM, 0.2);
  const divisions = Math.max(8, Math.ceil(gridSize / 0.05));
  const grid = new THREE.GridHelper(gridSize, divisions, "#2f4657", "#172633");
  grid.rotation.x = Math.PI / 2;
  grid.position.set(bounds.centerX, bounds.centerY, -0.001);
  group.add(grid);

  const tickStep = scaleTickStep(gridSize);
  const xStart = Math.ceil(bounds.minX / tickStep) * tickStep;
  const xEnd = Math.floor(bounds.maxX / tickStep) * tickStep;
  for (let x = xStart; x <= xEnd + tickStep / 2; x += tickStep) {
    if (Math.abs(x) < tickStep / 10) continue;
    group.add(lineFromPoints([new THREE.Vector3(x, -0.006, 0.006), new THREE.Vector3(x, 0.006, 0.006)], new THREE.LineBasicMaterial({ color: "#5f7385" })));
    const label = createTextSprite(`${Math.round(x * 1000)}`, "#f8fbff", 0.03);
    label.position.set(x, -tickStep * 0.5, 0.012);
    group.add(label);
  }

  const yStart = Math.ceil(bounds.minY / tickStep) * tickStep;
  const yEnd = Math.floor(bounds.maxY / tickStep) * tickStep;
  for (let y = yStart; y <= yEnd + tickStep / 2; y += tickStep) {
    if (Math.abs(y) < tickStep / 10) continue;
    group.add(lineFromPoints([new THREE.Vector3(-0.006, y, 0.006), new THREE.Vector3(0.006, y, 0.006)], new THREE.LineBasicMaterial({ color: "#5f7385" })));
    const label = createTextSprite(`${Math.round(y * 1000)}`, "#f8fbff", 0.03);
    label.position.set(tickStep * 0.5, y, 0.012);
    group.add(label);
  }

  return group;
}

function createAxisReference(bounds: PreviewBounds) {
  const group = new THREE.Group();
  const xMaterial = new THREE.LineBasicMaterial({ color: "#7dd3fc", transparent: true, opacity: 0.72 });
  const yMaterial = new THREE.LineBasicMaterial({ color: "#facc15", transparent: true, opacity: 0.78 });
  const zMaterial = new THREE.LineBasicMaterial({ color: "#34d399", transparent: true, opacity: 0.72 });
  group.add(lineFromPoints([new THREE.Vector3(bounds.minX, 0, 0.01), new THREE.Vector3(bounds.maxX, 0, 0.01)], xMaterial));
  group.add(lineFromPoints([new THREE.Vector3(0, bounds.minY, 0.012), new THREE.Vector3(0, bounds.maxY, 0.012)], yMaterial));
  group.add(lineFromPoints([new THREE.Vector3(0, 0, bounds.minZ), new THREE.Vector3(0, 0, bounds.maxZ)], zMaterial));
  const xLabel = createTextSprite("X", "#7dd3fc", 0.036);
  xLabel.position.set(bounds.maxX, 0, 0.025);
  group.add(xLabel);
  const yLabel = createTextSprite("Y", "#facc15", 0.036);
  yLabel.position.set(0, bounds.maxY, 0.025);
  group.add(yLabel);
  const zLabel = createTextSprite("Z", "#34d399", 0.036);
  zLabel.position.set(0, 0, bounds.maxZ);
  group.add(zLabel);
  const originLabel = createTextSprite("origin", "#dbeafe", 0.022);
  originLabel.position.set(0.012, 0.012, 0.016);
  group.add(originLabel);
  return group;
}

function createMirrorPlanes(shapes: SizeShape[], bounds: PreviewBounds) {
  const group = new THREE.Group();
  const implicitPlane = createVerticalMirrorPlane(
    new THREE.Vector3(0, bounds.minY, 0),
    new THREE.Vector3(0, bounds.maxY, 0),
    bounds,
    "Y=0 mirror",
  );
  group.add(implicitPlane);

  for (const shape of shapes) {
    if (shape.role !== "mirrorPlane" || shape.points.length < 2) continue;
    if (shape.sketchViewMode === "side") {
      group.add(createSideViewMirrorPlane(shape, shapes, bounds));
      continue;
    }
    const [start, end] = shape.points;
    group.add(createVerticalMirrorPlane(
      new THREE.Vector3(start.xM, start.yM, 0),
      new THREE.Vector3(end.xM, end.yM, 0),
      bounds,
      shape.label,
    ));
  }
  return group;
}

function createSideViewMirrorPlane(shape: SizeShape, shapes: SizeShape[], bounds: PreviewBounds) {
  const [start, end] = shape.points;
  const stationX = sideViewStationX(shape, shapes) ?? 0;
  const zOffset = shape.zOffsetM ?? 0;
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

function createTextSprite(text: string, color: string, heightM: number) {
  const canvas = document.createElement("canvas");
  canvas.width = 512;
  canvas.height = 128;
  const context = canvas.getContext("2d");
  let labelWidthPx = 80;
  if (context) {
    context.clearRect(0, 0, canvas.width, canvas.height);
    context.font = "900 54px system-ui, -apple-system, BlinkMacSystemFont, Segoe UI, sans-serif";
    labelWidthPx = Math.min(canvas.width - 12, Math.max(54, context.measureText(text).width + 20));
    context.fillStyle = "rgba(5, 12, 18, 0.86)";
    context.fillRect((canvas.width - labelWidthPx) / 2, 18, labelWidthPx, 88);
    context.fillStyle = color;
    context.textAlign = "center";
    context.textBaseline = "middle";
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
    if (shape.sketchViewMode === "side" && !referenceRolesForPreview(shape)) {
      const touchedMirrorPlane = shapes.find(
        (candidate) => candidate.sketchViewMode === "side" && candidate.role === "mirrorPlane" && candidate.id !== shape.id && shapeTouchesMirrorPlane(shape, candidate),
      );
      const stationX = (touchedMirrorPlane ? sideViewStationX(touchedMirrorPlane, shapes) : undefined) ?? sideViewStationX(shape, shapes) ?? 0;
      xs.push(stationX);
      if (Math.abs(stationX) > 0.001) xs.push(-stationX);
      for (const point of shape.points) {
        ys.push(point.yM);
        zs.push(point.xM + (shape.zOffsetM ?? 0));
      }
      continue;
    }
    if (shape.role !== "mirrorPlane") continue;
    if (shape.sketchViewMode === "side") {
      const stationX = sideViewStationX(shape, shapes) ?? 0;
      xs.push(stationX);
      for (const point of shape.points) {
        ys.push(point.yM);
        zs.push(point.xM + (shape.zOffsetM ?? 0));
      }
      continue;
    }
    for (const point of shape.points) {
      xs.push(point.xM);
      ys.push(point.yM);
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
  if (sizeM <= 0.25) return 0.025;
  if (sizeM <= 0.8) return 0.05;
  if (sizeM <= 2) return 0.1;
  return 0.25;
}

function distancePointToAxis(point: SizePoint, start: SizePoint, end: SizePoint) {
  const dx = end.xM - start.xM;
  const dy = end.yM - start.yM;
  const length = Math.hypot(dx, dy);
  if (length <= 1e-9) return 0;
  return Math.abs((dy * point.xM - dx * point.yM + end.xM * start.yM - end.yM * start.xM) / length);
}

function fitCameraToGroups(camera: THREE.OrthographicCamera, controls: OrbitControls, groups: Array<THREE.Group | null>) {
  setCameraToView(camera, controls, groups, "top");
}

function setCameraToView(camera: THREE.OrthographicCamera, controls: OrbitControls, groups: Array<THREE.Group | null>, viewMode: CanvasViewMode | "orbit") {
  const box = boxForGroups(groups);
  if (box.isEmpty()) {
    camera.position.set(0, 0, 1);
    controls.target.set(0, 0, 0);
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
  controls.target.copy(center);
  controls.update();
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
