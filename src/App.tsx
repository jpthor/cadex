import { invoke } from "@tauri-apps/api/core";
import { open as openFileDialog, save as saveFileDialog } from "@tauri-apps/plugin-dialog";
import {
  Box,
  ChevronDown,
  ChevronRight,
  Crosshair,
  Download,
  Eye,
  EyeOff,
  FolderTree,
  Hand,
  Maximize,
  MessageSquareText,
  MousePointer2,
  Orbit,
  Plane,
  Ruler,
  Settings,
  Sparkles,
  Trash2,
  Upload,
  ZoomIn,
} from "lucide-react";
import { useEffect, useMemo, useRef, useState } from "react";
import * as THREE from "three";
import { OrbitControls } from "three/examples/jsm/controls/OrbitControls.js";
import { isKernelBridgeAvailable, runLocalDesignCommand, sendOpenAiDesignMessage } from "./ai";
import { buildMeasurementLines, meshObjectToMesh, projectToStl, referenceGeometryToObject, wingToMesh } from "./geometry";
import { SizeWorkspace, SizingSummaryFooter, defaultSizingProject, normalizeSizingProject } from "./SizeMode";
import type { SizingProject } from "./SizeMode";
import { computeSizingAnalysis } from "./sizingEngine";
import type {
  CadObject,
  CadProject,
  GeometryFormat,
  ReferenceGeometry,
  SelectedGeometry,
  TimelineEvent,
  ToolMode,
  Wing,
  WingObject,
} from "./types";

const examplePrompt = "create a 40mm diameter round solid, 120mm long, on the XZ plane";
const defaultModel = "gpt-5";
const projectStorageKey = "cadex.project";
const unitOptions = ["m", "cm", "mm", "in", "ft"] as const;
type DisplayUnit = (typeof unitOptions)[number];
type AppMode = "design" | "size";
type OpenVspSizingResult = {
  scriptPath: string;
  vsp3Path: string;
  ranOpenvsp: boolean;
  message: string;
  stdout: string;
  stderr: string;
};
type BrowserContextTarget = {
  canDelete?: boolean;
  canHide?: boolean;
  groupId?: BrowserGroupId;
  id: string;
  label: string;
  objectId?: string;
};
type BrowserGroupId = "project" | "section:bodies" | "section:surfaces" | "section:sketches" | "section:planes" | "origin";
type CursorPlane = {
  label: string;
  normal: THREE.Vector3;
  point: THREE.Vector3;
};

function fallbackProject(): CadProject {
  return {
    id: crypto.randomUUID(),
    name: "Untitled part",
    units: "m",
    objects: [],
    timeline: [
      {
        id: crypto.randomUUID(),
        label: "Project created",
        detail: "Ready for a parametric CAD command.",
      },
    ],
  };
}

function formatSelectedContext(selectedGeometry: SelectedGeometry | null) {
  if (!selectedGeometry) return "none";
  const name = selectedGeometry.objectName ?? selectedGeometry.description;
  return `${name} (${selectedGeometry.type})`;
}

function updateActiveCursorPlane(activeCursorPlaneRef: { current: CursorPlane }, selection: SelectedGeometry) {
  if (
    selection.type !== "plane" &&
    selection.type !== "face" &&
    selection.type !== "surface"
  ) {
    return;
  }
  if (!selection.normal) return;
  const normal = tupleToVector(selection.normal).normalize();
  if (normal.lengthSq() === 0) return;
  activeCursorPlaneRef.current = {
    label: selection.objectName ?? selection.description,
    normal,
    point: tupleToVector(selection.position),
  };
}

export default function App() {
  const [appMode, setAppMode] = useState<AppMode>("size");
  const [project, setProject] = useState<CadProject>(() => loadStoredProject() ?? fallbackProject());
  const [sizingProject, setSizingProject] = useState<SizingProject>(() =>
    normalizeSizingProject(loadStoredProject()?.sizing),
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

  useEffect(() => {
    if (isTauriRuntime() && !loadStoredProject()) {
      invoke<CadProject>("create_project")
        .then((created) => setProject(loadStoredProject() ?? created))
        .catch(() => setProject(fallbackProject()));
    }
  }, []);

  useEffect(() => {
    localStorage.setItem(projectStorageKey, JSON.stringify(project));
  }, [project]);

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
    setSelectedTimelineEventId(null);
    setSelectedBrowserItemId("project");
    setSelectedGeometry(null);
    setPrompt("");
    setStatus("Project cleared");
  }

  function updateSizingProject(next: SizingProject) {
    setSizingProject(next);
    setProject((current) => ({ ...current, sizing: next }));
    setStatus("Sizing updated");
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
          <Plane size={22} />
          <span>Cadex</span>
          <div className="mode-switch" aria-label="Application mode">
            <button className={appMode === "size" ? "active" : ""} onClick={() => setAppMode("size")}>
              Sizing
            </button>
            <button className={appMode === "design" ? "active" : ""} onClick={() => setAppMode("design")}>
              Design
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
        ) : (
          <div className="size-toolbar-label">
            <Ruler size={17} />
            Aircraft sizing canvas
          </div>
        )}
        <button className="command-button" onClick={() => setSettingsOpen(true)}>
          <Settings size={17} />
          Settings
        </button>
        <div className="status-pill">{status}</div>
      </header>

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
      ) : (
        <>
          <SizeWorkspace
            sizing={sizingProject}
            onChange={updateSizingProject}
            onOpenVspAnalysis={runOpenVspSizing}
          />
          <footer className="timeline size-footer">
            <div className="timeline-title">
              <Ruler size={17} />
              <span>Sizing result</span>
            </div>
            <div className="timeline-events">
              <SizingSummaryFooter analysis={sizingProject.analysis} />
            </div>
          </footer>
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
    </div>
  );
}

async function runAiDesignCommand(request: {
  apiKey: string;
  model: string;
  message: string;
  project: CadProject;
  selectedGeometry?: SelectedGeometry | null;
}) {
  if (isTauriRuntime()) {
    return invoke<{ assistantText: string; project: CadProject }>("send_openai_tool_message", { request });
  }
  return sendOpenAiDesignMessage(request);
}

async function exportCurrentProject(project: CadProject, format: "stl" | "step") {
  if (isTauriRuntime()) {
    const path = await saveFileDialog({
      defaultPath: `${project.name.replace(/[^a-z0-9]+/gi, "_") || "cadex_export"}.${format}`,
      filters: [{ name: format.toUpperCase(), extensions: [format] }],
    });
    if (!path) return undefined;
    return invoke<{ path: string; message: string }>("export_model", {
      request: { project, format, path },
    });
  }
  if (format === "step") {
    throw new Error("STEP export requires the desktop app because it uses the native OpenVSP export path.");
  }
  if (project.objects.length === 0) {
    throw new Error("Create geometry before exporting STL.");
  }
  const blob = new Blob([projectToStl(project)], { type: "model/stl" });
  const url = URL.createObjectURL(blob);
  const link = document.createElement("a");
  link.href = url;
  link.download = `${project.name.replace(/[^a-z0-9]+/gi, "_") || "cadex_export"}.stl`;
  link.click();
  URL.revokeObjectURL(url);
  return {
    path: link.download,
    message: "STL downloaded from the current browser preview model.",
  };
}

async function importIntoProject(project: CadProject, format: GeometryFormat) {
  if (!isTauriRuntime()) {
    throw new Error("Import requires the desktop app because it reads model files from disk.");
  }
  const path = await openFileDialog({
    multiple: false,
    filters: [{ name: format.toUpperCase(), extensions: [format] }],
  });
  if (!path || Array.isArray(path)) return undefined;
  const result = await invoke<CadProject>("import_model", {
    request: { project, format, path },
  });
  return {
    project: result,
    message: `${format.toUpperCase()} imported into the current model.`,
  };
}

function isTauriRuntime() {
  return Boolean((window as typeof window & { __TAURI_INTERNALS__?: unknown }).__TAURI_INTERNALS__);
}

function friendlyError(error: unknown) {
  const text = String(error);
  if (text.includes("status 520") || text.includes("responded but did not change")) {
    return "I could not turn that request into a CAD change. Try naming the part, size, and starting plane.";
  }
  if (text.includes("insufficient_quota")) {
    return "Your OpenAI quota is currently exhausted. Check billing or choose another API key in Settings.";
  }
  if (text === "null" || text.trim() === "") {
    return "The desktop AI bridge did not return a usable response.";
  }
  return text.length > 180 ? `${text.slice(0, 180)}...` : text;
}

