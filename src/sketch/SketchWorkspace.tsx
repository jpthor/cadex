import { Ruler, Sparkles } from "lucide-react";
import { useEffect, useMemo, useRef, useState } from "react";
import {
  batteryMassEstimate,
  batteryVolumeEstimate,
  computeSizingAnalysis,
  inferredBatteryThicknessM,
  liftingSurfaceStats,
  motorMassEstimate,
  motorDiameterEstimateM,
  motorLengthEstimateM,
  rotorDiameterEstimate,
  rotorInstanceCount,
  shapeBounds,
} from "../sizing/auditedSizingEngine";
import { computeSizingDraft } from "../components/sizing/sizingPanels";
import {
  liftingSurfaceKindLabels,
  partTypeLabels,
  roleLabels,
} from "../sizing";
import type {
  LiftingSurfaceKind,
  PartType,
  SizeDimension,
  SizeDimensionTarget,
  SizePoint,
  SizeShape,
  SizeShapeRole,
  SizingProject,
} from "../sizing";
import { SketchCanvas } from "./canvas/SketchCanvas";
import { drawablePartTypes, referenceRoles } from "./constants";
import {
  axisAlignedPoint,
  cleanPartDraftPoint,
  cloneSizingProject,
  closeIfNearCenterline,
  cadGeometryForShape,
  distanceBetweenPoints,
  enforceDimensions,
  implicitMirrorShapeId,
  insertPointOnNearestSegment,
  measureDimension,
  sameDimensionTarget,
  trimDimensionValue,
  motorDepthM,
  moveConstrainedPartPoint,
  motorLockPointIndices,
  moveShapePointWithConstraints,
  partShapePointsFromDraft,
  projectPointToShapeSegment,
  referenceEndpointPoint,
  resolveAttachedShapes,
  setSegmentMode,
  setTangentVector,
  updateShapePointForJoin,
} from "./geometry";
import { AircraftPanel } from "./panels/aircraftPanel";
import { ShapeEditor, ShapeSelector } from "./panels/shapeEditor";
import { Metric } from "./panels/shared";
import type { AirfoilStation, CanvasViewMode, DimensionDraft, JoinPointSelection, PendingDimension } from "./types";

