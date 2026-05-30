import { invoke } from "@tauri-apps/api/core";
import {
  Crosshair,
  Download,
  Hand,
  Maximize,
  MessageSquareText,
  MousePointer2,
  Orbit,
  Rocket,
  Settings,
  Sparkles,
  Trash2,
  Upload,
  ZoomIn,
} from "lucide-react";
import { useEffect, useMemo, useRef, useState } from "react";
import * as THREE from "three";
import { isKernelBridgeAvailable, runLocalDesignCommand } from "./ai";
import {
  appModeStorageKey,
  defaultModel,
  defaultPropulsionTabState,
  examplePrompt,
  projectStorageKey,
} from "./app/constants";
import type {
  AppMode,
  AircraftMasterState,
  AircraftProjectEntry,
  BrowserGroupId,
  OpenVspSizingResult,
  PropulsionTabState,
} from "./app/types";
import type { DisplayUnit } from "./app/constants";
import { ProjectBrowser } from "./components/browser/ProjectBrowser";
import { CadCanvas } from "./components/canvas/CadCanvas";
import { toDisplayUnit } from "./components/browser/units";
import { ComputeDashboard } from "./components/compute/ComputeDashboard";
import { FinalDashboard } from "./components/final/FinalDashboard";
import { EnduranceDashboard } from "./components/jet/EnduranceDashboard";
import { IJetDashboard } from "./components/jet/IJetDashboard";
import { ProjectMenu } from "./components/design/ProjectMenu";
import { JetDashboard } from "./components/jet/JetDashboard";
import { MaxDashboard } from "./components/max/MaxDashboard";
import { TimelineItem } from "./components/design/TimelineItem";
import { PropulsionWorkspace } from "./components/propulsion/propulsionPanels";
import { SizingDashboard } from "./components/sizing/sizingPanels";
import { DependencyInfoBar } from "./components/ui/DependencyInfoBar";
import { FormatMenu } from "./components/ui/FormatMenu";
import { PanelTitle } from "./components/ui/PanelTitle";
import { SettingsDialog } from "./components/ui/SettingsDialog";
import { ToolButton } from "./components/ui/ToolButton";
import { exportCurrentProject, importIntoProject, runAiDesignCommand } from "./lib/cadCommands";
import { fallbackProject } from "./lib/projectDefaults";
import {
  buildAircraftMasterState,
  createAircraftProject,
  deleteAircraftProject,
  fetchAircraftProject,
  listAircraftProjects,
  loadStoredAircraftState,
  loadStoredProject,
  normalizeCadProject,
  normalizePropulsionTabState,
  persistAircraftProject,
  upsertAircraftProject,
} from "./lib/persistence";
import { friendlyError, isTauriRuntime } from "./lib/tauriRuntime";
import { batteryMassFromSizing, rotorDefinitionFromSizing } from "./propulsionEngine";
import { SketchWorkspace } from "./SketchMode";
import { computeSizingAnalysis, defaultSizingProject, normalizeSizingProject } from "./sizing";
import type { SizingProject } from "./sizing";
import type { CadProject, GeometryFormat, SelectedGeometry, ToolMode } from "./types";
import { browserGroupIdForObject, selectionFromBrowserItem } from "./components/browser/browserSelection";

function formatSelectedContext(selectedGeometry: SelectedGeometry | null) {
  if (!selectedGeometry) return "none";
  const name = selectedGeometry.objectName ?? selectedGeometry.description;
  return `${name} (${selectedGeometry.type})`;
}

function loadStoredAppMode(): AppMode {
  const storedMode = localStorage.getItem(appModeStorageKey);
  if (storedMode === "design") return "final";
  return storedMode === "sizing" || storedMode === "sketch" || storedMode === "compute" || storedMode === "propulsion" || storedMode === "jet" || storedMode === "endurance" || storedMode === "ijet" || storedMode === "final" || storedMode === "max"
    ? storedMode
    : "sizing";
}

function isFetchFailure(error: unknown) {
  return error instanceof TypeError && String(error.message).includes("fetch");
}

function isStaleProjectSaveError(error: unknown) {
  return friendlyError(error).includes("stale project copy refused");
}

function savedStateUpdatedAt(serialized: string) {
  return parseSavedAircraftState(serialized)?.updatedAt;
}

function parseSavedAircraftState(serialized: string) {
  if (!serialized) return undefined;
  try {
    return JSON.parse(serialized) as AircraftMasterState;
  } catch {
    return undefined;
  }
}

function aircraftStateFingerprint(state: AircraftMasterState) {
  return JSON.stringify({
    id: state.id,
    name: state.name,
    project: state.project,
    propulsion: state.propulsion,
    schemaVersion: state.schemaVersion,
    sizing: state.sizing,
  });
}

function changedSinceLastSave<T>(base: T | undefined, pending: T) {
  return JSON.stringify(base) !== JSON.stringify(pending);
}