function loadStoredProject(): CadProject | undefined {
  try {
    const raw = localStorage.getItem(projectStorageKey);
    if (!raw) return undefined;
    const parsed = JSON.parse(raw) as Partial<CadProject>;
    if (!parsed || !Array.isArray(parsed.objects) || !Array.isArray(parsed.timeline)) return undefined;
    return {
      id: typeof parsed.id === "string" ? parsed.id : crypto.randomUUID(),
      name: typeof parsed.name === "string" ? parsed.name : "Untitled part",
      units: typeof parsed.units === "string" ? parsed.units : "m",
      objects: parsed.objects as CadProject["objects"],
      timeline: parsed.timeline as CadProject["timeline"],
      sizing: parsed.sizing,
    };
  } catch {
    return undefined;
  }
}

function SettingsDialog({
  apiKey,
  model,
  onApiKeyChange,
  onClose,
  onModelChange,
}: {
  apiKey: string;
  model: string;
  onApiKeyChange: (value: string) => void;
  onClose: () => void;
  onModelChange: (value: string) => void;
}) {
  return (
    <div className="settings-backdrop" role="presentation">
      <section className="settings-dialog" role="dialog" aria-modal="true" aria-label="Settings">
        <div className="settings-header">
          <div>
            <h2>Settings</h2>
            <span>AI design commands</span>
          </div>
          <button className="tool-button" onClick={onClose} title="Close settings" aria-label="Close settings">
            X
          </button>
        </div>
        <label className="settings-field">
          <span>OpenAI API key</span>
          <input
            autoFocus
            value={apiKey}
            onChange={(event) => onApiKeyChange(event.target.value)}
            placeholder="sk-..."
            type="password"
          />
        </label>
        <label className="settings-field">
          <span>Model</span>
          <select value={model} onChange={(event) => onModelChange(event.target.value)}>
            <option value="gpt-5">gpt-5</option>
            <option value="gpt-5-mini">gpt-5-mini</option>
            <option value="gpt-4.1">gpt-4.1</option>
            <option value="gpt-4.1-mini">gpt-4.1-mini</option>
          </select>
        </label>
        <div className="settings-actions">
          <button onClick={() => onModelChange(defaultModel)}>Reset model</button>
          <button onClick={onClose}>Done</button>
        </div>
      </section>
    </div>
  );
}

function ToolButton({
  active,
  label,
  onClick,
  children,
}: {
  active: boolean;
  label: string;
  onClick: () => void;
  children: React.ReactNode;
}) {
  return (
    <button className={`tool-button ${active ? "active" : ""}`} onClick={onClick} title={label} aria-label={label}>
      {children}
    </button>
  );
}

function FormatMenu({
  ariaLabel,
  icon,
  label,
  onPick,
}: {
  ariaLabel: string;
  icon: React.ReactNode;
  label: string;
  onPick: (format: GeometryFormat) => void;
}) {
  const [open, setOpen] = useState(false);
  const containerRef = useRef<HTMLDivElement | null>(null);

  useEffect(() => {
    if (!open) return;
    const closeOnOutside = (event: PointerEvent) => {
      if (!containerRef.current?.contains(event.target as Node)) setOpen(false);
    };
    const closeOnEscape = (event: KeyboardEvent) => {
      if (event.key === "Escape") setOpen(false);
    };
    window.addEventListener("pointerdown", closeOnOutside);
    window.addEventListener("keydown", closeOnEscape);
    return () => {
      window.removeEventListener("pointerdown", closeOnOutside);
      window.removeEventListener("keydown", closeOnEscape);
    };
  }, [open]);

  function pick(format: GeometryFormat) {
    setOpen(false);
    onPick(format);
  }

  return (
    <div className="format-menu" ref={containerRef}>
      <button
        className={`command-button ${open ? "active" : ""}`}
        aria-label={ariaLabel}
        aria-haspopup="menu"
        aria-expanded={open}
        onClick={() => setOpen((value) => !value)}
      >
        {icon}
        {label}
      </button>
      {open ? (
        <div className="format-menu-options" role="menu">
          <button role="menuitem" onClick={() => pick("stl")}>
            STL
          </button>
          <button role="menuitem" onClick={() => pick("step")}>
            STEP
          </button>
        </div>
      ) : null}
    </div>
  );
}

export function PanelTitle({ icon, title }: { icon: React.ReactNode; title: string }) {
  return (
    <h2 className="panel-title">
      {icon}
      {title}
    </h2>
  );
}