export function SketchWorkspace({
  sizing,
  onChange,
  onOpenVspAnalysis,
}: {
  sizing: SizingProject;
  onChange: (next: SizingProject) => void;
  onOpenVspAnalysis?: () => void | Promise<void>;
}) {
  const [draftPoints, setDraftPoints] = useState<SizePoint[]>([]);
  const [draftPreviewPoint, setDraftPreviewPoint] = useState<SizePoint | null>(null);
  const [drawActive, setDrawActive] = useState(false);
  const [undoStack, setUndoStack] = useState<SizingProject[]>([]);
  const [redoStack, setRedoStack] = useState<SizingProject[]>([]);
  const sizingRef = useRef(sizing);
  const undoStackRef = useRef<SizingProject[]>([]);
  const redoStackRef = useRef<SizingProject[]>([]);
  const [activeAirfoilStation, setActiveAirfoilStation] = useState<AirfoilStation>("root10");
  const [activeLiftingSurfaceKind, setActiveLiftingSurfaceKind] = useState<LiftingSurfaceKind>("wing");
  const [rightPaneTab, setRightPaneTab] = useState<"aircraft" | "suggested" | "shape">("aircraft");
  const [joinSourcePoint, setJoinSourcePoint] = useState<JoinPointSelection | null>(null);
  const [dimensionDraft, setDimensionDraft] = useState<DimensionDraft>(null);
  const [dimensionToolActive, setDimensionToolActive] = useState(false);
  const [pendingDimension, setPendingDimension] = useState<PendingDimension>(null);
  const [pendingDimensionValue, setPendingDimensionValue] = useState("");
  const [selectedDimensionId, setSelectedDimensionId] = useState<string | null>(null);
  const selected = sizing.shapes.find((shape) => shape.id === sizing.selectedShapeId);
  const activeRole = sizing.activeRole ?? "body";
  const [activePartType, setActivePartType] = useState<PartType>("payload");
  const liveAnalysis = useMemo(() => (sizing.shapes.length ? computeSizingAnalysis(sizing) : sizing.analysis), [sizing]);
  const computedSizingDraft = useMemo(() => computeSizingDraft(sizing), [sizing]);
  const mirrorPlanes = useMemo(() => sizing.shapes.filter((shape) => shape.role === "mirrorPlane" && shape.points.length >= 2), [sizing.shapes]);
  const sizingReferenceShapes = sizing.sizingReferenceShapes ?? [];
  const suggestedShapeSource = sizingReferenceShapes.length ? sizingReferenceShapes : computedSizingDraft.shapes;
  const selectedSuggestedShapeSource = sizingReferenceShapes.length
    ? [...sizingReferenceShapes, ...computedSizingDraft.shapes]
    : computedSizingDraft.shapes;
  const selectedTarget = selected ? selectedSuggestedTarget(selected) : undefined;
  const matchedSuggestedRows = selected
    ? suggestedRowsForSelectedShape(selected, selectedSuggestedShapeSource, computedSizingDraft.rotorDiameterM)
    : [];
  const selectedSuggestedRows = matchedSuggestedRows.length
    ? matchedSuggestedRows
    : selectedTarget?.role === "part" && selectedTarget.partType === "battery"
      ? batteryDimensionRowsFromDraft(computedSizingDraft)
      : [];
  const showSizingReference = sizing.showSizingReference ?? true;

  useEffect(() => {
    sizingRef.current = sizing;
  }, [sizing]);

  useEffect(() => {
    const rotorBladeCount = sizing.mission.rotorBladeCount;
    if (!Number.isFinite(rotorBladeCount)) return;
    if (!sizing.shapes.some((shape) => shape.role === "part" && shape.partType === "rotor" && shape.rotorBladeCount !== rotorBladeCount)) return;
    const next = {
      ...sizing,
      shapes: sizing.shapes.map((shape) =>
        shape.role === "part" && shape.partType === "rotor" ? { ...shape, rotorBladeCount } : shape,
      ),
      analysis: undefined,
    };
    sizingRef.current = next;
    onChange(next);
  }, [onChange, sizing]);

  useEffect(() => {
    function handleKeyDown(event: KeyboardEvent) {
      const target = event.target as HTMLElement | null;
      if (target?.closest("input, textarea, select")) return;
      if (isDeleteKey(event) && selectedDimensionId) {
        event.preventDefault();
        deleteDimension(selectedDimensionId);
        return;
      }
      if (isDeleteKey(event) && !drawActive) {
        const selectedShapeId = sizingRef.current.selectedShapeId;
        if (selectedShapeId && sizingRef.current.shapes.some((shape) => shape.id === selectedShapeId)) {
          event.preventDefault();
          deleteShapeById(selectedShapeId);
          return;
        }
      }
      if (!(event.ctrlKey || event.metaKey) || event.key.toLowerCase() !== "z") return;
      event.preventDefault();
      if (event.shiftKey) {
        const next = redoStackRef.current[redoStackRef.current.length - 1];
        if (!next) return;
        setHistoryStacks([...undoStackRef.current, cloneSizingProject(sizingRef.current)], redoStackRef.current.slice(0, -1));
        restoreHistoryProject(next);
        return;
      }
      const previous = undoStackRef.current[undoStackRef.current.length - 1];
      if (!previous) return;
      setHistoryStacks(undoStackRef.current.slice(0, -1), [...redoStackRef.current, cloneSizingProject(sizingRef.current)]);
      restoreHistoryProject(previous);
    }
    window.addEventListener("keydown", handleKeyDown);
    return () => window.removeEventListener("keydown", handleKeyDown);
  }, [drawActive, onChange, selectedDimensionId]);

  useEffect(() => {
    if (selected) setRightPaneTab("shape");
  }, [selected?.id]);

  function update(next: Partial<SizingProject>, undoable = true) {
    if (undoable) pushUndoCheckpoint();
    const nextProject = { ...sizingRef.current, ...next };
    sizingRef.current = nextProject;
    onChange(nextProject);
  }

  function setHistoryStacks(undo: SizingProject[], redo: SizingProject[]) {
    undoStackRef.current = undo;
    redoStackRef.current = redo;
    setUndoStack(undo);
    setRedoStack(redo);
  }

  function pushUndoCheckpoint() {
    setHistoryStacks([...undoStackRef.current, cloneSizingProject(sizingRef.current)], []);
  }

  function restoreHistoryProject(project: SizingProject) {
    setDraftPoints([]);
    setDraftPreviewPoint(null);
    setDrawActive(false);
    setDimensionDraft(null);
    setDimensionToolActive(false);
    setPendingDimension(null);
    setPendingDimensionValue("");
    setSelectedDimensionId(null);
    const restored = cloneSizingProject(project);
    sizingRef.current = restored;
    onChange(restored);
  }

  function updateShapes(shapes: SizeShape[], selectedShapeId = sizing.selectedShapeId, undoable = true) {
    const attached = resolveAttachedShapes(shapes);
    const dimensioned = enforceDimensions(attached, sizing.dimensions ?? []);
    update({ shapes: dimensioned.map((shape) => withCadGeometry(shape, dimensioned)), selectedShapeId, analysis: undefined }, undoable);
  }

  function withCadGeometry(shape: SizeShape, shapes: SizeShape[] = sizing.shapes): SizeShape {
    return referenceRoles.includes(shape.role) ? { ...shape, cadGeometry: undefined } : { ...shape, cadGeometry: cadGeometryForShape(shape, shapes) };
  }

  function selectJoinPoint(shapeId: string, pointIndex: number) {
    setSelectedDimensionId(null);
    setJoinSourcePoint({ shapeId, pointIndex });
    update({ selectedShapeId: shapeId }, false);
  }

  function selectDimension(id: string) {
    setJoinSourcePoint(null);
    setSelectedDimensionId(id);
    update({ selectedShapeId: "" }, false);
  }

  function deleteDimension(id: string) {
    setSelectedDimensionId(null);
    const dimensions = (sizing.dimensions ?? []).filter((dimension) => dimension.id !== id);
    update(
      {
        dimensions,
        shapes: enforceDimensions(sizing.shapes, dimensions),
        analysis: undefined,
      },
      true,
    );
  }

  function selectDimensionTarget(target: SizeDimensionTarget) {
    if (!dimensionToolActive) return;
    if (!dimensionDraft) {
      setDimensionDraft({ firstTarget: target });
      return;
    }
    if (sameDimensionTarget(dimensionDraft.firstTarget, target)) return;
    const measured = measureDimension(dimensionDraft.firstTarget, target, sizing.shapes);
    setDimensionDraft(null);
    if (!measured || measured <= 0) return;
    createDimension(dimensionDraft.firstTarget, target, measured);
  }

  function createDimension(targetA: SizeDimensionTarget, targetB: SizeDimensionTarget, valueM: number) {
    if (!Number.isFinite(valueM) || valueM <= 0) return;
    const nextDimension: SizeDimension = {
      id: `dimension-${crypto.randomUUID()}`,
      label: `D${(sizing.dimensions ?? []).length + 1}`,
      targetA,
      targetB,
      valueM,
    };
    setPendingDimension(null);
    setPendingDimensionValue("");
    setDimensionToolActive(false);
    update(
      {
        dimensions: [...(sizing.dimensions ?? []), nextDimension],
        shapes: enforceDimensions(sizing.shapes, [...(sizing.dimensions ?? []), nextDimension]),
        analysis: undefined,
      },
      true,
    );
  }

  function commitPendingDimension() {
    if (!pendingDimension) return;
    createDimension(pendingDimension.targetA, pendingDimension.targetB, Number(pendingDimensionValue));
  }

  function cancelPendingDimension() {
    setPendingDimension(null);
    setPendingDimensionValue("");
  }

  function updateSelected(patch: Partial<SizeShape>) {
    if (!selected) return;
    if (patch.partType === "rotor") setJoinSourcePoint(null);
    updateShapes(sizing.shapes.map((shape) => (shape.id === selected.id ? { ...shape, ...patch } : shape)));
  }

  function addDraftPoint(point: SizePoint) {
    if (activeRole === "part") {
      const nextPoint = cleanPartDraftPoint(point);
      if (!draftPoints.length) {
        setDraftPoints([nextPoint]);
        return;
      }
      finishPartShape([draftPoints[0], nextPoint]);
      return;
    }
    const axisLockedPoint =
      referenceRoles.includes(activeRole) && draftPoints.length === 1 ? axisAlignedPoint(draftPoints[0], point) : point;
    const nextPoint = { ...axisLockedPoint, xM: Math.abs(axisLockedPoint.xM), curveMode: axisLockedPoint.curveMode ?? "spline" };
    setDraftPoints((points) => {
      const nextPoints = [...points, nextPoint];
      if (referenceRoles.includes(activeRole) && nextPoints.length >= 2) {
        window.setTimeout(() => finishReferenceShape(nextPoints.slice(0, 2)), 0);
      }
      return nextPoints;
    });
  }

  function finishReferenceShape(points: SizePoint[]) {
    const lockedPoints = points.length >= 2 ? [points[0], axisAlignedPoint(points[0], points[1])] : points;
    const count = sizing.shapes.filter((shape) => shape.role === activeRole).length + 1;
    const shape: SizeShape = {
      id: `${activeRole}-${crypto.randomUUID()}`,
      role: activeRole,
      label: `${roleLabels[activeRole]} ${count}`,
      drawMode: "line",
      points: lockedPoints.map((point) => ({
        ...point,
        xM: Math.abs(point.xM),
        curveMode: "corner",
        segmentInMode: "corner",
        segmentOutMode: "corner",
        tangentIn: undefined,
        tangentOut: undefined,
      })),
    };
    setDraftPoints([]);
    setDraftPreviewPoint(null);
    setDrawActive(false);
    updateShapes([...sizing.shapes, shape], shape.id);
  }

  function finishShape(viewMode: CanvasViewMode = "top") {
    if (draftPoints.length < 2) {
      setDrawActive(false);
      return;
    }
    if (activeRole === "part") {
      finishPartShape(draftPoints);
      return;
    }
    const newLiftingSurfaceKind: LiftingSurfaceKind = activeRole === "liftingSurface" && viewMode === "side" ? "fin" : activeLiftingSurfaceKind;
    const count = sizing.shapes.filter(
      (shape) =>
        shape.role === activeRole &&
        (activeRole !== "liftingSurface" || (shape.liftingSurfaceKind ?? "wing") === newLiftingSurfaceKind),
    ).length + 1;
    const labelBase = activeRole === "liftingSurface" ? liftingSurfaceKindLabels[newLiftingSurfaceKind] : roleLabels[activeRole];
    const shape: SizeShape = {
      id: `${activeRole}-${crypto.randomUUID()}`,
      role: activeRole,
      label: `${labelBase} ${count}`,
      drawMode: "spline",
      points: closeIfNearCenterline(draftPoints),
      airfoil: activeRole === "liftingSurface" ? "NACA 0012" : undefined,
      liftingSurfaceKind: activeRole === "liftingSurface" ? newLiftingSurfaceKind : undefined,
      airfoilStations: activeRole === "liftingSurface" ? { root10: "NACA 0012", tip90: "NACA 0012" } : undefined,
      incidenceDeg: activeRole === "liftingSurface" ? 0 : undefined,
      incidenceStationsDeg: activeRole === "liftingSurface" ? { root10: 0, tip90: 0 } : undefined,
      massKg: activeRole === "body" ? 0.5 : activeRole === "liftingSurface" ? 0.15 : 0,
      bodyMaterial: activeRole === "body" || activeRole === "liftingSurface" ? "carbonFibre" : undefined,
      bodyThicknessMm: activeRole === "body" || activeRole === "liftingSurface" ? 1.2 : undefined,
      partType: undefined,
      rotorBladeCount: undefined,
      sketchViewMode: activeRole === "liftingSurface" && viewMode !== "top" ? viewMode : undefined,
    };
    shape.cadGeometry = cadGeometryForShape(shape, [...sizing.shapes, shape]);
    setDraftPoints([]);
    setDraftPreviewPoint(null);
    setDrawActive(false);
    updateShapes([...sizing.shapes, shape], shape.id);
  }

  function finishPartShape(points: SizePoint[]) {
    const partPoints = partShapePointsFromDraft(activePartType, points);
    if (partPoints.length < 2) {
      setDrawActive(false);
      return;
    }
    const count = sizing.shapes.filter((shape) => shape.role === "part" && (shape.partType ?? "payload") === activePartType).length + 1;
    const shape: SizeShape = {
      id: `part-${crypto.randomUUID()}`,
      role: "part",
      label: `${partTypeLabels[activePartType]} ${count}`,
      drawMode: "line",
      points: partPoints,
      massKg: 0,
      partType: activePartType,
      rotorBladeCount: activePartType === "rotor" ? sizing.mission.rotorBladeCount : undefined,
    };
    shape.cadGeometry = cadGeometryForShape(shape, [...sizing.shapes, shape]);
    setDraftPoints([]);
    setDraftPreviewPoint(null);
    setDrawActive(false);
    updateShapes([...sizing.shapes, shape], shape.id);
  }

  function cancelDraft() {
    setDraftPoints([]);
    setDraftPreviewPoint(null);
    setDrawActive(false);
  }

  function toggleDraftPoint(index: number) {
    setDraftPoints((points) =>
      points.map((point, pointIndex) =>
        pointIndex === index
          ? { ...point, curveMode: point.curveMode === "corner" ? ("spline" as const) : ("corner" as const) }
          : point,
      ),
    );
  }

  function insertShapePoint(shapeId: string, point: SizePoint) {
    const target = sizing.shapes.find((shape) => shape.id === shapeId);
    if (target?.role === "part") return;
    const inserted = target ? insertPointOnNearestSegment(target.points, point) : undefined;
    updateShapes(
      sizing.shapes.map((shape) =>
        shape.id === shapeId && inserted ? { ...shape, points: inserted.points } : shape,
      ),
      shapeId,
    );
    if (inserted) setJoinSourcePoint({ shapeId, pointIndex: inserted.index });
  }

  function deleteShapePoint(shapeId: string, index: number) {
    const target = sizing.shapes.find((shape) => shape.id === shapeId);
    if (!target) return;
    if (target.role === "part") return;
    if (joinSourcePoint?.shapeId === shapeId && joinSourcePoint.pointIndex === index) {
      setJoinSourcePoint(null);
    }
    if (target.points.length <= 2) {
      const shapes = sizing.shapes.filter((shape) => shape.id !== shapeId);
      updateShapes(shapes, shapes[0]?.id ?? "");
      return;
    }
    updateShapes(
      sizing.shapes.map((shape) =>
        shape.id === shapeId ? { ...shape, points: shape.points.filter((_, pointIndex) => pointIndex !== index) } : shape,
      ),
      shapeId,
    );
  }

  function moveDraftPoint(index: number, point: SizePoint) {
    setDraftPoints((points) =>
      points.map((entry, pointIndex) => {
        if (pointIndex !== index) return entry;
        if (activeRole === "part") return cleanPartDraftPoint(point);
        if (referenceRoles.includes(activeRole) && points.length >= 2) {
          const anchor = points[index === 0 ? 1 : 0];
          return referenceEndpointPoint(points, anchor, point);
        }
        return { ...entry, xM: Math.abs(point.xM), yM: point.yM };
      }),
    );
  }

  function moveShapePoint(shapeId: string, index: number, point: SizePoint) {
    const target = sizing.shapes.find((shape) => shape.id === shapeId);
    if (target?.role === "part" && target.partType !== "electronics") {
      updateShapes(
        sizing.shapes.map((shape) =>
          shape.id === shapeId ? { ...shape, points: moveConstrainedPartPoint(shape, index, point) } : shape,
        ),
        shapeId,
        false,
      );
      return;
    }
    updateShapes(
      sizing.shapes.map((shape) =>
        shape.id === shapeId
          ? {
              ...shape,
              points: shape.points.map((entry, pointIndex) =>
                pointIndex === index ? moveShapePointWithConstraints(shape, index, entry, point, sizing.shapes) : entry,
              ),
            }
          : shape,
      ),
      shapeId,
      false,
    );
  }

  function moveShapeLine(shapeId: string, points: SizePoint[]) {
    updateShapes(
      sizing.shapes.map((shape) =>
        shape.id === shapeId && referenceRoles.includes(shape.role)
          ? {
              ...shape,
              points,
            }
          : shape,
      ),
      shapeId,
      false,
    );
  }

  function moveShapePoints(shapeId: string, points: SizePoint[]) {
    updateShapes(
      sizing.shapes.map((shape) =>
        shape.id === shapeId && !referenceRoles.includes(shape.role)
          ? {
              ...shape,
              points,
            }
          : shape,
      ),
      shapeId,
      false,
    );
  }

  function moveDimensionLabel(dimensionId: string, labelOffset: SizePoint) {
    update(
      {
        dimensions: (sizing.dimensions ?? []).map((dimension) =>
          dimension.id === dimensionId
            ? {
                ...dimension,
                labelOffset: { xM: labelOffset.xM, yM: labelOffset.yM },
              }
            : dimension,
        ),
      },
      false,
    );
  }

  function joinSelectedPointToNode(masterShapeId: string, masterPointIndex: number) {
    const source = joinSourcePoint ?? nextMotorLockSource(masterShapeId);
    if (!source) return;
    if (source.shapeId === masterShapeId && source.pointIndex === masterPointIndex) return;
    const masterShape = sizing.shapes.find((shape) => shape.id === masterShapeId);
    const masterPoint = masterShape?.points[masterPointIndex];
    if (!masterShape || !masterPoint) return;
    updateJoinedSourcePoint(source, {
      ...masterPoint,
      xM: Math.abs(masterPoint.xM),
      snapAttachment: { kind: "node", shapeId: masterShapeId, pointIndex: masterPointIndex },
    });
  }

  function joinSelectedPointToSegment(masterShapeId: string, point: SizePoint) {
    const source = joinSourcePoint ?? nextMotorLockSource(masterShapeId);
    if (!source || source.shapeId === masterShapeId) return;
    if (masterShapeId === implicitMirrorShapeId) {
      const t = point.snapAttachment?.shapeId === implicitMirrorShapeId && point.snapAttachment.kind === "segment"
        ? point.snapAttachment.t
        : (point.yM + 1000) / 2000;
      updateJoinedSourcePoint(source, {
        ...point,
        xM: 0,
        snapAttachment: { kind: "segment", shapeId: implicitMirrorShapeId, segmentIndex: 0, t },
      });
      return;
    }
    const masterShape = sizing.shapes.find((shape) => shape.id === masterShapeId);
    if (!masterShape || masterShape.points.length < 2) return;
    let best = { segmentIndex: 0, t: 0, point: masterShape.points[0], distanceM: Number.POSITIVE_INFINITY };
    for (let segmentIndex = 0; segmentIndex < masterShape.points.length - 1; segmentIndex += 1) {
      const projection = projectPointToShapeSegment(point, masterShape.points, segmentIndex);
      const distanceM = distanceBetweenPoints(point, projection.point);
      if (distanceM < best.distanceM) {
        best = { segmentIndex, t: projection.t, point: projection.point, distanceM };
      }
    }
    updateJoinedSourcePoint(source, {
      ...best.point,
      xM: Math.abs(best.point.xM),
      snapAttachment: { kind: "segment", shapeId: masterShapeId, segmentIndex: best.segmentIndex, t: best.t },
    });
  }

  function nextMotorLockSource(masterShapeId: string): JoinPointSelection | null {
    const motor = selected?.role === "part" && selected.partType === "motor" && selected.id !== masterShapeId ? selected : undefined;
    if (!motor) return null;
    const lockIndices = motorLockPointIndices(motor);
    const unlocked = lockIndices.find((index) => !motor.points[index]?.snapAttachment);
    const pointIndex = unlocked ?? lockIndices[0];
    return pointIndex === undefined ? null : { shapeId: motor.id, pointIndex };
  }

  function updateJoinedSourcePoint(source: JoinPointSelection, joinedPoint: SizePoint) {
    const nextJoinSource = nextMotorLockSourceAfterJoin(source);
    updateShapes(
      sizing.shapes.map((shape) =>
        shape.id === source.shapeId
          ? updateShapePointForJoin(shape, source.pointIndex, joinedPoint)
          : shape,
      ),
      source.shapeId,
    );
    setJoinSourcePoint(nextJoinSource);
  }

  function nextMotorLockSourceAfterJoin(source: JoinPointSelection): JoinPointSelection | null {
    const shape = sizing.shapes.find((candidate) => candidate.id === source.shapeId);
    if (shape?.role !== "part" || shape.partType !== "motor") return joinSourcePoint;
    const lockIndices = motorLockPointIndices(shape);
    const currentIndex = lockIndices.indexOf(source.pointIndex);
    const nextIndex = lockIndices.slice(currentIndex + 1).find((index) => !shape.points[index]?.snapAttachment);
    return nextIndex === undefined ? null : { shapeId: source.shapeId, pointIndex: nextIndex };
  }

  function setDraftSegmentMode(index: number, side: "in" | "out", mode: "corner" | "spline") {
    setDraftPoints((points) => setSegmentMode(points, index, side, mode));
  }

  function setShapeSegmentMode(shapeId: string, index: number, side: "in" | "out", mode: "corner" | "spline") {
    const target = sizing.shapes.find((shape) => shape.id === shapeId);
    if (target?.role === "part") return;
    updateShapes(
      sizing.shapes.map((shape) =>
        shape.id === shapeId ? { ...shape, points: setSegmentMode(shape.points, index, side, mode) } : shape,
      ),
      shapeId,
    );
  }

  function moveDraftTangent(index: number, side: "in" | "out", point: SizePoint) {
    setDraftPoints((points) => setTangentVector(points, index, side, point));
  }

  function moveShapeTangent(shapeId: string, index: number, side: "in" | "out", point: SizePoint) {
    const target = sizing.shapes.find((shape) => shape.id === shapeId);
    if (target?.role === "part") return;
    updateShapes(
      sizing.shapes.map((shape) =>
        shape.id === shapeId ? { ...shape, points: setTangentVector(shape.points, index, side, point) } : shape,
      ),
      shapeId,
      false,
    );
  }

  function removeSelected() {
    if (!selected) return;
    deleteShapeById(selected.id);
  }

  function deleteShapeById(shapeId: string) {
    const shapes = sizingRef.current.shapes.filter((shape) => shape.id !== shapeId);
    setJoinSourcePoint((source) => (source?.shapeId === shapeId ? null : source));
    setSelectedDimensionId(null);
    updateShapes(shapes, shapes[0]?.id ?? "");
  }

  function deleteAircraft() {
    setDraftPoints([]);
    setDraftPreviewPoint(null);
    setDrawActive(false);
    update({ shapes: [], selectedShapeId: "", analysis: undefined });
  }

  function compute() {
    update({ analysis: computeSizingAnalysis(sizing) }, false);
  }

  function toggleSizingReference() {
    update({ showSizingReference: !showSizingReference }, false);
  }

  return (
    <main className="sketch-workspace">
      <section className="size-canvas-panel sizing-canvas-panel">
        <SketchCanvas
          analysis={liveAnalysis}
          draftPoints={draftPoints}
          draftPreviewPoint={draftPreviewPoint}
          draftRole={activeRole}
          drawActive={drawActive}
          dimensionDraft={dimensionDraft}
          dimensions={sizing.dimensions ?? []}
          dimensionToolActive={dimensionToolActive}
          selectedDimensionId={selectedDimensionId}
          pendingDimension={pendingDimension}
          pendingDimensionValue={pendingDimensionValue}
          activePartType={activePartType}
          initialCanvasView={sizing.sketchCanvasView}
          showSizingReference={showSizingReference}
          sizingReferenceShapes={sizingReferenceShapes}
          onCanvasViewChange={(sketchCanvasView) => update({ sketchCanvasView }, false)}
          onToggleSizingReference={toggleSizingReference}
          onActiveRoleChange={(activeRole) => update({ activeRole }, false)}
          activeLiftingSurfaceKind={activeLiftingSurfaceKind}
          onActiveLiftingSurfaceKindChange={setActiveLiftingSurfaceKind}
          onActivePartTypeChange={setActivePartType}
          onCancel={cancelDraft}
          onAddPoint={addDraftPoint}
          onDone={finishShape}
          onSelect={(selectedShapeId) => update({ selectedShapeId }, false)}
          onSelectDimension={selectDimension}
          onSetPreviewPoint={setDraftPreviewPoint}
          onSetDrawActive={(active) => {
            if (active) setDraftPreviewPoint(null);
            setDrawActive(active);
            if (active) {
              setDimensionToolActive(false);
              setDimensionDraft(null);
            }
          }}
          onSetDimensionToolActive={(active) => {
            setDimensionToolActive(active);
            setDimensionDraft(null);
            if (active) setDrawActive(false);
          }}
          onMoveDraftPoint={moveDraftPoint}
          onMoveShapePoint={moveShapePoint}
          onMoveShapeLine={moveShapeLine}
          onMoveShapePoints={moveShapePoints}
          onMoveDimensionLabel={moveDimensionLabel}
          onBeginUndoableEdit={pushUndoCheckpoint}
          onDeleteDimension={deleteDimension}
          onSelectPoint={selectJoinPoint}
          onSelectDimensionTarget={selectDimensionTarget}
          onJoinToPoint={joinSelectedPointToNode}
          onJoinToSegment={joinSelectedPointToSegment}
          onMoveDraftTangent={moveDraftTangent}
          onMoveShapeTangent={moveShapeTangent}
          onSetDraftSegmentMode={setDraftSegmentMode}
          onSetShapeSegmentMode={setShapeSegmentMode}
          activeAirfoilStation={activeAirfoilStation}
          onActiveAirfoilStationChange={setActiveAirfoilStation}
          onToggleDraftPoint={toggleDraftPoint}
          onInsertShapePoint={insertShapePoint}
          onDeleteShapePoint={deleteShapePoint}
          selectedShapeId={sizing.selectedShapeId}
          joinSourcePoint={joinSourcePoint}
          shapes={sizing.shapes}
        />
      </section>

      <aside className="size-panel sizing-right-panel">
        <div className="sizing-pane-tabs" aria-label="Sizing panel tabs">
          <button className={rightPaneTab === "suggested" ? "active" : ""} onClick={() => setRightPaneTab("suggested")}>
            <Ruler size={15} />
            Suggested
          </button>
          <button className={rightPaneTab === "shape" ? "active" : ""} onClick={() => setRightPaneTab("shape")}>
            <Ruler size={15} />
            Shape
          </button>
          <button className={rightPaneTab === "aircraft" ? "active" : ""} onClick={() => setRightPaneTab("aircraft")}>
            <Sparkles size={15} />
            Aircraft
          </button>
        </div>
        {rightPaneTab === "aircraft" ? (
          <AircraftPanel analysis={liveAnalysis} shapes={sizing.shapes} onDeleteAircraft={deleteAircraft} />
        ) : rightPaneTab === "suggested" ? (
          <SuggestedDimensionsPanel
            currentShapes={sizing.shapes}
            sizingRotorDiameterM={computedSizingDraft.rotorDiameterM}
            suggestedShapes={suggestedShapeSource}
          />
        ) : (
          <>
            <ShapeSelector
              selectedShapeId={sizing.selectedShapeId}
              shapes={sizing.shapes}
              onSelect={(selectedShapeId) => update({ selectedShapeId }, false)}
            />
            {selected ? (
              <ShapeEditor
                activeAirfoilStation={activeAirfoilStation}
                mirrorPlanes={mirrorPlanes}
                shape={selected}
                suggestedRows={selectedSuggestedRows}
                onActiveAirfoilStationChange={setActiveAirfoilStation}
                onChange={updateSelected}
                onDelete={removeSelected}
              />
            ) : (
              <p className="empty-text">Draw a body, lifting surface, or part to edit it.</p>
            )}
          </>
        )}
      </aside>
    </main>
  );
}