function projectWithoutSizing(project: CadProject) {
  const { sizing: _sizing, ...rest } = project;
  return rest;
}

function mergePendingAircraftChanges(
  base: AircraftMasterState | undefined,
  pending: AircraftMasterState,
  latest: AircraftMasterState,
): AircraftMasterState {
  if (!base) return pending;

  const nextSizing: SizingProject = { ...latest.sizing };
  const pendingSizing = pending.sizing;
  const baseSizing = base.sizing;

  if (changedSinceLastSave(baseSizing.mission, pendingSizing.mission)) {
    nextSizing.mission = { ...latest.sizing.mission, ...pendingSizing.mission };
  }
  if (changedSinceLastSave(baseSizing.shapes, pendingSizing.shapes)) nextSizing.shapes = pendingSizing.shapes;
  if (changedSinceLastSave(baseSizing.dimensions, pendingSizing.dimensions)) nextSizing.dimensions = pendingSizing.dimensions;
  if (changedSinceLastSave(baseSizing.sizingReferenceShapes, pendingSizing.sizingReferenceShapes)) {
    nextSizing.sizingReferenceShapes = pendingSizing.sizingReferenceShapes;
  }
  if (changedSinceLastSave(baseSizing.showSizingReference, pendingSizing.showSizingReference)) {
    nextSizing.showSizingReference = pendingSizing.showSizingReference;
  }
  if (changedSinceLastSave(baseSizing.sketchCanvasView, pendingSizing.sketchCanvasView)) {
    nextSizing.sketchCanvasView = pendingSizing.sketchCanvasView;
  }
  if (changedSinceLastSave(baseSizing.sketchScaleUnit, pendingSizing.sketchScaleUnit)) {
    nextSizing.sketchScaleUnit = pendingSizing.sketchScaleUnit;
  }
  if (changedSinceLastSave(baseSizing.selectedShapeId, pendingSizing.selectedShapeId)) nextSizing.selectedShapeId = pendingSizing.selectedShapeId;
  if (changedSinceLastSave(baseSizing.activeRole, pendingSizing.activeRole)) nextSizing.activeRole = pendingSizing.activeRole;
  if (changedSinceLastSave(baseSizing.drawMode, pendingSizing.drawMode)) nextSizing.drawMode = pendingSizing.drawMode;
  if (changedSinceLastSave(baseSizing.analysis, pendingSizing.analysis)) nextSizing.analysis = pendingSizing.analysis;

  const nextProject = changedSinceLastSave(projectWithoutSizing(base.project), projectWithoutSizing(pending.project))
    ? { ...pending.project, name: latest.name, sizing: nextSizing }
    : { ...latest.project, sizing: nextSizing };
  const nextPropulsion = changedSinceLastSave(base.propulsion, pending.propulsion) ? pending.propulsion : latest.propulsion;
  const nextName = changedSinceLastSave(base.name, pending.name) ? pending.name : latest.name;

  return {
    ...latest,
    name: nextName,
    project: { ...nextProject, name: nextName, sizing: nextSizing },
    propulsion: nextPropulsion,
    sizing: nextSizing,
    updatedAt: Date.now(),
  };
}