function ProjectBrowser({
  dimensionPrecision,
  hiddenBrowserItemIds,
  objects,
  projectName,
  selectedBrowserItemId,
  selectedGeometry,
  unit,
  onDeleteGroup,
  onDeleteObject,
  onPrecisionChange,
  onSelectDependencyItem,
  onSelectItem,
  onToggleVisibility,
  onUnitChange,
}: {
  dimensionPrecision: number;
  hiddenBrowserItemIds: Set<string>;
  objects: CadObject[];
  projectName: string;
  selectedBrowserItemId: string;
  selectedGeometry: SelectedGeometry | null;
  unit: DisplayUnit;
  onDeleteGroup: (groupId: BrowserGroupId) => void;
  onDeleteObject: (objectId: string) => void;
  onPrecisionChange: (value: number) => void;
  onSelectDependencyItem: (id: string) => void;
  onSelectItem: (id: string) => void;
  onToggleVisibility: (id: string) => void;
  onUnitChange: (value: DisplayUnit) => void;
}) {
  const [contextTarget, setContextTarget] = useState<BrowserContextTarget | null>(null);
  const [contextPosition, setContextPosition] = useState({ x: 0, y: 0 });
  const [collapsedSections, setCollapsedSections] = useState<Record<string, boolean>>({});
  const [activeBrowserTab, setActiveBrowserTab] = useState<"browser" | "dependencies">("browser");
  const bodies = objects.filter((object) => object.kind === "wing" || object.kind === "mesh" || object.kind === "solid");
  const surfaces = objects.filter(
    (object): object is ReferenceGeometry =>
      object.kind === "reference" && (object.referenceKind === "surface" || object.referenceKind === "face"),
  );
  const sketches = objects.filter(
    (object): object is ReferenceGeometry =>
      object.kind === "reference" && (object.referenceKind === "line" || object.referenceKind === "point"),
  );
  const planes = objects.filter(
    (object): object is ReferenceGeometry => object.kind === "reference" && object.referenceKind === "plane",
  );

  useEffect(() => {
    if (!contextTarget) return;
    const close = () => setContextTarget(null);
    window.addEventListener("pointerdown", close);
    window.addEventListener("keydown", close);
    return () => {
      window.removeEventListener("pointerdown", close);
      window.removeEventListener("keydown", close);
    };
  }, [contextTarget]);

  function openContextMenu(event: React.MouseEvent, target: BrowserContextTarget) {
    event.preventDefault();
    event.stopPropagation();
    onSelectItem(target.id);
    setContextTarget(target);
    setContextPosition({ x: event.clientX, y: event.clientY });
  }

  function deleteContextTarget() {
    if (!contextTarget?.canDelete) return;
    if (contextTarget.objectId) onDeleteObject(contextTarget.objectId);
    if (contextTarget.groupId) onDeleteGroup(contextTarget.groupId);
    setContextTarget(null);
  }

  function toggleContextTargetVisibility() {
    if (!contextTarget?.canHide) return;
    onToggleVisibility(contextTarget.id);
    setContextTarget(null);
  }

  function selectAndToggleSection(id: string) {
    onSelectItem(id);
    setCollapsedSections((current) => ({ ...current, [id]: !current[id] }));
  }

  return (
    <>
      <PanelTitle icon={<FolderTree size={18} />} title="Browser" />
      <div className="browser-tabs" role="tablist" aria-label="Browser views">
        <button
          className={activeBrowserTab === "browser" ? "active" : ""}
          onClick={() => setActiveBrowserTab("browser")}
          role="tab"
          aria-selected={activeBrowserTab === "browser"}
        >
          Browser
        </button>
        <button
          className={activeBrowserTab === "dependencies" ? "active" : ""}
          onClick={() => setActiveBrowserTab("dependencies")}
          role="tab"
          aria-selected={activeBrowserTab === "dependencies"}
        >
          Tree
        </button>
      </div>
      {activeBrowserTab === "browser" ? (
        <>
          <div
            className={`project-row selectable ${selectedBrowserItemId === "project" ? "selected" : ""}`}
            onClick={() => onSelectItem("project")}
            onContextMenu={(event) =>
              openContextMenu(event, {
                id: "project",
                label: projectName,
                groupId: "project",
                canDelete: objects.length > 0,
                canHide: true,
              })
            }
            role="button"
            tabIndex={0}
          >
            <Box size={17} />
            <div>
              <strong>{projectName}</strong>
              <span>
                {objects.length} item{objects.length === 1 ? "" : "s"} in model tree
              </span>
            </div>
            <BrowserItemActions
              hidden={hiddenBrowserItemIds.has("project")}
              canDelete={objects.length > 0}
              onDelete={(event) => {
                event.stopPropagation();
                onDeleteGroup("project");
              }}
              onToggleVisibility={(event) => {
                event.stopPropagation();
                onToggleVisibility("project");
              }}
            />
          </div>
          <BrowserSection
        id="section:bodies"
        title="Bodies"
        count={bodies.length}
        expanded={!collapsedSections["section:bodies"]}
        hidden={hiddenBrowserItemIds.has("section:bodies")}
        selected={selectedBrowserItemId === "section:bodies"}
        onSelect={() => selectAndToggleSection("section:bodies")}
        onContextMenu={(event) =>
          openContextMenu(event, {
            id: "section:bodies",
            label: "Bodies",
            groupId: "section:bodies",
            canDelete: bodies.length > 0,
            canHide: true,
          })
        }
        onDelete={(event) => {
          event.stopPropagation();
          onDeleteGroup("section:bodies");
        }}
        onToggleVisibility={(event) => {
          event.stopPropagation();
          onToggleVisibility("section:bodies");
        }}
      >
        {bodies.map((object) => (
          <ObjectRow
            key={object.id}
            object={object}
            unit={unit}
            precision={dimensionPrecision}
            hidden={isObjectHidden(object, hiddenBrowserItemIds)}
            selected={selectedBrowserItemId === object.id}
            onSelect={() => onSelectItem(object.id)}
            onContextMenu={(event) =>
              openContextMenu(event, {
                id: object.id,
                label: object.name,
                objectId: object.id,
                canDelete: true,
                canHide: true,
              })
            }
            onDelete={(event) => {
              event.stopPropagation();
              onDeleteObject(object.id);
            }}
            onToggleVisibility={(event) => {
              event.stopPropagation();
              onToggleVisibility(object.id);
            }}
          />
        ))}
      </BrowserSection>
      <BrowserSection
        id="section:surfaces"
        title="Surfaces"
        count={surfaces.length}
        expanded={!collapsedSections["section:surfaces"]}
        hidden={hiddenBrowserItemIds.has("section:surfaces")}
        selected={selectedBrowserItemId === "section:surfaces"}
        onSelect={() => selectAndToggleSection("section:surfaces")}
        onContextMenu={(event) =>
          openContextMenu(event, {
            id: "section:surfaces",
            label: "Surfaces",
            groupId: "section:surfaces",
            canDelete: surfaces.length > 0,
            canHide: true,
          })
        }
        onDelete={(event) => {
          event.stopPropagation();
          onDeleteGroup("section:surfaces");
        }}
        onToggleVisibility={(event) => {
          event.stopPropagation();
          onToggleVisibility("section:surfaces");
        }}
      >
        {surfaces.map((object) => (
          <ObjectRow
            key={object.id}
            object={object}
            unit={unit}
            precision={dimensionPrecision}
            hidden={isObjectHidden(object, hiddenBrowserItemIds)}
            selected={selectedBrowserItemId === object.id}
            onSelect={() => onSelectItem(object.id)}
            onContextMenu={(event) =>
              openContextMenu(event, {
                id: object.id,
                label: object.name,
                objectId: object.id,
                canDelete: true,
                canHide: true,
              })
            }
            onDelete={(event) => {
              event.stopPropagation();
              onDeleteObject(object.id);
            }}
            onToggleVisibility={(event) => {
              event.stopPropagation();
              onToggleVisibility(object.id);
            }}
          />
        ))}
      </BrowserSection>
      <BrowserSection
        id="section:sketches"
        title="Sketches"
        count={sketches.length}
        expanded={!collapsedSections["section:sketches"]}
        hidden={hiddenBrowserItemIds.has("section:sketches")}
        selected={selectedBrowserItemId === "section:sketches"}
        onSelect={() => selectAndToggleSection("section:sketches")}
        onContextMenu={(event) =>
          openContextMenu(event, {
            id: "section:sketches",
            label: "Sketches",
            groupId: "section:sketches",
            canDelete: sketches.length > 0,
            canHide: true,
          })
        }
        onDelete={(event) => {
          event.stopPropagation();
          onDeleteGroup("section:sketches");
        }}
        onToggleVisibility={(event) => {
          event.stopPropagation();
          onToggleVisibility("section:sketches");
        }}
      >
        {sketches.map((object) => (
          <ObjectRow
            key={object.id}
            object={object}
            unit={unit}
            precision={dimensionPrecision}
            hidden={isObjectHidden(object, hiddenBrowserItemIds)}
            selected={selectedBrowserItemId === object.id}
            onSelect={() => onSelectItem(object.id)}
            onContextMenu={(event) =>
              openContextMenu(event, {
                id: object.id,
                label: object.name,
                objectId: object.id,
                canDelete: true,
                canHide: true,
              })
            }
            onDelete={(event) => {
              event.stopPropagation();
              onDeleteObject(object.id);
            }}
            onToggleVisibility={(event) => {
              event.stopPropagation();
              onToggleVisibility(object.id);
            }}
          />
        ))}
      </BrowserSection>
      <BrowserSection
        id="section:planes"
        title="Planes"
        count={planes.length}
        expanded={!collapsedSections["section:planes"]}
        hidden={hiddenBrowserItemIds.has("section:planes")}
        selected={selectedBrowserItemId === "section:planes"}
        onSelect={() => selectAndToggleSection("section:planes")}
        onContextMenu={(event) =>
          openContextMenu(event, {
            id: "section:planes",
            label: "Planes",
            groupId: "section:planes",
            canDelete: planes.length > 0,
            canHide: true,
          })
        }
        onDelete={(event) => {
          event.stopPropagation();
          onDeleteGroup("section:planes");
        }}
        onToggleVisibility={(event) => {
          event.stopPropagation();
          onToggleVisibility("section:planes");
        }}
      >
        {planes.map((object) => (
          <ObjectRow
            key={object.id}
            object={object}
            unit={unit}
            precision={dimensionPrecision}
            hidden={isObjectHidden(object, hiddenBrowserItemIds)}
            selected={selectedBrowserItemId === object.id}
            onSelect={() => onSelectItem(object.id)}
            onContextMenu={(event) =>
              openContextMenu(event, {
                id: object.id,
                label: object.name,
                objectId: object.id,
                canDelete: true,
                canHide: true,
              })
            }
            onDelete={(event) => {
              event.stopPropagation();
              onDeleteObject(object.id);
            }}
            onToggleVisibility={(event) => {
              event.stopPropagation();
              onToggleVisibility(object.id);
            }}
          />
        ))}
      </BrowserSection>
      <BrowserSection
        id="origin"
        title="Origin"
        count={1}
        expanded={!collapsedSections.origin}
        hidden={hiddenBrowserItemIds.has("origin")}
        selected={selectedBrowserItemId === "origin"}
        onSelect={() => selectAndToggleSection("origin")}
        onContextMenu={(event) =>
          openContextMenu(event, {
            id: "origin",
            label: "Origin",
            groupId: "origin",
            canDelete: false,
            canHide: true,
          })
        }
        onDelete={(event) => {
          event.stopPropagation();
        }}
        onToggleVisibility={(event) => {
          event.stopPropagation();
          onToggleVisibility("origin");
        }}
      >
        <div
          className={`origin-card selectable ${selectedBrowserItemId === "origin" ? "selected" : ""} ${hiddenBrowserItemIds.has("origin") ? "muted" : ""}`}
          onClick={() => onSelectItem("origin")}
          onContextMenu={(event) =>
            openContextMenu(event, {
              id: "origin",
              label: "Origin",
              groupId: "origin",
              canDelete: false,
              canHide: true,
            })
          }
          role="button"
          tabIndex={0}
        >
          <div className="origin-frame">
            <Crosshair size={17} />
            <div>
              <strong>World origin</strong>
              <span>X 0, Y 0, Z 0</span>
            </div>
            <BrowserItemActions
              hidden={hiddenBrowserItemIds.has("origin")}
              canDelete={false}
              onDelete={(event) => {
                event.stopPropagation();
              }}
              onToggleVisibility={(event) => {
                event.stopPropagation();
                onToggleVisibility("origin");
              }}
            />
          </div>
          <label>
            <span>Length unit</span>
            <select aria-label="Length unit" value={unit} onChange={(event) => onUnitChange(toDisplayUnit(event.target.value))}>
              {unitOptions.map((option) => (
                <option key={option} value={option}>
                  {option}
                </option>
              ))}
            </select>
          </label>
          <label>
            <span>Dimension decimals</span>
            <select
              aria-label="Dimension decimals"
              value={dimensionPrecision}
              onChange={(event) => onPrecisionChange(Number(event.target.value))}
            >
              <option value={0}>0</option>
              <option value={1}>1</option>
              <option value={2}>2</option>
              <option value={3}>3</option>
              <option value={4}>4</option>
            </select>
          </label>
        </div>
      </BrowserSection>
        </>
      ) : (
        <DependencyTreeView
          objects={objects}
          selectedBrowserItemId={selectedBrowserItemId}
          onSelectItem={onSelectDependencyItem}
        />
      )}
      {contextTarget ? (
        <div
          className="browser-context-menu"
          style={{ left: contextPosition.x, top: contextPosition.y }}
          onPointerDown={(event) => event.stopPropagation()}
          role="menu"
        >
          <button
            disabled={!contextTarget.canHide}
            onClick={toggleContextTargetVisibility}
            role="menuitem"
            title={hiddenBrowserItemIds.has(contextTarget.id) ? `Show ${contextTarget.label}` : `Hide ${contextTarget.label}`}
          >
            {hiddenBrowserItemIds.has(contextTarget.id) ? <Eye size={15} /> : <EyeOff size={15} />}
            {hiddenBrowserItemIds.has(contextTarget.id) ? "Show" : "Hide"}
          </button>
          <button
            disabled={!contextTarget.canDelete}
            onClick={deleteContextTarget}
            role="menuitem"
            title={contextTarget.canDelete ? `Delete ${contextTarget.label}` : "This browser item cannot be deleted"}
          >
            <Trash2 size={15} />
            Delete
          </button>
        </div>
      ) : null}
      <PanelTitle icon={<Crosshair size={18} />} title="Selected" />
      {selectedGeometry ? (
        <SelectionTable precision={dimensionPrecision} selectedGeometry={selectedGeometry} unit={unit} />
      ) : (
        <p className="empty-text">Move over the canvas to select geometry.</p>
      )}
    </>
  );
}