function SuggestedDimensionsPanel({
  currentShapes,
  sizingRotorDiameterM,
  suggestedShapes,
}: {
  currentShapes: SizeShape[];
  sizingRotorDiameterM: number;
  suggestedShapes: SizeShape[];
}) {
  const sourceShapes = suggestedShapes.length ? suggestedShapes : currentShapes;
  const usefulShapes = sourceShapes.filter((shape) => !referenceRoles.includes(shape.role));
  if (!usefulShapes.length) {
    return (
      <div className="aircraft-panel suggested-dimensions-panel">
        <div className="aircraft-parameter-title">Suggested dimensions</div>
        <p className="empty-text">Compute a suggested aircraft or draw key parts to see dimensions here.</p>
      </div>
    );
  }
  const bodies = usefulShapes.filter((shape) => shape.role === "body");
  const lifting = usefulShapes.filter((shape) => shape.role === "liftingSurface");
  const parts = usefulShapes.filter((shape) => shape.role === "part");
  const fuselage = bodies.filter((shape) => !shape.id.includes("tail-boom"));
  const otherBodies = bodies.filter((shape) => shape.id.includes("tail-boom"));
  const wings = lifting.filter((shape) => (shape.liftingSurfaceKind ?? "wing") === "wing");
  const otherLifting = lifting.filter((shape) => (shape.liftingSurfaceKind ?? "wing") !== "wing");
  const totalLengthM = totalShapeLengthM(usefulShapes);
  const wingRootDepthM = wingRootDepthFromNoseM(usefulShapes);
  const aircraftRows = [
    { label: "Total length", value: formatDimension(totalLengthM) },
    ...(wingRootDepthM === null ? [] : [{ label: "Wing root depth", value: `${formatDimension(wingRootDepthM)} from nose` }]),
  ];
  return (
    <div className="aircraft-panel suggested-dimensions-panel">
      <div className="aircraft-parameter-title">Suggested dimensions</div>
      <SuggestedShapeCard title="Aircraft" rows={aircraftRows} />
      {fuselage.map((shape) => (
        <SuggestedShapeCard key={shape.id} title={suggestedShapeTitle(shape)} rows={bodyDimensionRows(shape)} />
      ))}
      {wings.map((shape) => (
        <SuggestedShapeCard key={shape.id} title={suggestedShapeTitle(shape)} rows={liftingDimensionRows(shape, sourceShapes)} />
      ))}
      {parts.map((shape) => (
        <SuggestedShapeCard key={shape.id} title={suggestedShapeTitle(shape)} rows={partDimensionRows(shape, sourceShapes, sizingRotorDiameterM)} />
      ))}
      {otherBodies.map((shape) => (
        <SuggestedShapeCard key={shape.id} title={suggestedShapeTitle(shape)} rows={bodyDimensionRows(shape)} />
      ))}
      {otherLifting.map((shape) => (
        <SuggestedShapeCard key={shape.id} title={suggestedShapeTitle(shape)} rows={liftingDimensionRows(shape, sourceShapes)} />
      ))}
    </div>
  );
}

