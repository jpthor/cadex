import { Gauge, Ruler, Sparkles } from "lucide-react";
import { useEffect, useMemo, useRef, useState } from "react";
import { computeSizingAnalysis } from "../sizing/auditedSizingEngine";
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
  distanceBetweenPoints,
  enforceDimensions,
  insertPointOnNearestSegment,
  measureDimension,
  sameDimensionTarget,
  trimDimensionValue,
  motorLockPointIndices,
  motorSpanPoints,
  moveRotorEndpoint,
  moveShapePointWithConstraints,
  partShapePointsFromDraft,
  projectPointToShapeSegment,
  referenceEndpointPoint,
  resolveAttachedShapes,
  setSegmentMode,
  setTangentVector,
  updateShapePointForJoin,
} from "./geometry";
import { AircraftPanel, EngineComputePanel } from "./panels/aircraftPanel";
import { ShapeEditor, ShapeSelector } from "./panels/shapeEditor";
import type { AirfoilStation, DimensionDraft, JoinPointSelection, PendingDimension } from "./types";

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
  const [rightPaneTab, setRightPaneTab] = useState<"compute" | "aircraft" | "shape">("compute");
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
  const mirrorPlanes = useMemo(() => sizing.shapes.filter((shape) => shape.role === "mirrorPlane" && shape.points.length >= 2), [sizing.shapes]);
  const sizingReferenceShapes = sizing.sizingReferenceShapes ?? [];
  const showSizingReference = sizing.showSizingReference ?? true;

  useEffect(() => {
    sizingRef.current = sizing;
  }, [sizing]);

  useEffect(() => {
    function handleKeyDown(event: KeyboardEvent) {
      const target = event.target as HTMLElement | null;
      if (target?.closest("input, textarea, select")) return;
      if ((event.key === "Delete" || event.key === "Backspace") && selectedDimensionId) {
        event.preventDefault();
        deleteDimension(selectedDimensionId);
        return;
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
  }, [onChange, selectedDimensionId]);

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
    update({ shapes: enforceDimensions(attached, sizing.dimensions ?? []), selectedShapeId, analysis: undefined }, undoable);
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
    setPendingDimension({ targetA: dimensionDraft.firstTarget, targetB: target });
    setPendingDimensionValue(trimDimensionValue(measured));
  }

  function commitPendingDimension() {
    if (!pendingDimension) return;
    const valueM = Number(pendingDimensionValue);
    if (!Number.isFinite(valueM) || valueM <= 0) return;
    const nextDimension: SizeDimension = {
      id: `dimension-${crypto.randomUUID()}`,
      label: `D${(sizing.dimensions ?? []).length + 1}`,
      targetA: pendingDimension.targetA,
      targetB: pendingDimension.targetB,
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

  function finishShape() {
    if (draftPoints.length < 2) {
      setDrawActive(false);
      return;
    }
    if (activeRole === "part") {
      finishPartShape(draftPoints);
      return;
    }
    const newLiftingSurfaceKind: LiftingSurfaceKind = "wing";
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
    };
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
      rotorBladeCount: activePartType === "rotor" ? 2 : undefined,
    };
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
    if (target?.partType === "rotor") return;
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
    if (target.partType === "rotor") return;
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
    if (target?.partType === "rotor") {
      updateShapes(
        sizing.shapes.map((shape) =>
          shape.id === shapeId ? { ...shape, points: moveRotorEndpoint(shape.points, index, point) } : shape,
        ),
        shapeId,
        false,
      );
      return;
    }
    if (target?.partType === "motor") {
      updateShapes(
        sizing.shapes.map((shape) =>
          shape.id === shapeId
            ? updateShapePointForJoin(
                shape,
                index,
                moveShapePointWithConstraints(shape, index, motorSpanPoints(shape.points)[index] ?? shape.points[index], point, sizing.shapes),
              )
            : shape,
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
    if (target?.partType === "rotor") return;
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
    if (target?.partType === "rotor") return;
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
    const shapes = sizing.shapes.filter((shape) => shape.id !== selected.id);
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
          showSizingReference={showSizingReference}
          sizingReferenceShapes={sizingReferenceShapes}
          onToggleSizingReference={toggleSizingReference}
          onActiveRoleChange={(activeRole) => update({ activeRole }, false)}
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
          onSetPendingDimensionValue={setPendingDimensionValue}
          onCommitPendingDimension={commitPendingDimension}
          onCancelPendingDimension={cancelPendingDimension}
          onMoveDraftPoint={moveDraftPoint}
          onMoveShapePoint={moveShapePoint}
          onMoveShapeLine={moveShapeLine}
          onMoveShapePoints={moveShapePoints}
          onBeginUndoableEdit={pushUndoCheckpoint}
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
          <button className={rightPaneTab === "compute" ? "active" : ""} onClick={() => setRightPaneTab("compute")}>
            <Gauge size={15} />
            Compute
          </button>
          <button className={rightPaneTab === "aircraft" ? "active" : ""} onClick={() => setRightPaneTab("aircraft")}>
            <Sparkles size={15} />
            Aircraft
          </button>
          <button className={rightPaneTab === "shape" ? "active" : ""} onClick={() => setRightPaneTab("shape")}>
            <Ruler size={15} />
            Shape
          </button>
        </div>
        {rightPaneTab === "compute" ? (
          <EngineComputePanel />
        ) : rightPaneTab === "aircraft" ? (
          <AircraftPanel analysis={liveAnalysis} shapes={sizing.shapes} onDeleteAircraft={deleteAircraft} />
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