function BrowserSection({
  children,
  count,
  expanded,
  hidden,
  id,
  onDelete,
  onContextMenu,
  onSelect,
  onToggleVisibility,
  selected,
  title,
}: {
  children: React.ReactNode;
  count: number;
  expanded: boolean;
  hidden: boolean;
  id: string;
  onDelete: (event: React.MouseEvent) => void;
  onContextMenu: (event: React.MouseEvent) => void;
  onSelect: () => void;
  onToggleVisibility: (event: React.MouseEvent) => void;
  selected: boolean;
  title: string;
}) {
  return (
    <section className="browser-section">
      <div
        className={`browser-section-title selectable ${selected ? "selected" : ""} ${hidden ? "muted" : ""}`}
        onClick={onSelect}
        onContextMenu={onContextMenu}
        role="button"
        tabIndex={0}
        aria-controls={`${id}-contents`}
        aria-expanded={expanded}
        onKeyDown={(event) => {
          if (event.key === "Enter" || event.key === " ") {
            event.preventDefault();
            onSelect();
          }
        }}
      >
        <span className="browser-section-label">
          {expanded ? <ChevronDown size={14} /> : <ChevronRight size={14} />}
          {title}
        </span>
        <div className="browser-section-meta">
          <strong>{count}</strong>
          <BrowserItemActions
            hidden={hidden}
            canDelete={count > 0 && id !== "origin"}
            onDelete={onDelete}
            onToggleVisibility={onToggleVisibility}
          />
        </div>
      </div>
      {expanded ? (
        <div className="object-list" id={`${id}-contents`}>
          {count === 0 ? <p className="empty-text compact">Empty</p> : children}
        </div>
      ) : null}
    </section>
  );
}

function ObjectRow({
  hidden,
  object,
  onDelete,
  onContextMenu,
  onSelect,
  onToggleVisibility,
  precision,
  selected,
  unit,
}: {
  hidden: boolean;
  object: CadObject;
  onDelete: (event: React.MouseEvent) => void;
  onContextMenu: (event: React.MouseEvent) => void;
  onSelect: () => void;
  onToggleVisibility: (event: React.MouseEvent) => void;
  precision: number;
  selected: boolean;
  unit: DisplayUnit;
}) {
  if (object.kind === "wing") {
    return (
      <WingObject
        wing={object}
        precision={precision}
        unit={unit}
        selected={selected}
        hidden={hidden}
        onSelect={onSelect}
        onContextMenu={onContextMenu}
        onDelete={onDelete}
        onToggleVisibility={onToggleVisibility}
      />
    );
  }
  if (object.kind === "reference") {
    return (
      <ReferenceObject
        reference={object}
        selected={selected}
        hidden={hidden}
        onSelect={onSelect}
        onContextMenu={onContextMenu}
        onDelete={onDelete}
        onToggleVisibility={onToggleVisibility}
      />
    );
  }
  return (
    <div
      className={`object-row selectable ${selected ? "selected" : ""} ${hidden ? "muted" : ""}`}
      onClick={onSelect}
      onContextMenu={onContextMenu}
      role="button"
      tabIndex={0}
    >
      <Box size={17} />
      <div>
        <strong>{object.name}</strong>
        <span>{object.triangleCount} mesh triangles</span>
      </div>
      <BrowserItemActions
        hidden={hidden}
        canDelete
        onDelete={onDelete}
        onToggleVisibility={onToggleVisibility}
      />
    </div>
  );
}

function WingObject({
  hidden,
  onDelete,
  onContextMenu,
  onSelect,
  onToggleVisibility,
  precision,
  selected,
  unit,
  wing,
}: {
  hidden: boolean;
  onDelete: (event: React.MouseEvent) => void;
  onContextMenu: (event: React.MouseEvent) => void;
  onSelect: () => void;
  onToggleVisibility: (event: React.MouseEvent) => void;
  precision: number;
  selected: boolean;
  unit: DisplayUnit;
  wing: Wing;
}) {
  return (
    <div
      className={`object-row selectable ${selected ? "selected" : ""} ${hidden ? "muted" : ""}`}
      onClick={onSelect}
      onContextMenu={onContextMenu}
      role="button"
      tabIndex={0}
    >
      <Plane size={17} />
      <div>
        <strong>{wing.name}</strong>
        <span>
          {formatLength(wing.spanM, unit, precision)} span, {wing.airfoil}
        </span>
      </div>
      <BrowserItemActions
        hidden={hidden}
        canDelete
        onDelete={onDelete}
        onToggleVisibility={onToggleVisibility}
      />
    </div>
  );
}

function ReferenceObject({
  hidden,
  onDelete,
  onContextMenu,
  onSelect,
  onToggleVisibility,
  reference,
  selected,
}: {
  hidden: boolean;
  onDelete: (event: React.MouseEvent) => void;
  onContextMenu: (event: React.MouseEvent) => void;
  onSelect: () => void;
  onToggleVisibility: (event: React.MouseEvent) => void;
  reference: ReferenceGeometry;
  selected: boolean;
}) {
  return (
    <div
      className={`object-row selectable ${selected ? "selected" : ""} ${hidden ? "muted" : ""}`}
      onClick={onSelect}
      onContextMenu={onContextMenu}
      role="button"
      tabIndex={0}
    >
      <Crosshair size={17} />
      <div>
        <strong>{reference.name}</strong>
        <span>{reference.cadRole ? reference.cadRole.replace(/_/g, " ") : `${reference.referenceKind} reference`}</span>
      </div>
      <BrowserItemActions
        hidden={hidden}
        canDelete
        onDelete={onDelete}
        onToggleVisibility={onToggleVisibility}
      />
    </div>
  );
}