function SuggestedShapeCard({ rows, title }: { rows: Array<{ label: string; value: string }>; title: string }) {
  return (
    <section className="suggested-dimension-card">
      <h3>{title}</h3>
      {rows.map((row) => (
        <Metric key={row.label} label={row.label} value={row.value} />
      ))}
    </section>
  );
}

function totalShapeLengthM(shapes: SizeShape[]) {
  const bounds = shapes.map(shapeBounds);
  const minY = Math.min(...bounds.map((entry) => entry.minY));
  const maxY = Math.max(...bounds.map((entry) => entry.maxY));
  return Math.max(maxY - minY, 0);
}

function wingRootDepthFromNoseM(shapes: SizeShape[]) {
  const wing = shapes.find((shape) => shape.role === "liftingSurface" && (shape.liftingSurfaceKind ?? "wing") === "wing");
  if (!wing || !shapes.length) return null;
  const noseY = Math.max(...shapes.map((shape) => shapeBounds(shape).maxY));
  const wingBounds = shapeBounds(wing);
  const wingRootCenterY = (wingBounds.minY + wingBounds.maxY) / 2;
  return Math.max(noseY - wingRootCenterY, 0);
}

function suggestedShapeTitle(shape: SizeShape) {
  if (shape.role === "body") return shape.id.includes("tail-boom") ? "Tail boom" : "Fuselage";
  if (shape.role === "liftingSurface") return liftingSurfaceKindLabels[shape.liftingSurfaceKind ?? "wing"];
  if (shape.role === "part") return partTypeLabels[shape.partType ?? "payload"];
  return shape.label || roleLabels[shape.role];
}