export default function App() {
  const [initialAircraftState] = useState(() => loadStoredAircraftState());
  const [appMode, setAppMode] = useState<AppMode>(() => loadStoredAppMode());
  const [project, setProject] = useState<CadProject>(() => initialAircraftState?.project ?? loadStoredProject() ?? fallbackProject());
  const [sizingProject, setSizingProject] = useState<SizingProject>(() =>
    normalizeSizingProject(initialAircraftState?.sizing ?? loadStoredProject()?.sizing),
  );
  const [propulsionState, setPropulsionState] = useState<PropulsionTabState>(() =>
    normalizePropulsionTabState(initialAircraftState?.propulsion),
  );
  const [prompt, setPrompt] = useState(examplePrompt);
  const [chatLog, setChatLog] = useState([
    {
      role: "assistant",
      text: "Tell me what to build. I can create parametric CAD features, show them in the canvas, and export STL or STEP artifacts.",
    },
  ]);
  const [activeTool, setActiveTool] = useState<ToolMode>("orbit");
  const [apiKey, setApiKey] = useState(() => localStorage.getItem("cadex.openaiApiKey") ?? "");
  const [model, setModel] = useState(() => localStorage.getItem("cadex.openaiModel") ?? defaultModel);
  const [dimensionPrecision, setDimensionPrecision] = useState(() =>
    Number(localStorage.getItem("cadex.dimensionPrecision") ?? "2"),
  );
  const [settingsOpen, setSettingsOpen] = useState(false);
  const [selectedTimelineEventId, setSelectedTimelineEventId] = useState<string | null>(null);
  const [selectedBrowserItemId, setSelectedBrowserItemId] = useState("project");
  const [hiddenBrowserItemIds, setHiddenBrowserItemIds] = useState<Set<string>>(() => new Set());
  const [selectedGeometry, setSelectedGeometry] = useState<SelectedGeometry | null>(null);
  const [status, setStatus] = useState("Ready");
  const [aircraftProjects, setAircraftProjects] = useState<AircraftProjectEntry[]>([]);
  const [activeAircraftProjectId, setActiveAircraftProjectId] = useState(
    () => localStorage.getItem("cadex.activeAircraftProjectId") ?? initialAircraftState?.id ?? "",
  );
  const [projectMenuOpen, setProjectMenuOpen] = useState(false);
  const activeAircraftProject = aircraftProjects.find((entry) => entry.id === activeAircraftProjectId);
  const saveTimerRef = useRef<number | undefined>(undefined);
  const lastSavedStateRef = useRef("");
  const loadedAircraftProjectIdRef = useRef("");
  const projectSyncInFlightRef = useRef(false);

  useEffect(() => {
    localStorage.setItem(appModeStorageKey, appMode);
  }, [appMode]);

  useEffect(() => {
    if (isTauriRuntime() && !loadStoredProject()) {
      invoke<CadProject>("create_project")
        .then((created) => setProject(loadStoredProject() ?? created))
        .catch(() => setProject(fallbackProject()));
    }
  }, []);

  useEffect(() => {
    if (activeAircraftProjectId) {
      const state = buildAircraftMasterState(activeAircraftProjectId, activeAircraftProject?.name ?? project.name, project, sizingProject, propulsionState);
      localStorage.setItem(projectStorageKey, JSON.stringify(state));
      return;
    }
    localStorage.setItem(projectStorageKey, JSON.stringify(project));
  }, [activeAircraftProject?.name, activeAircraftProjectId, project, propulsionState, sizingProject]);

  useEffect(() => {
    void refreshAircraftProjects();
  }, []);

  useEffect(() => {
    if (activeAircraftProjectId || !aircraftProjects.length) return;
    const currentName = project.name.trim().toLowerCase();
    if (!currentName) return;
    const matchingProject = aircraftProjects.find((entry) => entry.name.trim().toLowerCase() === currentName);
    if (!matchingProject) return;
    setActiveAircraftProjectId(matchingProject.id);
  }, [activeAircraftProjectId, aircraftProjects, project.name]);

  useEffect(() => {
    if (!activeAircraftProjectId || !aircraftProjects.length) return;
    if (aircraftProjects.some((entry) => entry.id === activeAircraftProjectId)) return;
    loadedAircraftProjectIdRef.current = "";
    lastSavedStateRef.current = "";
    localStorage.removeItem("cadex.activeAircraftProjectId");
    setActiveAircraftProjectId("");
  }, [activeAircraftProjectId, aircraftProjects]);

  useEffect(() => {
    if (!activeAircraftProjectId) return;
    localStorage.setItem("cadex.activeAircraftProjectId", activeAircraftProjectId);
    const activeStillExists = aircraftProjects.some((entry) => entry.id === activeAircraftProjectId);
    if (activeStillExists && loadedAircraftProjectIdRef.current !== activeAircraftProjectId) void loadAircraftProject(activeAircraftProjectId);
  }, [activeAircraftProjectId, aircraftProjects]);

  useEffect(() => {
    if (!activeAircraftProjectId) return;
    if (loadedAircraftProjectIdRef.current !== activeAircraftProjectId) return;
    const state = buildAircraftMasterState(activeAircraftProjectId, activeAircraftProject?.name ?? project.name, project, sizingProject, propulsionState);
    const serialized = JSON.stringify(state);
    if (serialized === lastSavedStateRef.current) return;
    if (saveTimerRef.current) window.clearTimeout(saveTimerRef.current);
    saveTimerRef.current = window.setTimeout(() => {
      saveTimerRef.current = undefined;
      void saveAircraftProject(activeAircraftProjectId, state);
    }, 450);
    return () => {
      if (saveTimerRef.current) {
        window.clearTimeout(saveTimerRef.current);
        saveTimerRef.current = undefined;
      }
    };
  }, [activeAircraftProject?.name, activeAircraftProjectId, project, propulsionState, sizingProject]);

  useEffect(() => {
    if (!activeAircraftProjectId) return undefined;
    if (loadedAircraftProjectIdRef.current !== activeAircraftProjectId) return undefined;
    let cancelled = false;

    async function syncLatestProject() {
      if (projectSyncInFlightRef.current) return;
      projectSyncInFlightRef.current = true;
      try {
        const latest = await fetchAircraftProject(activeAircraftProjectId);
        if (cancelled || loadedAircraftProjectIdRef.current !== activeAircraftProjectId) return;
        const remoteUpdatedAt = latest.state.updatedAt ?? latest.project.updatedAtMs;
        const localUpdatedAt = savedStateUpdatedAt(lastSavedStateRef.current);
        if (!remoteUpdatedAt || !localUpdatedAt || remoteUpdatedAt <= localUpdatedAt) return;

        const localState = buildAircraftMasterState(activeAircraftProjectId, activeAircraftProject?.name ?? project.name, project, sizingProject, propulsionState);
        const savedState = parseSavedAircraftState(lastSavedStateRef.current);
        const hasLocalEdits =
          !savedState ||
          aircraftStateFingerprint(localState) !== aircraftStateFingerprint(savedState) ||
          saveTimerRef.current !== undefined;
        setAircraftProjects((current) => upsertAircraftProject(current, latest.project));

        if (hasLocalEdits) {
          setStatus(`Newer ${latest.project.name} available in another browser; reload before editing further`);
          return;
        }

        applyAircraftMasterState(latest.state);
        loadedAircraftProjectIdRef.current = latest.project.id;
        lastSavedStateRef.current = JSON.stringify(latest.state);
        setStatus(`Reloaded latest ${latest.project.name}`);
      } catch {
        // Keep the current local copy if the bridge is momentarily unavailable.
      } finally {
        projectSyncInFlightRef.current = false;
      }
    }

    void syncLatestProject();
    const timer = window.setInterval(() => {
      void syncLatestProject();
    }, 2500);
    return () => {
      cancelled = true;
      window.clearInterval(timer);
    };
  }, [activeAircraftProject?.name, activeAircraftProjectId, project, propulsionState, sizingProject]);

  useEffect(() => {
    localStorage.setItem("cadex.openaiApiKey", apiKey);
  }, [apiKey]);

  useEffect(() => {
    localStorage.setItem("cadex.openaiModel", model);
  }, [model]);

  useEffect(() => {
    localStorage.setItem("cadex.dimensionPrecision", String(dimensionPrecision));
  }, [dimensionPrecision]);

  const selectedTimelineEvent = useMemo(
    () => project.timeline.find((event) => event.id === selectedTimelineEventId),
    [project.timeline, selectedTimelineEventId],
  );
  const selectedContextLabel = useMemo(() => formatSelectedContext(selectedGeometry), [selectedGeometry]);
  const liveSizingAnalysis = useMemo(
    () => (sizingProject.shapes.length ? computeSizingAnalysis(sizingProject) : sizingProject.analysis),
    [sizingProject],
  );

  async function submitPrompt() {
    const text = prompt.trim();
    if (!text) return;
    setPrompt("");
    setChatLog((log) => [...log, { role: "user", text }]);

    const kernelAvailable = await isKernelBridgeAvailable();
    const localResult = kernelAvailable ? undefined : runLocalDesignCommand(project, text, selectedGeometry);
    if (localResult) {
      setProject(localResult.project);
      setChatLog((log) => [...log, { role: "assistant", text: localResult.assistantText }]);
      setStatus("Design updated");
      return;
    }

    if (!apiKey.trim()) {
      setSettingsOpen(true);
      setStatus("OpenAI API key required");
      setChatLog((log) => [
        ...log,
        {
          role: "assistant",
          text: "Add your OpenAI API key in Settings before building. Cadex uses AI for design commands.",
        },
      ]);
      return;
    }

    setStatus("Asking CAD copilot...");

    try {
      const result = await runAiDesignCommand({
        apiKey: apiKey.trim(),
        model,
        message: text,
        project,
        selectedGeometry,
      });
      if (JSON.stringify(result.project) === JSON.stringify(project)) {
        throw new Error("The AI responded but did not change the CAD model. Try a more direct design command.");
      }
      setProject(result.project);
      setChatLog((log) => [...log, { role: "assistant", text: result.assistantText }]);
      setStatus("Design updated");
    } catch (error) {
      setStatus("Command failed");
      setChatLog((log) => [
        ...log,
        {
          role: "assistant",
          text: `The AI design command failed: ${friendlyError(error)}`,
        },
      ]);
    }
  }

  async function exportFormat(format: GeometryFormat) {
    setStatus(`Exporting ${format.toUpperCase()}...`);
    try {
      const result = await exportCurrentProject(project, format);
      if (!result) {
        setStatus("Export cancelled");
        return;
      }
      setProject((current) => ({
        ...current,
        timeline: [
          ...current.timeline,
          {
            id: crypto.randomUUID(),
            label: `${format.toUpperCase()} export`,
            detail: result.path,
          },
        ],
      }));
      setStatus(result.message);
    } catch (error) {
      setStatus(`Export failed: ${friendlyError(error)}`);
    }
  }

  async function importFormat(format: GeometryFormat) {
    setStatus(`Importing ${format.toUpperCase()}...`);
    try {
      const result = await importIntoProject(project, format);
      if (!result) {
        setStatus("Import cancelled");
        return;
      }
      setProject(result.project);
      setStatus(result.message);
    } catch (error) {
      setStatus(`Import failed: ${friendlyError(error)}`);
    }
  }

  function updateProjectUnits(units: DisplayUnit) {
    setProject((current) => ({ ...current, units }));
  }

  function deleteObject(objectId: string) {
    setProject((current) => {
      const object = current.objects.find((entry) => entry.id === objectId);
      if (!object) return current;
      return {
        ...current,
        objects: current.objects.filter((entry) => entry.id !== objectId),
        timeline: [
          ...current.timeline,
          {
            id: crypto.randomUUID(),
            label: "Deleted browser item",
            detail: object.name,
          },
        ],
      };
    });
    setHiddenBrowserItemIds((current) => {
      const next = new Set(current);
      next.delete(objectId);
      return next;
    });
    if (selectedBrowserItemId === objectId) setSelectedBrowserItemId("project");
    if (selectedGeometry?.objectId === objectId) setSelectedGeometry(null);
    setStatus("Deleted browser item");
  }

  function deleteBrowserGroup(groupId: BrowserGroupId) {
    const targetObjects = project.objects.filter((object) => browserGroupIdForObject(object) === groupId || groupId === "project");
    if (targetObjects.length === 0) return;
    const targetIds = new Set(targetObjects.map((object) => object.id));
    setProject((current) => ({
      ...current,
      objects: current.objects.filter((object) => !targetIds.has(object.id)),
      timeline: [
        ...current.timeline,
        {
          id: crypto.randomUUID(),
          label: "Deleted browser group",
          detail: `${targetObjects.length} item${targetObjects.length === 1 ? "" : "s"} removed`,
        },
      ],
    }));
    setHiddenBrowserItemIds((current) => {
      const next = new Set(current);
      next.delete(groupId);
      targetIds.forEach((id) => next.delete(id));
      return next;
    });
    if (targetIds.has(selectedBrowserItemId)) setSelectedBrowserItemId(groupId);
    if (selectedGeometry?.objectId && targetIds.has(selectedGeometry.objectId)) setSelectedGeometry(null);
    setStatus("Deleted browser group");
  }

  function toggleBrowserVisibility(id: string) {
    setHiddenBrowserItemIds((current) => {
      const next = new Set(current);
      if (next.has(id)) {
        next.delete(id);
      } else {
        next.add(id);
      }
      return next;
    });
  }

  function selectBrowserItem(id: string) {
    setSelectedBrowserItemId(id);
    setSelectedGeometry(selectionFromBrowserItem(id, project.objects));
  }

  function selectDependencyItem(id: string) {
    selectBrowserItem(id === "origin" ? "origin" : id);
  }

  function clearProject() {
    const emptyProject = fallbackProject();
    const emptySizing = defaultSizingProject();
    setProject({ ...emptyProject, sizing: emptySizing });
    setSizingProject(emptySizing);
    setPropulsionState(defaultPropulsionTabState);
    setSelectedTimelineEventId(null);
    setSelectedBrowserItemId("project");
    setSelectedGeometry(null);
    setPrompt("");
    setStatus("Project cleared");
  }

  function updateSizingProject(next: SizingProject) {
    setSizingProject(next);
    setProject((current) => ({ ...current, sizing: next }));
    setStatus("Sketch updated");
  }

  async function refreshAircraftProjects() {
    try {
      setAircraftProjects(await listAircraftProjects());
    } catch {
      setAircraftProjects([]);
    }
  }

  async function createAircraftProjectFromCurrent(name: string) {
    const projectName = name.trim();
    if (!projectName) return;
    const emptySizing = defaultSizingProject();
    const emptyProject = { ...fallbackProject(), name: projectName, sizing: emptySizing };
    const state = buildAircraftMasterState(undefined, projectName, emptyProject, emptySizing, defaultPropulsionTabState);
    try {
      const result = await createAircraftProject(projectName, state);
      applyAircraftMasterState(result.state);
      loadedAircraftProjectIdRef.current = result.project.id;
      lastSavedStateRef.current = JSON.stringify(result.state);
      setAircraftProjects((current) => upsertAircraftProject(current, result.project));
      setActiveAircraftProjectId(result.project.id);
      setProjectMenuOpen(false);
      setStatus(`Project saved: ${result.project.name}`);
    } catch (error) {
      setStatus(`Project save failed: ${friendlyError(error)}`);
    }
  }

  async function loadAircraftProject(projectId: string) {
    try {
      const result = await fetchAircraftProject(projectId);
      applyAircraftMasterState(result.state);
      loadedAircraftProjectIdRef.current = result.project.id;
      lastSavedStateRef.current = JSON.stringify(result.state);
      setAircraftProjects((current) => upsertAircraftProject(current, result.project));
      setStatus(`Project loaded: ${result.project.name}`);
    } catch (error) {
      setStatus(`Project load failed: ${friendlyError(error)}`);
    }
  }

  async function saveAircraftProject(projectId: string, state: AircraftMasterState) {
    const baseState = parseSavedAircraftState(lastSavedStateRef.current);
    try {
      const expectedUpdatedAt = lastSavedStateRef.current
        ? baseState?.updatedAt
        : undefined;
      const result = await persistAircraftProject(projectId, state, expectedUpdatedAt);
      lastSavedStateRef.current = JSON.stringify(result.state);
      setAircraftProjects((current) => upsertAircraftProject(current, result.project));
      setStatus(`Saved ${result.project.name}`);
    } catch (error) {
      if (isStaleProjectSaveError(error)) {
        try {
          const latest = await fetchAircraftProject(projectId);
          setAircraftProjects((current) => upsertAircraftProject(current, latest.project));
          const merged = mergePendingAircraftChanges(baseState, state, latest.state);
          if (aircraftStateFingerprint(merged) === aircraftStateFingerprint(latest.state)) {
            applyAircraftMasterState(latest.state);
            lastSavedStateRef.current = JSON.stringify(latest.state);
            setStatus("Reloaded latest aircraft");
            return;
          }
          const retry = await persistAircraftProject(projectId, merged, latest.state.updatedAt);
          applyAircraftMasterState(retry.state);
          lastSavedStateRef.current = JSON.stringify(retry.state);
          setAircraftProjects((current) => upsertAircraftProject(current, retry.project));
          setStatus(`Saved ${retry.project.name}`);
          return;
        } catch (retryError) {
          setStatus(`Project save failed: ${friendlyError(retryError)}`);
          return;
        }
      }
      setStatus(`Project save failed: ${friendlyError(error)}`);
    }
  }

  async function deleteAircraftProjectFromMenu(projectId: string) {
    const deletedProject = aircraftProjects.find((entry) => entry.id === projectId);
    try {
      const result = await deleteAircraftProject(projectId);
      setAircraftProjects(result.projects);
      if (activeAircraftProjectId === projectId) {
        const emptyProject = fallbackProject();
        const emptySizing = defaultSizingProject();
        loadedAircraftProjectIdRef.current = "";
        lastSavedStateRef.current = "";
        localStorage.removeItem("cadex.activeAircraftProjectId");
        setActiveAircraftProjectId("");
        setProject({ ...emptyProject, sizing: emptySizing });
        setSizingProject(emptySizing);
        setPropulsionState(defaultPropulsionTabState);
        setSelectedTimelineEventId(null);
        setSelectedBrowserItemId("project");
        setSelectedGeometry(null);
      }
      setStatus(`Deleted ${deletedProject?.name ?? "project"}`);
    } catch (error) {
      if (isFetchFailure(error)) {
        setAircraftProjects((current) => current.filter((entry) => entry.id !== projectId));
        if (activeAircraftProjectId === projectId) {
          clearLoadedAircraftProject();
        }
        setStatus(`Deleted ${deletedProject?.name ?? "project"} locally`);
        return;
      }
      setStatus(`Project delete failed: ${friendlyError(error)}`);
    }
  }

  function clearLoadedAircraftProject() {
    const emptyProject = fallbackProject();
    const emptySizing = defaultSizingProject();
    loadedAircraftProjectIdRef.current = "";
    lastSavedStateRef.current = "";
    localStorage.removeItem("cadex.activeAircraftProjectId");
    setActiveAircraftProjectId("");
    setProject({ ...emptyProject, sizing: emptySizing });
    setSizingProject(emptySizing);
    setPropulsionState(defaultPropulsionTabState);
    setSelectedTimelineEventId(null);
    setSelectedBrowserItemId("project");
    setSelectedGeometry(null);
  }

  function applyAircraftMasterState(state: AircraftMasterState) {
    const nextSizing = normalizeSizingProject(state.sizing);
    const nextProject = normalizeCadProject({ ...state.project, name: state.name, sizing: nextSizing });
    setSizingProject(nextSizing);
    setPropulsionState(normalizePropulsionTabState(state.propulsion));
    setProject(nextProject);
    setSelectedTimelineEventId(null);
    setSelectedBrowserItemId("project");
    setSelectedGeometry(null);
  }

  async function runOpenVspSizing() {
    if (!isTauriRuntime()) {
      setStatus("OpenVSP analysis requires the desktop app");
      return;
    }
    setStatus("Preparing OpenVSP analysis...");
    const sizingWithAnalysis = { ...sizingProject, analysis: computeSizingAnalysis(sizingProject) };
    setSizingProject(sizingWithAnalysis);
    setProject((current) => ({ ...current, sizing: sizingWithAnalysis }));
    try {
      const result = await invoke<OpenVspSizingResult>("analyze_sizing_openvsp", {
        request: {
          projectName: project.name,
          sizing: sizingWithAnalysis,
        },
      });
      setStatus(result.message);
      setProject((current) => ({
        ...current,
        timeline: [
          ...current.timeline,
          {
            id: crypto.randomUUID(),
            label: result.ranOpenvsp ? "OpenVSP sizing run" : "OpenVSP sizing script",
            detail: `${result.message} ${result.scriptPath}`,
          },
        ],
      }));
    } catch (error) {
      setStatus(`OpenVSP failed: ${friendlyError(error)}`);
    }
  }

  return (
    <div className="app-shell">
      <header className="toolbar">
        <div className="brand">
          <ProjectMenu
            activeProject={activeAircraftProject}
            currentName={project.name}
            open={projectMenuOpen}
            projects={aircraftProjects}
            onCreate={createAircraftProjectFromCurrent}
            onOpenChange={setProjectMenuOpen}
            onDelete={deleteAircraftProjectFromMenu}
            onSelect={(id) => {
              setActiveAircraftProjectId(id);
              setProjectMenuOpen(false);
            }}
          />
          <div className="mode-switch" aria-label="Application mode">
            <button className={appMode === "sizing" ? "active" : ""} onClick={() => setAppMode("sizing")}>
              Sizing
            </button>
            <button className={appMode === "sketch" ? "active" : ""} onClick={() => setAppMode("sketch")}>
              Sketch
            </button>
            <button className={appMode === "compute" ? "active" : ""} onClick={() => setAppMode("compute")}>
              Aero
            </button>
            <button className={appMode === "propulsion" ? "active" : ""} onClick={() => setAppMode("propulsion")}>
              Propulsion
            </button>
            <button className={appMode === "jet" ? "active" : ""} onClick={() => setAppMode("jet")}>
              Jet
            </button>
            <button className={appMode === "endurance" ? "active" : ""} onClick={() => setAppMode("endurance")}>
              Endurance
            </button>
            <button className={appMode === "ijet" ? "active" : ""} onClick={() => setAppMode("ijet")}>
              iJet
            </button>
            <button className={appMode === "max" ? "active" : ""} onClick={() => setAppMode("max")}>
              Max
            </button>
            <button className={appMode === "final" ? "active" : ""} onClick={() => setAppMode("final")}>
              Final
            </button>
          </div>
        </div>
        {appMode === "design" ? (
          <>
            <ToolButton active={activeTool === "select"} label="Select" onClick={() => setActiveTool("select")}>
              <MousePointer2 size={18} />
            </ToolButton>
            <ToolButton active={activeTool === "pan"} label="Pan" onClick={() => setActiveTool("pan")}>
              <Hand size={18} />
            </ToolButton>
            <ToolButton active={activeTool === "orbit"} label="Orbit" onClick={() => setActiveTool("orbit")}>
              <Orbit size={18} />
            </ToolButton>
            <ToolButton active={activeTool === "zoom"} label="Zoom" onClick={() => setActiveTool("zoom")}>
              <ZoomIn size={18} />
            </ToolButton>
            <ToolButton active={false} label="Zoom to fit" onClick={() => window.dispatchEvent(new Event("cadex:fit"))}>
              <Maximize size={18} />
            </ToolButton>
            <div className="toolbar-divider" />
            <FormatMenu
              icon={<Upload size={17} />}
              label="Import"
              ariaLabel="Import geometry"
              onPick={importFormat}
            />
            <FormatMenu
              icon={<Download size={17} />}
              label="Export"
              ariaLabel="Export geometry"
              onPick={exportFormat}
            />
            <button className="command-button danger" onClick={clearProject}>
              <Trash2 size={17} />
              Clear
            </button>
          </>
        ) : null}
        <button className="tool-button toolbar-settings-button" onClick={() => setSettingsOpen(true)} title="Settings" aria-label="Settings">
          <Settings size={18} />
        </button>
      </header>

      <DependencyInfoBar mode={appMode} />

      {appMode === "design" ? (
        <>
      <main className="workspace">
        <aside className="chat-panel left-copilot">
          <PanelTitle icon={<MessageSquareText size={18} />} title="Copilot" />
          <div className="copilot-status">
            <Sparkles size={16} />
            <span>{apiKey.trim() ? `AI active: ${model}` : "AI setup required"}</span>
          </div>
          <div className="chat-log">
            {chatLog.map((entry, index) => (
              <div className={`chat-bubble ${entry.role}`} key={`${entry.role}-${index}`}>
                {entry.text}
              </div>
            ))}
          </div>
          <div className="copilot-selected">
            <Crosshair size={15} />
            <span>selected: {selectedContextLabel}</span>
          </div>
          <div className="prompt-box">
            <textarea
              value={prompt}
              onChange={(event) => setPrompt(event.target.value)}
              onKeyDown={(event) => {
                if (event.key === "Enter" && !event.shiftKey) {
                  event.preventDefault();
                  void submitPrompt();
                }
              }}
            />
            <div className="prompt-actions">
              <button onClick={() => submitPrompt()}>
                <Sparkles size={16} />
                Build
              </button>
            </div>
          </div>
        </aside>

        <section className="canvas-panel">
          <CadCanvas
            objects={project.objects}
            activeTool={activeTool}
            hiddenBrowserItemIds={hiddenBrowserItemIds}
            selectedBrowserItemId={selectedBrowserItemId}
            onSelectionChange={setSelectedGeometry}
          />
        </section>

        <aside className="browser-panel">
          <ProjectBrowser
            dimensionPrecision={dimensionPrecision}
            objects={project.objects}
            projectName={project.name}
            hiddenBrowserItemIds={hiddenBrowserItemIds}
            selectedBrowserItemId={selectedBrowserItemId}
            selectedGeometry={selectedGeometry}
            unit={toDisplayUnit(project.units)}
            onDeleteGroup={deleteBrowserGroup}
            onDeleteObject={deleteObject}
            onPrecisionChange={setDimensionPrecision}
            onSelectDependencyItem={selectDependencyItem}
            onSelectItem={selectBrowserItem}
            onToggleVisibility={toggleBrowserVisibility}
            onUnitChange={updateProjectUnits}
          />
        </aside>
      </main>

      <footer className="timeline">
        <div className="timeline-title">
          <Crosshair size={17} />
          <span>Timeline</span>
        </div>
        <div className="timeline-events">
          {project.timeline.map((event, index) => (
            <TimelineItem
              active={event.id === selectedTimelineEventId}
              index={index}
              key={event.id}
              event={event}
              onSelect={() =>
                setSelectedTimelineEventId((current) => (current === event.id ? null : event.id))
              }
            />
          ))}
        </div>
        {selectedTimelineEvent ? (
          <div className="timeline-popover">
            <strong>{selectedTimelineEvent.label}</strong>
            <span>{selectedTimelineEvent.detail}</span>
          </div>
        ) : null}
      </footer>
        </>
      ) : appMode === "sizing" ? (
        <>
          <SizingDashboard
            analysis={liveSizingAnalysis}
            project={sizingProject}
            onProjectChange={updateSizingProject}
          />
        </>
      ) : appMode === "propulsion" ? (
        <>
          <PropulsionWorkspace
            aircraftMassKg={liveSizingAnalysis?.totalMassKg ?? 0}
            batteryEnergyDensityWhKg={sizingProject.mission.batteryEnergyDensityWhKg}
            batteryMassKg={batteryMassFromSizing(sizingProject)}
            rotorDefinition={rotorDefinitionFromSizing(sizingProject)}
            propulsionState={propulsionState}
            sizingProject={sizingProject}
            onPropulsionStateChange={setPropulsionState}
          />
        </>
      ) : appMode === "jet" ? (
        <>
          <JetDashboard
            aircraftMassKg={liveSizingAnalysis?.totalMassKg ?? 0}
            batteryEnergyDensityWhKg={sizingProject.mission.batteryEnergyDensityWhKg}
            propulsionState={propulsionState}
            sizingProject={sizingProject}
            onSizingProjectChange={updateSizingProject}
          />
        </>
      ) : appMode === "endurance" ? (
        <>
          <EnduranceDashboard
            aircraftMassKg={liveSizingAnalysis?.totalMassKg ?? 0}
            batteryEnergyDensityWhKg={sizingProject.mission.batteryEnergyDensityWhKg}
            propulsionState={propulsionState}
            sizingProject={sizingProject}
          />
        </>
      ) : appMode === "ijet" ? (
        <>
          <IJetDashboard
            aircraftMassKg={liveSizingAnalysis?.totalMassKg ?? 0}
            batteryEnergyDensityWhKg={sizingProject.mission.batteryEnergyDensityWhKg}
            propulsionState={propulsionState}
            sizingProject={sizingProject}
          />
        </>
      ) : appMode === "final" ? (
        <>
          <FinalDashboard
            aircraftMassKg={liveSizingAnalysis?.totalMassKg ?? 0}
            batteryEnergyDensityWhKg={sizingProject.mission.batteryEnergyDensityWhKg}
            propulsionState={propulsionState}
            projectName={activeAircraftProject?.name ?? project.name}
            sizingProject={sizingProject}
          />
        </>
      ) : appMode === "max" ? (
        <>
          <MaxDashboard
            project={sizingProject}
            onProjectChange={updateSizingProject}
          />
          <footer className="timeline size-footer">
            <div className="timeline-title">
              <Rocket size={17} />
              <span>Max result</span>
            </div>
            <div className="timeline-events">
              <span>Fixed aircraft and payload</span>
              <span>Battery, motor, prop, jet, fuel sweep</span>
            </div>
          </footer>
        </>
      ) : appMode === "compute" ? (
        <>
          <ComputeDashboard project={sizingProject} projectName={activeAircraftProject?.name ?? project.name} />
        </>
      ) : (
        <>
          <SketchWorkspace
            sizing={sizingProject}
            onChange={updateSizingProject}
            onOpenVspAnalysis={runOpenVspSizing}
          />
        </>
      )}
      {settingsOpen ? (
        <SettingsDialog
          apiKey={apiKey}
          model={model}
          onApiKeyChange={setApiKey}
          onClose={() => setSettingsOpen(false)}
          onModelChange={setModel}
        />
      ) : null}
      <div className="app-status-bar" role="status" aria-live="polite">
        {status}
      </div>
    </div>
  );
}