type DependencyTreeNode = {
  dependencyIds: string[];
  id: string;
  level: number;
  label: string;
  meta: string;
};

function DependencyTreeView({
  objects,
  onSelectItem,
  selectedBrowserItemId,
}: {
  objects: CadObject[];
  onSelectItem: (id: string) => void;
  selectedBrowserItemId: string;
}) {
  const [activeTooltipNodeId, setActiveTooltipNodeId] = useState<string | null>(null);
  const objectMap = useMemo(() => new Map(objects.map((object) => [object.id, object])), [objects]);
  const levels = useMemo(() => buildDependencyLevels(objects), [objects]);

  return (
    <div className="dependency-tree">
      <div className="dependency-levels">
        {levels.map((level, index) => (
          <div className="dependency-level" key={index}>
            {level.map((node) => (
              <DependencyTreeNodeView
                key={node.id}
                node={node}
                objectMap={objectMap}
                activeTooltipNodeId={activeTooltipNodeId}
                onSelectItem={onSelectItem}
                selectedBrowserItemId={selectedBrowserItemId}
                setActiveTooltipNodeId={setActiveTooltipNodeId}
              />
            ))}
          </div>
        ))}
      </div>
    </div>
  );
}

function DependencyTreeNodeView({
  activeTooltipNodeId,
  node,
  objectMap,
  onSelectItem,
  selectedBrowserItemId,
  setActiveTooltipNodeId,
}: {
  activeTooltipNodeId: string | null;
  node: DependencyTreeNode;
  objectMap: Map<string, CadObject>;
  onSelectItem: (id: string) => void;
  selectedBrowserItemId: string;
  setActiveTooltipNodeId: (id: string | null) => void;
}) {
  const title = dependencyTitle(node, objectMap);
  const tooltipVisible = activeTooltipNodeId === node.id;
  return (
    <div className="dependency-branch">
      <div className="dependency-node-stack">
        {node.dependencyIds.length > 0 ? (
          <div className="dependency-dependencies" aria-label={`${node.label} dependencies`}>
            {node.dependencyIds.map((dependencyId) => (
              <button
                key={dependencyId}
                className="dependency-mini-node"
                onClick={() => onSelectItem(dependencyId)}
                title={`Depends on ${dependencyLabel(dependencyId, objectMap)}`}
                aria-label={`Depends on ${dependencyLabel(dependencyId, objectMap)}`}
                type="button"
              >
                <DependencyIcon id={dependencyId} object={objectMap.get(dependencyId)} />
              </button>
            ))}
          </div>
        ) : null}
        <button
          className={`dependency-node-button ${selectedBrowserItemId === node.id ? "selected" : ""}`}
          onClick={() => {
            setActiveTooltipNodeId(node.id);
            onSelectItem(node.id);
          }}
          onFocus={() => setActiveTooltipNodeId(node.id)}
          onBlur={() => setActiveTooltipNodeId(null)}
          onMouseEnter={() => setActiveTooltipNodeId(node.id)}
          onMouseLeave={() => setActiveTooltipNodeId(null)}
          onPointerEnter={() => setActiveTooltipNodeId(node.id)}
          onPointerLeave={() => setActiveTooltipNodeId(null)}
          aria-label={title}
          title={title}
          type="button"
        >
          <DependencyIcon id={node.id} object={objectMap.get(node.id)} />
          <span className={`dependency-tooltip ${tooltipVisible ? "visible" : ""}`} role="tooltip">{title}</span>
        </button>
      </div>
    </div>
  );
}

function DependencyIcon({ id, object }: { id: string; object?: CadObject }) {
  if (id === "root" || id === "origin") return <Crosshair size={14} />;
  if (!object) return <ChevronRight size={14} />;
  if (object.kind === "wing" || object.kind === "solid" || object.kind === "mesh") return <Box size={14} />;
  if (object.referenceKind === "plane") return <Plane size={14} />;
  if (object.referenceKind === "surface" || object.referenceKind === "face") return <Orbit size={14} />;
  return <Crosshair size={14} />;
}

function buildDependencyLevels(objects: CadObject[]): DependencyTreeNode[][] {
  const objectMap = new Map(objects.map((object) => [object.id, object]));
  const dependencyIds = new Map<string, string[]>();
  for (const object of objects) dependencyIds.set(object.id, directDependencyIds(object, objects));

  const virtualIds = [...new Set([...dependencyIds.values()].flat().filter((id) => isVirtualDependencyNode(id, objectMap)))];
  for (const id of virtualIds) dependencyIds.set(id, id === "origin" ? [] : ["origin"]);

  const levelCache = new Map<string, number>([["origin", 0]]);
  const levelFor = (id: string, seen = new Set<string>()): number => {
    if (id === "origin") return 0;
    if (levelCache.has(id)) return levelCache.get(id) ?? 0;
    if (seen.has(id)) return 1;
    seen.add(id);
    const deps = dependencyIds.get(id) ?? ["origin"];
    const knownDeps = deps.filter((dep) => dep === "origin" || objectMap.has(dep) || isVirtualDependencyNode(dep, objectMap));
    const level = knownDeps.length > 0 ? Math.max(...knownDeps.map((dep) => levelFor(dep, seen))) + 1 : 1;
    levelCache.set(id, level);
    return level;
  };

  const nodes: DependencyTreeNode[] = [{
    id: "origin",
    level: 0,
    label: "Origin",
    meta: "world reference",
    dependencyIds: [],
  }];
  for (const id of virtualIds.filter((id) => id !== "origin")) {
    nodes.push({
      id,
      level: levelFor(id),
      label: virtualDependencyLabel(id),
      meta: "origin reference plane",
      dependencyIds: dependencyIds.get(id) ?? ["origin"],
    });
  }
  for (const object of objects) {
    const deps = dependencyIds.get(object.id) ?? [];
    nodes.push({
      id: object.id,
      level: levelFor(object.id),
      label: object.name,
      meta: dependencyMeta(object),
      dependencyIds: deps,
    });
  }
  const levels: DependencyTreeNode[][] = [];
  for (const node of nodes.sort(compareDependencyNodes)) {
    levels[node.level] = [...(levels[node.level] ?? []), node];
  }
  return levels.filter(Boolean);
}

function directDependencyIds(object: CadObject, objects: CadObject[]) {
  if (object.dependsOn?.length) return normalizeDependencyIds(object.dependsOn);
  if (object.kind !== "reference") {
    const ownedConstruction = objects.filter((candidate) => candidate.kind === "reference" && candidate.parentId === object.id);
    const ownedIds = new Set(ownedConstruction.map((candidate) => candidate.id));
    const dependencyInputs = new Set(ownedConstruction.flatMap((candidate) => candidate.dependsOn ?? []).filter((id) => ownedIds.has(id)));
    const terminalConstruction = ownedConstruction.filter((candidate) => !dependencyInputs.has(candidate.id));
    if (terminalConstruction.length > 0) return normalizeDependencyIds(terminalConstruction.map((candidate) => candidate.id));
  }
  return ["origin"];
}

function normalizeDependencyIds(ids: string[]) {
  return [...new Set(ids)];
}

function compareDependencyNodes(a: DependencyTreeNode, b: DependencyTreeNode) {
  return a.level - b.level || a.label.localeCompare(b.label);
}

function isVirtualDependencyNode(id: string, objectMap: Map<string, CadObject>) {
  return id === "origin" || (id.startsWith("origin-plane-") && !objectMap.has(id));
}

function virtualDependencyLabel(id: string) {
  if (id === "origin") return "Origin";
  return `${id.replace("origin-plane-", "").toUpperCase()} origin plane`;
}

function dependencyMeta(object: CadObject) {
  if (object.kind === "wing") return `body · profile ${object.airfoil}`;
  if (object.kind === "solid") return `solid · ${object.source}`;
  if (object.kind === "mesh") return `mesh · ${object.triangleCount} triangles`;
  return object.operation ?? object.cadRole?.replace(/_/g, " ") ?? `${object.referenceKind} reference`;
}

function dependencyLabel(id: string, objectMap: Map<string, CadObject>) {
  if (id === "origin") return "Origin";
  return objectMap.get(id)?.name ?? id;
}

