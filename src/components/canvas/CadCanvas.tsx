import { useEffect, useRef } from "react";
import * as THREE from "three";
import { OrbitControls } from "three/examples/jsm/controls/OrbitControls.js";
import { buildMeasurementLines, meshObjectToMesh, referenceGeometryToObject, wingToMesh } from "../../geometry";
import type { CadObject, SelectedGeometry, ToolMode } from "../../types";
import type { CursorPlane } from "../../app/types";
import { isObjectHidden } from "../browser/units";
import { selectionFromBrowserItem } from "../browser/browserSelection";
import { createOriginReferenceGroup } from "./sceneHelpers";
import { updateActiveCursorPlane } from "./cursorPlane";
import {
  fitCameraToObject,
  pickBestIntersection,
  selectionFromIntersection,
  updateBrowserSelectionMarker,
  updateSelectionMarker,
} from "./selectionMath";
import { tupleToVector, vectorToTuple } from "./vectorUtils";

export function CadCanvas({
  objects,
  activeTool,
  hiddenBrowserItemIds,
  selectedBrowserItemId,
  onSelectionChange,
}: {
  objects: CadObject[];
  activeTool: ToolMode;
  hiddenBrowserItemIds: Set<string>;
  selectedBrowserItemId: string;
  onSelectionChange: (selection: SelectedGeometry | null) => void;
}) {
  const hostRef = useRef<HTMLDivElement | null>(null);
  const sceneRef = useRef<THREE.Scene | null>(null);
  const cameraRef = useRef<THREE.PerspectiveCamera | null>(null);
  const controlsRef = useRef<OrbitControls | null>(null);
  const geometryGroupRef = useRef<THREE.Group | null>(null);
  const staticSelectableObjectsRef = useRef<THREE.Object3D[]>([]);
  const selectableObjectsRef = useRef<THREE.Object3D[]>([]);
  const browserSelectionMarkerRef = useRef<THREE.Group | null>(null);
  const selectionMarkerRef = useRef<THREE.Group | null>(null);
  const hoverSelectionMarkerRef = useRef<THREE.Group | null>(null);
  const selectionChangeRef = useRef(onSelectionChange);
  const hoverSelectionRef = useRef<SelectedGeometry | null>(null);
  const pointerDownRef = useRef<{ x: number; y: number } | null>(null);
  const activeCursorPlaneRef = useRef<CursorPlane>({
    label: "XY",
    normal: new THREE.Vector3(0, 0, 1),
    point: new THREE.Vector3(0, 0, 0),
  });
  const previousObjectCountRef = useRef(0);

  useEffect(() => {
    selectionChangeRef.current = onSelectionChange;
  }, [onSelectionChange]);

  useEffect(() => {
    if (!hostRef.current) return;
    const host = hostRef.current;
    const scene = new THREE.Scene();
    scene.background = new THREE.Color("#111820");
    sceneRef.current = scene;

    const camera = new THREE.PerspectiveCamera(45, host.clientWidth / host.clientHeight, 0.001, 100);
    camera.position.set(0.9, 0.55, 1.2);
    cameraRef.current = camera;

    const renderer = new THREE.WebGLRenderer({ antialias: true });
    renderer.setPixelRatio(window.devicePixelRatio);
    renderer.setSize(host.clientWidth, host.clientHeight);
    renderer.shadowMap.enabled = true;
    host.appendChild(renderer.domElement);

    const controls = new OrbitControls(camera, renderer.domElement);
    controls.enableDamping = true;
    controls.target.set(0.08, 0, 0);
    controlsRef.current = controls;

    scene.add(new THREE.HemisphereLight("#eff6ff", "#23303b", 1.8));
    const key = new THREE.DirectionalLight("#ffffff", 2.4);
    key.position.set(2, 3, 2);
    scene.add(key);

    const grid = new THREE.GridHelper(2.4, 24, "#475569", "#22303d");
    grid.rotation.x = Math.PI / 2;
    scene.add(grid);
    const originReferences = createOriginReferenceGroup();
    staticSelectableObjectsRef.current = [originReferences];
    scene.add(originReferences);

    const originGeometry = new THREE.SphereGeometry(0.01, 16, 16);
    const originMaterial = new THREE.MeshBasicMaterial({ color: "#f97316" });
    scene.add(new THREE.Mesh(originGeometry, originMaterial));

    const group = new THREE.Group();
    geometryGroupRef.current = group;
    scene.add(group);

    const selectedMarker = new THREE.Group();
    selectionMarkerRef.current = selectedMarker;
    scene.add(selectedMarker);

    const hoverMarker = new THREE.Group();
    hoverSelectionMarkerRef.current = hoverMarker;
    scene.add(hoverMarker);

    const browserMarker = new THREE.Group();
    browserSelectionMarkerRef.current = browserMarker;
    scene.add(browserMarker);

    const raycaster = new THREE.Raycaster();
    raycaster.params.Line = { threshold: 0.008 };
    const pointer = new THREE.Vector2();
    const cursorPlane = new THREE.Plane();
    const cursorPlanePoint = new THREE.Vector3();
    const selectionAtPointer = (event: PointerEvent) => {
      const bounds = renderer.domElement.getBoundingClientRect();
      pointer.x = ((event.clientX - bounds.left) / bounds.width) * 2 - 1;
      pointer.y = -((event.clientY - bounds.top) / bounds.height) * 2 + 1;
      raycaster.setFromCamera(pointer, camera);

      const staticTargets = staticSelectableObjectsRef.current.filter((object) => object.visible);
      const hit = pickBestIntersection(
        raycaster.intersectObjects([...staticTargets, ...selectableObjectsRef.current], true),
      );
      const activeCursorPlane = activeCursorPlaneRef.current;
      cursorPlane.setFromNormalAndCoplanarPoint(activeCursorPlane.normal, activeCursorPlane.point);
      const selection = hit
        ? selectionFromIntersection(hit, camera, renderer.domElement, event.clientX, event.clientY)
        : raycaster.ray.intersectPlane(cursorPlane, cursorPlanePoint)
          ? {
              type: "plane" as const,
              objectName: `${activeCursorPlane.label} cursor plane`,
              position: vectorToTuple(cursorPlanePoint),
              normal: vectorToTuple(activeCursorPlane.normal),
              description: `${activeCursorPlane.label} cursor plane`,
            }
          : null;

      return selection;
    };

    const capturePointerStart = (event: PointerEvent) => {
      if (event.button !== 0) return;
      pointerDownRef.current = { x: event.clientX, y: event.clientY };
    };

    const commitSelection = (event: PointerEvent) => {
      if (event.button !== 0) return;
      const start = pointerDownRef.current;
      pointerDownRef.current = null;
      if (!start || Math.hypot(event.clientX - start.x, event.clientY - start.y) > 4) return;
      const selection = hoverSelectionRef.current ?? selectionAtPointer(event);
      if (!selection) return;
      updateActiveCursorPlane(activeCursorPlaneRef, selection);
      selectionChangeRef.current(selection);
      updateSelectionMarker(selectedMarker, selection);
    };

    const previewSelection = (event: PointerEvent) => {
      if (event.buttons) return;
      const selection = selectionAtPointer(event);
      hoverSelectionRef.current = selection;
      updateSelectionMarker(hoverMarker, selection);
    };

    const clearSelection = () => {
      hoverSelectionRef.current = null;
      updateSelectionMarker(hoverMarker, null);
    };
    renderer.domElement.addEventListener("pointermove", previewSelection);
    renderer.domElement.addEventListener("pointerdown", capturePointerStart);
    renderer.domElement.addEventListener("pointerup", commitSelection);
    renderer.domElement.addEventListener("pointerleave", clearSelection);

    const resize = () => {
      camera.aspect = host.clientWidth / host.clientHeight;
      camera.updateProjectionMatrix();
      renderer.setSize(host.clientWidth, host.clientHeight);
    };
    const fit = () => fitCameraToObject(camera, controls, group);
    window.addEventListener("resize", resize);
    window.addEventListener("cadex:fit", fit);

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
      window.removeEventListener("cadex:fit", fit);
      renderer.domElement.removeEventListener("pointermove", previewSelection);
      renderer.domElement.removeEventListener("pointerdown", capturePointerStart);
      renderer.domElement.removeEventListener("pointerup", commitSelection);
      renderer.domElement.removeEventListener("pointerleave", clearSelection);
      controls.dispose();
      renderer.dispose();
      host.removeChild(renderer.domElement);
    };
  }, []);

  useEffect(() => {
    for (const object of staticSelectableObjectsRef.current) {
      object.visible = !hiddenBrowserItemIds.has("project") && !hiddenBrowserItemIds.has("origin");
    }
  }, [hiddenBrowserItemIds]);

  useEffect(() => {
    const marker = browserSelectionMarkerRef.current;
    if (!marker) return;
    updateBrowserSelectionMarker(
      marker,
      selectedBrowserItemId,
      [...staticSelectableObjectsRef.current, ...selectableObjectsRef.current],
    );
    const selection = selectionFromBrowserItem(selectedBrowserItemId, objects);
    if (selection) updateActiveCursorPlane(activeCursorPlaneRef, selection);
  }, [selectedBrowserItemId, objects, hiddenBrowserItemIds]);

  useEffect(() => {
    const controls = controlsRef.current;
    if (!controls) return;
    controls.enablePan = activeTool === "pan" || activeTool === "orbit";
    controls.enableRotate = activeTool === "orbit";
    controls.enableZoom = activeTool === "zoom" || activeTool === "orbit";
  }, [activeTool]);

  useEffect(() => {
    const group = geometryGroupRef.current;
    const camera = cameraRef.current;
    const controls = controlsRef.current;
    if (!group || !camera || !controls) return;

    group.clear();
    selectableObjectsRef.current = [];
    for (const object of objects) {
      if (isObjectHidden(object, hiddenBrowserItemIds)) continue;

      if (object.kind === "wing") {
        const mesh = wingToMesh(object);
        mesh.castShadow = true;
        mesh.receiveShadow = true;
        mesh.userData.cadObject = {
          id: object.id,
          name: object.name,
          kind: "wing",
        };
        group.add(mesh);
        selectableObjectsRef.current.push(mesh);
        group.add(buildMeasurementLines(object));
      } else if (object.kind === "mesh" || object.kind === "solid") {
        const mesh = meshObjectToMesh(object);
        mesh.userData.cadObject = {
          id: object.id,
          name: object.name,
          kind: object.kind,
        };
        group.add(mesh);
        selectableObjectsRef.current.push(mesh);
      } else if (object.kind === "reference") {
        const reference = referenceGeometryToObject(object);
        reference.traverse((child) => {
          child.userData.cadObject = {
            id: object.id,
            name: object.name,
            kind: "reference",
            referenceKind: object.referenceKind,
          };
        });
        group.add(reference);
        selectableObjectsRef.current.push(reference);
      }
    }

    // Auto-fit only when the scene transitions from empty to populated, so the
    // camera doesn't jump every time the user tweaks parameters. The toolbar
    // "Zoom to fit" button still triggers an explicit refit via the cadex:fit event.
    const previousCount = previousObjectCountRef.current;
    if (previousCount === 0 && objects.length > 0) {
      fitCameraToObject(camera, controls, group);
    }
    previousObjectCountRef.current = objects.length;
    if (browserSelectionMarkerRef.current) {
      updateBrowserSelectionMarker(
        browserSelectionMarkerRef.current,
        selectedBrowserItemId,
        [...staticSelectableObjectsRef.current, ...selectableObjectsRef.current],
      );
    }
  }, [objects, hiddenBrowserItemIds]);

  return <div className="canvas-host" ref={hostRef} />;
}