function bodyDimensionRows(shape: SizeShape) {
  const bounds = shapeBounds(shape);
  const localWidthM = bounds.maxX - bounds.minX;
  const widthM = shape.id.includes("tail-boom") && localWidthM > 0 ? localWidthM : bounds.maxX * 2;
  return [
    { label: "Length", value: formatDimension(bounds.maxY - bounds.minY) },
    { label: "Width", value: formatDimension(widthM) },
    { label: "Material", value: shape.bodyMaterial ? shape.bodyMaterial.replace(/([A-Z])/g, " $1").toLowerCase() : "carbon fibre" },
    { label: "Skin thickness", value: `${(shape.bodyThicknessMm ?? 1.2).toFixed(1)} mm` },
  ];
}

function liftingDimensionRows(shape: SizeShape, shapes: SizeShape[]) {
  const stats = liftingSurfaceStats(shape, shapes);
  const kind = shape.liftingSurfaceKind ?? "wing";
  const totalAreaLabel = kind === "tailplane" ? "Total tailplane area" : kind === "wing" ? "Total wing area" : "Total area";
  const bounds = shapeBounds(shape);
  const mirroredPair = bounds.minX > 0.005;
  if (kind === "tailplane") {
    const spanPerTailplaneM = Math.max(bounds.maxX - bounds.minX, 0.05);
    const areaPerTailplaneM2 = mirroredPair ? stats.areaM2 / 2 : stats.areaM2;
    return [
      { label: "Span / tailplane", value: formatDimension(spanPerTailplaneM) },
      { label: "Mean chord / tailplane", value: formatDimension(areaPerTailplaneM2 / Math.max(spanPerTailplaneM, 0.01)) },
      { label: totalAreaLabel, value: `${stats.areaM2.toFixed(3)} m2` },
      ...(mirroredPair ? [{ label: "Area / tailplane", value: `${areaPerTailplaneM2.toFixed(3)} m2` }] : []),
      { label: "Airfoil", value: shape.airfoil ?? "NACA 0012" },
    ];
  }
  return [
    { label: "Span", value: formatDimension(stats.spanM) },
    { label: "Half-span", value: formatDimension(stats.spanM / 2) },
    { label: "Mean chord", value: formatDimension(stats.chordM) },
    { label: totalAreaLabel, value: `${stats.areaM2.toFixed(3)} m2` },
    { label: "Airfoil", value: shape.airfoil ?? "NACA 0012" },
  ];
}