function dependencyTitle(node: DependencyTreeNode, objectMap: Map<string, CadObject>) {
  const dependencies = node.dependencyIds.map((id) => dependencyLabel(id, objectMap));
  const parts = [node.label, node.meta];
  if (dependencies.length > 0) parts.push(`Depends on: ${dependencies.join(", ")}`);
  return parts.filter(Boolean).join("\n");
}

function BrowserItemActions({
  canDelete,
  hidden,
  onDelete,
  onToggleVisibility,
}: {
  canDelete: boolean;
  hidden: boolean;
  onDelete: (event: React.MouseEvent) => void;
  onToggleVisibility: (event: React.MouseEvent) => void;
}) {
  return (
    <div className="browser-item-actions" onClick={(event) => event.stopPropagation()}>
      <button
        type="button"
        className="browser-icon-button"
        onClick={onToggleVisibility}
        aria-label={hidden ? "Show" : "Hide"}
        title={hidden ? "Show" : "Hide"}
      >
        {hidden ? <EyeOff size={15} /> : <Eye size={15} />}
      </button>
      <button
        type="button"
        className="browser-icon-button danger"
        disabled={!canDelete}
        onClick={onDelete}
        aria-label="Delete"
        title={canDelete ? "Delete" : "Cannot delete"}
      >
        <Trash2 size={15} />
      </button>
    </div>
  );
}

function SelectionTable({
  precision,
  selectedGeometry,
  unit,
}: {
  precision: number;
  selectedGeometry: SelectedGeometry;
  unit: DisplayUnit;
}) {
  const rows = [
    ["Type", selectedGeometry.type],
    ["Object", selectedGeometry.objectName ?? "Base construction plane"],
    ["Position", formatVector(selectedGeometry.position, unit, precision)],
  ];
  if (selectedGeometry.normal) rows.push(["Normal", selectedGeometry.normal.map((value) => value.toFixed(3)).join(", ")]);

  return (
    <div className="parameter-table">
      {rows.map(([label, value]) => (
        <div key={label}>
          <span>{label}</span>
          <strong>{value}</strong>
        </div>
      ))}
    </div>
  );
}

function formatVector(vector: [number, number, number], unit: DisplayUnit, precision: number) {
  return vector.map((value) => formatLength(value, unit, precision)).join(", ");
}

function formatLength(valueM: number, unit: DisplayUnit, precision: number) {
  return `${convertLength(valueM, unit).toFixed(precision)} ${unit}`;
}

function convertLength(valueM: number, unit: DisplayUnit) {
  if (unit === "cm") return valueM * 100;
  if (unit === "mm") return valueM * 1000;
  if (unit === "in") return valueM * 39.3700787;
  if (unit === "ft") return valueM * 3.2808399;
  return valueM;
}

function toDisplayUnit(value: string): DisplayUnit {
  return unitOptions.find((unit) => unit === value) ?? "m";
}

function browserGroupIdForObject(object: CadObject): BrowserGroupId {
  if (object.kind === "reference") {
    if (object.referenceKind === "surface" || object.referenceKind === "face") return "section:surfaces";
    if (object.referenceKind === "line" || object.referenceKind === "point") return "section:sketches";
    return "section:planes";
  }
  return "section:bodies";
}

function isObjectHidden(object: CadObject, hiddenBrowserItemIds: Set<string>) {
  return (
    hiddenBrowserItemIds.has("project") ||
    hiddenBrowserItemIds.has(object.id) ||
    hiddenBrowserItemIds.has(browserGroupIdForObject(object))
  );
}

function selectionFromBrowserItem(id: string, objects: CadObject[]): SelectedGeometry | null {
  if (id === "origin") {
    return {
      type: "point",
      objectId: "origin",
      objectName: "World origin",
      position: [0, 0, 0],
      description: "World origin",
    };
  }
  if (id === "origin-plane-xy" || id === "origin-plane-xz" || id === "origin-plane-yz") {
    return originPlaneSelection(id);
  }

  const object = objects.find((entry) => entry.id === id);
  if (!object) return null;
  if (object.kind === "reference") {
    return {
      type: object.referenceKind,
      objectId: object.id,
      objectName: object.name,
      position: object.origin,
      normal: object.normal,
      description: `${object.referenceKind} reference ${object.name}`,
    };
  }
  return {
    type: "body",
    objectId: object.id,
    objectName: object.name,
    position: [0, 0, 0],
    description: `Body ${object.name}`,
  };
}

function originPlaneSelection(id: string): SelectedGeometry {
  const plane = id.replace("origin-plane-", "").toUpperCase();
  const normal: [number, number, number] =
    plane === "XY" ? [0, 0, 1] : plane === "XZ" ? [0, 1, 0] : [1, 0, 0];
  return {
    type: "plane",
    objectId: id,
    objectName: `${plane} origin plane`,
    position: [0, 0, 0],
    normal,
    polygon: planeSelectionPolygon(tupleToVector([0, 0, 0]), tupleToVector(normal), 0.42),
    description: `${plane} origin plane`,
  };
}

function createOriginReferenceGroup() {
  const group = new THREE.Group();
  group.name = "Origin references";
  group.add(createOriginPlane("XY", "#38bdf8", new THREE.Euler(0, 0, 0), new THREE.Vector3(0.23, 0.23, 0.002)));
  group.add(createOriginPlane("XZ", "#22c55e", new THREE.Euler(Math.PI / 2, 0, 0), new THREE.Vector3(0.23, 0.002, 0.23)));
  group.add(createOriginPlane("YZ", "#f97316", new THREE.Euler(0, Math.PI / 2, 0), new THREE.Vector3(0.002, 0.23, 0.23)));
  group.add(createAxisArrow("X", new THREE.Vector3(1, 0, 0), "#ef4444"));
  group.add(createAxisArrow("Y", new THREE.Vector3(0, 1, 0), "#22c55e"));
  group.add(createAxisArrow("Z", new THREE.Vector3(0, 0, 1), "#3b82f6"));
  return group;
}

function createOriginPlane(label: string, color: string, rotation: THREE.Euler, labelPosition: THREE.Vector3) {
  const group = new THREE.Group();
  group.name = `${label} origin plane`;
  const geometry = new THREE.PlaneGeometry(0.42, 0.42);
  const material = new THREE.MeshBasicMaterial({
    color,
    depthWrite: false,
    opacity: 0.12,
    side: THREE.DoubleSide,
    transparent: true,
  });
  const plane = new THREE.Mesh(geometry, material);
  plane.name = `${label} origin plane`;
  plane.rotation.copy(rotation);
  plane.renderOrder = -1;
  plane.userData.cadObject = {
    id: `origin-plane-${label.toLowerCase()}`,
    name: `${label} origin plane`,
    kind: "reference",
    referenceKind: "plane",
  };
  group.add(plane);

  const half = 0.42 / 2;
  const outline = new THREE.LineLoop(
    new THREE.BufferGeometry().setFromPoints([
      new THREE.Vector3(-half, -half, 0),
      new THREE.Vector3(half, -half, 0),
      new THREE.Vector3(half, half, 0),
      new THREE.Vector3(-half, half, 0),
    ]),
    new THREE.LineBasicMaterial({ color, transparent: true, opacity: 0.52 }),
  );
  outline.rotation.copy(rotation);
  outline.raycast = () => undefined;
  group.add(outline);

  const sprite = createTextSprite(label, color);
  sprite.position.copy(labelPosition);
  sprite.scale.set(0.085, 0.04, 1);
  sprite.raycast = () => undefined;
  group.add(sprite);
  return group;
}

function createAxisArrow(label: string, direction: THREE.Vector3, color: string) {
  const group = new THREE.Group();
  const normalized = direction.clone().normalize();
  const arrow = new THREE.ArrowHelper(normalized, new THREE.Vector3(0, 0, 0), 0.34, color, 0.05, 0.022);
  group.add(arrow);

  const sprite = createTextSprite(label, color);
  sprite.position.copy(normalized.multiplyScalar(0.39));
  sprite.scale.set(0.07, 0.04, 1);
  group.add(sprite);
  return group;
}

function createTextSprite(text: string, color: string) {
  const canvas = document.createElement("canvas");
  canvas.width = 128;
  canvas.height = 64;
  const context = canvas.getContext("2d");
  if (context) {
    context.clearRect(0, 0, canvas.width, canvas.height);
    context.fillStyle = "rgba(15, 23, 32, 0.78)";
    roundRect(context, 10, 10, 108, 44, 8);
    context.fill();
    context.strokeStyle = color;
    context.lineWidth = 3;
    roundRect(context, 10, 10, 108, 44, 8);
    context.stroke();
    context.fillStyle = "#f8fafc";
    context.font = "700 28px Inter, Arial, sans-serif";
    context.textAlign = "center";
    context.textBaseline = "middle";
    context.fillText(text, 64, 32);
  }
  const texture = new THREE.CanvasTexture(canvas);
  texture.needsUpdate = true;
  const material = new THREE.SpriteMaterial({ map: texture, transparent: true, depthTest: false });
  const sprite = new THREE.Sprite(material);
  sprite.renderOrder = 8;
  return sprite;
}

function roundRect(context: CanvasRenderingContext2D, x: number, y: number, width: number, height: number, radius: number) {
  context.beginPath();
  context.moveTo(x + radius, y);
  context.lineTo(x + width - radius, y);
  context.quadraticCurveTo(x + width, y, x + width, y + radius);
  context.lineTo(x + width, y + height - radius);
  context.quadraticCurveTo(x + width, y + height, x + width - radius, y + height);
  context.lineTo(x + radius, y + height);
  context.quadraticCurveTo(x, y + height, x, y + height - radius);
  context.lineTo(x, y + radius);
  context.quadraticCurveTo(x, y, x + radius, y);
  context.closePath();
}

function TimelineItem({
  active,
  event,
  index,
  onSelect,
}: {
  active: boolean;
  event: TimelineEvent;
  index: number;
  onSelect: () => void;
}) {
  return (
    <button
      className={`timeline-item ${active ? "active" : ""}`}
      onClick={onSelect}
      title={`${event.label}\n${event.detail}`}
      aria-label={`${event.label}: ${event.detail}`}
      aria-pressed={active}
    >
      <span>{index + 1}</span>
    </button>
  );
}