function partDimensionRows(shape: SizeShape, shapes: SizeShape[], sizingRotorDiameterM?: number) {
  const bounds = shapeBounds(shape);
  const baseRows = [
    { label: "Length", value: formatDimension(bounds.maxY - bounds.minY) },
    { label: "Width", value: formatDimension(bounds.maxX * 2) },
  ];
  if (shape.partType === "battery") {
    return [
      { label: "Length", value: formatDimension(bounds.maxY - bounds.minY) },
      { label: "Width", value: formatDimension(bounds.maxX * 2) },
      { label: "Height", value: formatDimension(inferredBatteryThicknessM(shape)) },
      { label: "Volume", value: `${(batteryVolumeEstimate(shape) * 1000).toFixed(2)} L` },
      { label: "Mass", value: `${batteryMassEstimate(shape).toFixed(3)} kg` },
    ];
  }
  if (shape.partType === "rotor") {
    const diameterM = shape.id.startsWith("sizing-ref-") && sizingRotorDiameterM ? sizingRotorDiameterM : rotorDiameterEstimate(shape, shapes);
    return [
      { label: "Diameter", value: formatDimension(diameterM) },
      { label: "Blades", value: `${Math.max(1, Math.round(shape.rotorBladeCount ?? 2))}` },
      { label: "Physical count", value: `${rotorInstanceCount(shape, shapes)}` },
    ];
  }
  if (shape.partType === "motor") {
    return [
      { label: "Diameter", value: formatDimension(motorDiameterEstimateM(shape)) },
      { label: "Length", value: formatDimension(motorLengthEstimateM(shape)) },
      { label: "Depth", value: formatDimension(motorDepthM(shape)) },
      { label: "Total motor mass", value: `${motorMassEstimate(shape).toFixed(3)} kg` },
    ];
  }
  return baseRows;
}