function CadCanvas({
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

function selectionFromIntersection(
  hit: THREE.Intersection,
  camera: THREE.PerspectiveCamera,
  canvas: HTMLCanvasElement,
  clientX: number,
  clientY: number,
): SelectedGeometry {
  const meta = findCadObjectMeta(hit.object);
  const worldPoint = hit.point.clone();
  const normal = hit.face
    ? hit.face.normal.clone().transformDirection(hit.object.matrixWorld).normalize()
    : new THREE.Vector3(0, 1, 0);

  if (meta?.kind === "reference" && meta.referenceKind) {
    return {
      type: meta.referenceKind,
      objectId: meta.id,
      objectName: meta.name,
      position: vectorToTuple(worldPoint),
      normal: vectorToTuple(normal),
      polygon: meta.referenceKind === "plane" || meta.referenceKind === "face" || meta.referenceKind === "surface" ? planeSelectionPolygon(worldPoint, normal, 0.18) : undefined,
      description: `${meta.referenceKind} reference ${meta.name}`,
    };
  }

  const triangle = hit.face ? triangleFromHit(hit) : undefined;
  if (meta?.kind === "wing" || meta?.kind === "mesh" || meta?.kind === "solid") {
    return {
      type: hit.face ? "face" : "body",
      objectId: meta.id,
      objectName: meta.name,
      position: vectorToTuple(worldPoint),
      normal: vectorToTuple(normal),
      polygon: triangle?.vertices.map(vectorToTuple),
      description: `${hit.face ? "Face" : "Body"} on ${meta.name ?? "geometry"}`,
    };
  }

  if (triangle) {
    const pointer = new THREE.Vector2(clientX, clientY);
    const projected = triangle.vertices.map((vertex) => projectToScreen(vertex, camera, canvas));
    const vertexIndex = projected.findIndex((vertex) => vertex.distanceTo(pointer) < 10);
    if (vertexIndex >= 0) {
      const vertex = triangle.vertices[vertexIndex];
      return {
        type: "point",
        objectId: meta?.id,
        objectName: meta?.name,
        position: vectorToTuple(vertex),
        normal: vectorToTuple(normal),
        description: `Point on ${meta?.name ?? "geometry"}`,
      };
    }

    for (let index = 0; index < projected.length; index += 1) {
      const nextIndex = (index + 1) % projected.length;
      if (distanceToSegment(pointer, projected[index], projected[nextIndex]) < 7) {
        return {
          type: "line",
          objectId: meta?.id,
          objectName: meta?.name,
          position: vectorToTuple(worldPoint),
          start: vectorToTuple(triangle.vertices[index]),
          end: vectorToTuple(triangle.vertices[nextIndex]),
          normal: vectorToTuple(normal),
          description: `Edge on ${meta?.name ?? "geometry"}`,
        };
      }
    }
  }

  return {
    type: hit.face ? "face" : "body",
    objectId: meta?.id,
    objectName: meta?.name,
    position: vectorToTuple(worldPoint),
    normal: vectorToTuple(normal),
    polygon: triangle?.vertices.map(vectorToTuple),
    description: `${hit.face ? "Face" : "Body"} on ${meta?.name ?? "geometry"}`,
  };
}

function pickBestIntersection(hits: THREE.Intersection[]) {
  return [...hits].sort((a, b) => pickPriority(a) - pickPriority(b) || a.distance - b.distance)[0];
}

function pickPriority(hit: THREE.Intersection) {
  const meta = findCadObjectMeta(hit.object);
  if (meta?.referenceKind === "point") return 0;
  if (meta?.referenceKind === "line" || hit.object instanceof THREE.Line) return 1;
  if (meta?.kind === "wing" || meta?.kind === "mesh" || meta?.kind === "solid") return 2;
  if (meta?.referenceKind === "surface" || meta?.referenceKind === "face") return 3;
  if (meta?.referenceKind === "plane") return 4;
  return 5;
}

function findCadObjectMeta(object: THREE.Object3D): {
  id?: string;
  name?: string;
  kind?: string;
  referenceKind?: "plane" | "point" | "line" | "face" | "surface";
} | undefined {
  let current: THREE.Object3D | null = object;
  while (current) {
    if (current.userData.cadObject) return current.userData.cadObject;
    current = current.parent;
  }
  return undefined;
}

function triangleFromHit(hit: THREE.Intersection) {
  if (!hit.face || !(hit.object instanceof THREE.Mesh)) return undefined;
  const position = hit.object.geometry.getAttribute("position");
  const vertices = [hit.face.a, hit.face.b, hit.face.c].map((index) =>
    new THREE.Vector3(position.getX(index), position.getY(index), position.getZ(index)).applyMatrix4(hit.object.matrixWorld),
  );
  return { vertices };
}

function projectToScreen(point: THREE.Vector3, camera: THREE.PerspectiveCamera, canvas: HTMLCanvasElement) {
  const projected = point.clone().project(camera);
  const bounds = canvas.getBoundingClientRect();
  return new THREE.Vector2(
    bounds.left + ((projected.x + 1) / 2) * bounds.width,
    bounds.top + ((-projected.y + 1) / 2) * bounds.height,
  );
}

function distanceToSegment(point: THREE.Vector2, start: THREE.Vector2, end: THREE.Vector2) {
  const segment = end.clone().sub(start);
  const lengthSq = segment.lengthSq();
  if (lengthSq === 0) return point.distanceTo(start);
  const t = Math.max(0, Math.min(1, point.clone().sub(start).dot(segment) / lengthSq));
  return point.distanceTo(start.clone().add(segment.multiplyScalar(t)));
}

function updateSelectionMarker(marker: THREE.Group, selection: SelectedGeometry | null) {
  marker.clear();
  if (!selection) return;

  const selectionBlue = "#38bdf8";
  const position = tupleToVector(selection.position);
  const sphere = new THREE.Mesh(
    new THREE.SphereGeometry(selection.type === "point" ? 0.007 : 0.006, 12, 12),
    new THREE.MeshBasicMaterial({ color: selectionBlue, depthTest: false }),
  );
  sphere.position.copy(position);
  sphere.renderOrder = 10;
  marker.add(sphere);

  if (selection.polygon && selection.polygon.length >= 3) {
    const vertices = selection.polygon.map(tupleToVector);
    const geometry = new THREE.BufferGeometry().setFromPoints(vertices);
    geometry.setIndex(vertices.length === 3 ? [0, 1, 2] : [0, 1, 2, 0, 2, 3]);
    geometry.computeVertexNormals();
    const face = new THREE.Mesh(
      geometry,
      new THREE.MeshBasicMaterial({
        color: selectionBlue,
        transparent: true,
        opacity: 0.32,
        side: THREE.DoubleSide,
        depthTest: false,
      }),
    );
    face.renderOrder = 8;
    marker.add(face);

    const outline = new THREE.LineLoop(
      new THREE.BufferGeometry().setFromPoints(vertices),
      new THREE.LineBasicMaterial({ color: selectionBlue, depthTest: false }),
    );
    outline.renderOrder = 11;
    marker.add(outline);
  } else if ((selection.type === "plane" || selection.type === "surface") && selection.normal) {
    const vertices = planeSelectionPolygon(position, tupleToVector(selection.normal), 0.16).map(tupleToVector);
    const outline = new THREE.LineLoop(
      new THREE.BufferGeometry().setFromPoints(vertices),
      new THREE.LineBasicMaterial({ color: selectionBlue, depthTest: false }),
    );
    outline.renderOrder = 11;
    marker.add(outline);
  }

  if (selection.type === "line" && selection.start && selection.end) {
    const geometry = new THREE.BufferGeometry().setFromPoints([tupleToVector(selection.start), tupleToVector(selection.end)]);
    const line = new THREE.Line(geometry, new THREE.LineBasicMaterial({ color: selectionBlue, depthTest: false }));
    line.renderOrder = 10;
    marker.add(line);

    for (const endpoint of [selection.start, selection.end]) {
      const endpointMarker = new THREE.Mesh(
        new THREE.SphereGeometry(0.0045, 10, 10),
        new THREE.MeshBasicMaterial({ color: selectionBlue, depthTest: false }),
      );
      endpointMarker.position.copy(tupleToVector(endpoint));
      endpointMarker.renderOrder = 10;
      marker.add(endpointMarker);
    }
  }
}

function updateBrowserSelectionMarker(marker: THREE.Group, selectedId: string, objects: THREE.Object3D[]) {
  marker.clear();
  if (!selectedId) return;

  const targets = selectableTargetsForBrowserItem(selectedId, objects);
  for (const target of targets) {
    addObjectHighlight(marker, target);
  }
}

function selectableTargetsForBrowserItem(selectedId: string, objects: THREE.Object3D[]) {
  const targets: THREE.Object3D[] = [];
  for (const object of objects) {
    if (!object.visible) continue;
    object.traverse((child) => {
      if (!child.visible) return;
      const meta = findCadObjectMeta(child);
      if (!meta) return;
      if (selectedId === "project" || selectedId === "origin") {
        if (meta.id?.startsWith("origin-plane-") || selectedId === "project") targets.push(child);
        return;
      }
      if (selectedId.startsWith("section:")) {
        if (meta.id && browserGroupIdForSceneMeta(meta) === selectedId) targets.push(child);
        return;
      }
      if (meta.id === selectedId) targets.push(child);
    });
  }
  return targets.filter((target, index, all) => all.indexOf(target) === index);
}

function browserGroupIdForSceneMeta(meta: { id?: string; kind?: string; referenceKind?: string }): BrowserGroupId | undefined {
  if (meta.id?.startsWith("origin-plane-")) return "origin";
  if (meta.kind === "wing" || meta.kind === "mesh" || meta.kind === "solid") return "section:bodies";
  if (meta.referenceKind === "surface" || meta.referenceKind === "face") return "section:surfaces";
  if (meta.referenceKind === "line" || meta.referenceKind === "point") return "section:sketches";
  if (meta.referenceKind === "plane") return "section:planes";
  return undefined;
}

function addObjectHighlight(marker: THREE.Group, object: THREE.Object3D) {
  if (object instanceof THREE.Mesh && object.geometry instanceof THREE.BufferGeometry && object.geometry.getAttribute("position")) {
    const outline = outlineFromMeshGeometry(object);
    if (outline) {
      marker.add(outline);
      return;
    }
  }

  const box = new THREE.Box3().setFromObject(object);
  if (box.isEmpty()) return;
  const helper = new THREE.Box3Helper(box, "#38bdf8");
  if (Array.isArray(helper.material)) {
    helper.material.forEach((material) => {
      if ("depthTest" in material) material.depthTest = false;
    });
  } else {
    helper.material.depthTest = false;
  }
  helper.renderOrder = 12;
  marker.add(helper);
}

function outlineFromMeshGeometry(mesh: THREE.Mesh) {
  const position = mesh.geometry.getAttribute("position");
  if (!position || position.count < 3 || position.count > 8) return undefined;
  const points: THREE.Vector3[] = [];
  for (let index = 0; index < position.count; index += 1) {
    points.push(new THREE.Vector3(position.getX(index), position.getY(index), position.getZ(index)).applyMatrix4(mesh.matrixWorld));
  }
  const orderedPoints = points.length === 4 ? orderCoplanarQuadPoints(points) : points;
  const line = new THREE.LineLoop(
    new THREE.BufferGeometry().setFromPoints(orderedPoints),
    new THREE.LineBasicMaterial({ color: "#38bdf8", depthTest: false }),
  );
  line.renderOrder = 12;
  return line;
}

function orderCoplanarQuadPoints(points: THREE.Vector3[]) {
  const center = points.reduce((sum, point) => sum.add(point), new THREE.Vector3()).multiplyScalar(1 / points.length);
  const normal = new THREE.Vector3()
    .crossVectors(points[1].clone().sub(points[0]), points[2].clone().sub(points[0]))
    .normalize();
  const tangent = points[0].clone().sub(center).normalize();
  const bitangent = normal.clone().cross(tangent).normalize();
  return [...points].sort((a, b) => {
    const aOffset = a.clone().sub(center);
    const bOffset = b.clone().sub(center);
    const aAngle = Math.atan2(aOffset.dot(bitangent), aOffset.dot(tangent));
    const bAngle = Math.atan2(bOffset.dot(bitangent), bOffset.dot(tangent));
    return aAngle - bAngle;
  });
}

function planeSelectionPolygon(center: THREE.Vector3, normal: THREE.Vector3, size: number): [number, number, number][] {
  const n = normal.clone().normalize();
  const tangent = new THREE.Vector3(1, 0, 0);
  if (Math.abs(tangent.dot(n)) > 0.92) tangent.set(0, 1, 0);
  tangent.cross(n).normalize();
  const bitangent = n.clone().cross(tangent).normalize();
  const half = size / 2;
  return [
    center.clone().add(tangent.clone().multiplyScalar(-half)).add(bitangent.clone().multiplyScalar(-half)),
    center.clone().add(tangent.clone().multiplyScalar(half)).add(bitangent.clone().multiplyScalar(-half)),
    center.clone().add(tangent.clone().multiplyScalar(half)).add(bitangent.clone().multiplyScalar(half)),
    center.clone().add(tangent.clone().multiplyScalar(-half)).add(bitangent.clone().multiplyScalar(half)),
  ].map(vectorToTuple);
}

function fitCameraToObject(camera: THREE.PerspectiveCamera, controls: OrbitControls, object: THREE.Object3D) {
  if (object.children.length === 0) {
    camera.position.set(0.9, 0.55, 1.2);
    controls.target.set(0.08, 0, 0);
    return;
  }

  const box = new THREE.Box3().setFromObject(object);
  const center = box.getCenter(new THREE.Vector3());
  const size = box.getSize(new THREE.Vector3());
  const maxSize = Math.max(size.x, size.y, size.z, 0.25);
  const distance = maxSize / (2 * Math.tan((Math.PI * camera.fov) / 360));
  camera.position.copy(center).add(new THREE.Vector3(distance * 0.9, distance * 0.55, distance * 1.1));
  camera.near = distance / 100;
  camera.far = distance * 100;
  camera.updateProjectionMatrix();
  controls.target.copy(center);
  controls.update();
}

function vectorToTuple(vector: THREE.Vector3): [number, number, number] {
  return [roundCoord(vector.x), roundCoord(vector.y), roundCoord(vector.z)];
}

function tupleToVector(tuple: [number, number, number]) {
  return new THREE.Vector3(tuple[0], tuple[1], tuple[2]);
}

function roundCoord(value: number) {
  return Math.abs(value) < 1e-9 ? 0 : Number(value.toFixed(6));
}