function batteryDimensionRowsFromDraft(draft: ReturnType<typeof computeSizingDraft>) {
  return [
    { label: "Length", value: formatDimension(draft.batteryEnvelope.lengthM) },
    { label: "Width", value: formatDimension(draft.batteryEnvelope.widthM) },
    { label: "Height", value: formatDimension(draft.batteryEnvelope.heightM) },
    { label: "Mass", value: `${draft.batteryMassKg.toFixed(3)} kg` },
  ];
}

function suggestedRowsForSelectedShape(selected: SizeShape, suggestedShapes: SizeShape[], sizingRotorDiameterM: number) {
  const target = selectedSuggestedTarget(selected);
  if (!target) return [];
  const suggested = suggestedShapes.find((shape) => {
    if (target.role === "liftingSurface") {
      return shape.role === "liftingSurface" && (shape.liftingSurfaceKind ?? "wing") === target.liftingSurfaceKind;
    }
    return shape.role === "part" && (shape.partType ?? "payload") === target.partType;
  });
  if (!suggested) return [];
  if (suggested.role === "liftingSurface") return liftingDimensionRows(suggested, suggestedShapes);
  if (suggested.role === "part") return partDimensionRows(suggested, suggestedShapes, sizingRotorDiameterM);
  return [];
}

function selectedSuggestedTarget(shape: SizeShape):
  | { role: "liftingSurface"; liftingSurfaceKind: LiftingSurfaceKind }
  | { role: "part"; partType: PartType }
  | undefined {
  const label = shape.label.toLowerCase();
  const partFromName = partTypeFromName(label);
  if (partFromName) return { role: "part", partType: partFromName };
  const liftingFromName = liftingKindFromName(label);
  if (liftingFromName) return { role: "liftingSurface", liftingSurfaceKind: liftingFromName };
  if (shape.role === "part") {
    const partType = shape.partType ?? "payload";
    return partType === "battery" || partType === "motor" || partType === "rotor" ? { role: "part", partType } : undefined;
  }
  if (shape.role === "liftingSurface") {
    const liftingSurfaceKind = shape.liftingSurfaceKind ?? "wing";
    return liftingSurfaceKind === "wing" || liftingSurfaceKind === "tailplane" || liftingSurfaceKind === "fin" ? { role: "liftingSurface", liftingSurfaceKind } : undefined;
  }
  return undefined;
}

function partTypeFromName(label: string): PartType | undefined {
  if (/\bbatter(y|ies)\b/.test(label)) return "battery";
  if (/\bmotors?\b/.test(label)) return "motor";
  if (/\b(prop|props|propeller|propellers|rotor|rotors)\b/.test(label)) return "rotor";
  return undefined;
}

function liftingKindFromName(label: string): LiftingSurfaceKind | undefined {
  if (/\btail\s*planes?\b|\btailplanes?\b/.test(label)) return "tailplane";
  if (/\bfins?\b|\bvertical\s+tails?\b/.test(label)) return "fin";
  if (/\bwings?\b/.test(label)) return "wing";
  return undefined;
}

function isDeleteKey(event: KeyboardEvent) {
  return event.key === "Delete" || event.key === "Backspace" || event.code === "Delete" || event.code === "NumpadDecimal";
}

function formatDimension(valueM: number) {
  if (!Number.isFinite(valueM) || valueM <= 0) return "0 mm";
  return valueM >= 1 ? `${valueM.toFixed(2)} m` : `${(valueM * 1000).toFixed(0)} mm`;
}
