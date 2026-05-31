import { invoke } from "@tauri-apps/api/core";
import { Camera, FlaskConical, Image as ImageIcon, Play, Timer } from "lucide-react";
import { useState } from "react";
import type { SizingProject } from "../../sizing";
import { isTauriRuntime } from "../../lib/tauriRuntime";

type ParaViewReport = {
  ok: boolean;
  backendReady?: boolean;
  solver: "ParaView";
  message: string;
  executable?: string;
  geometryReady?: boolean;
  caseDir?: string;
  latestTime?: string;
  availableTimes?: string[];
  renderTime?: string;
  renderOptions?: ParaViewRenderOptions;
  componentCount?: number;
  geometryDir?: string;
  manifestPath?: string;
  scriptPath?: string;
  openFoamReportPath?: string;
  views?: ParaViewResultView[];
  reportPath?: string;
  verification?: {
    ok: boolean;
    componentCount: number;
    missing?: string[];
    warnings?: string[];
  };
  stdout?: string;
  stderr?: string;
};

type ParaViewRenderOptions = {
  cameraPreset: CameraPreset;
  modes: string[];
  time: string;
};

type CameraPreset = "aftHighRight" | "top" | "side";

type ParaViewResultView = {
  component?: string;
  dataUrl?: string;
  field: string;
  id: string;
  imagePath: string;
  title: string;
};

const cameraPresets: Array<{ id: CameraPreset; label: string }> = [
  { id: "aftHighRight", label: "3/4 high" },
  { id: "top", label: "Top" },
  { id: "side", label: "Side" },
];

const cfdModes = [
  { id: "pressure", label: "Pressure" },
  { id: "velocity", label: "Velocity" },
  { id: "vorticity", label: "Vorticity" },
  { id: "turbulenceK", label: "Turbulence k" },
  { id: "omega", label: "Omega" },
  { id: "nut", label: "Nut" },
];

function savedReportKey(projectName: string) {
  return `cadex.paraview.lastReport.${projectName}`;
}

function loadSavedReport(projectName: string) {
  if (typeof window === "undefined") return undefined;
  try {
    return JSON.parse(window.localStorage.getItem(savedReportKey(projectName)) || "null") as ParaViewReport | undefined;
  } catch {
    return undefined;
  }
}

export function ParaViewDashboard({ project, projectName }: { project: SizingProject; projectName: string }) {
  const savedReport = loadSavedReport(projectName);
  const [report, setReport] = useState<ParaViewReport | undefined>(() => savedReport);
  const [selectedViewId, setSelectedViewId] = useState<string | undefined>(() => savedReport?.views?.[0]?.id);
  const [cameraPreset, setCameraPreset] = useState<CameraPreset>(() => savedReport?.renderOptions?.cameraPreset ?? "aftHighRight");
  const [activeMode, setActiveMode] = useState<string>(() => savedReport?.renderOptions?.modes?.[0] ?? "pressure");
  const [selectedTime, setSelectedTime] = useState<string>(() => savedReport?.renderOptions?.time ?? "latest");
  const [running, setRunning] = useState(false);
  const [error, setError] = useState<string | undefined>();
  const shapeCount = project.shapes.length;
  const selectedView = report?.views?.find((view) => view.id === selectedViewId) ?? report?.views?.[0];
  const selectedViewSrc = selectedView?.dataUrl ?? (selectedView?.imagePath ? `/api/export-file?path=${encodeURIComponent(selectedView.imagePath)}` : undefined);

  async function renderGeometry(nextOptions?: Partial<ParaViewRenderOptions>) {
    const options: ParaViewRenderOptions = {
      cameraPreset: nextOptions?.cameraPreset ?? cameraPreset,
      modes: nextOptions?.modes ?? [activeMode],
      time: nextOptions?.time ?? selectedTime,
    };
    setRunning(true);
    setError(undefined);
    try {
      const request = { projectName, sizing: project, renderOptions: options };
      const nextReport = isTauriRuntime()
        ? await invoke<ParaViewReport>("render_sizing_paraview", { request })
        : await fetch("/api/paraview", {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify(request),
          }).then((response) => response.json() as Promise<ParaViewReport>);
      setReport(nextReport);
      setSelectedViewId(nextReport.views?.[0]?.id);
      setCameraPreset(options.cameraPreset);
      setActiveMode(options.modes[0] ?? "pressure");
      setSelectedTime(options.time);
      if (typeof window !== "undefined" && nextReport.ok) window.localStorage.setItem(savedReportKey(projectName), JSON.stringify(nextReport));
      if (!nextReport.ok) setError(nextReport.message);
    } catch (nextError) {
      setError(nextError instanceof Error ? nextError.message : String(nextError));
    } finally {
      setRunning(false);
    }
  }

  function renderCamera(preset: CameraPreset) {
    void renderGeometry({ cameraPreset: preset });
  }

  function renderMode(modeId: string) {
    void renderGeometry({ modes: [modeId] });
  }

  function renderTime(time: string) {
    void renderGeometry({ time });
  }

  return (
    <main className="compute-dashboard paraview-dashboard">
      <section className="compute-panel compute-wide paraview-panel">
        <div className="openfoam-section-head">
          <div>
            <FlaskConical size={18} />
            <h2>ParaView</h2>
            <p>Runs the OpenFOAM cruise case from the actual aircraft geometry, then asks ParaView to render pressure, velocity, and vorticity fields.</p>
          </div>
          <button className="openfoam-action" disabled={running || shapeCount === 0} onClick={() => renderGeometry()} type="button">
            <Play size={15} />
            {running ? "Running FOAM" : "Run FOAM + Render"}
          </button>
        </div>

        {error ? <div className="openfoam-error-banner">{error}</div> : null}

        <article className="paraview-render-card">
          <div className="paraview-render-head">
            <div>
              <ImageIcon size={16} />
              <h3>OpenFOAM Result Render</h3>
            </div>
            <span>{report?.solver ?? "ParaView"}</span>
          </div>
          <div className="paraview-controls" aria-label="ParaView render controls">
            <div className="paraview-control-group">
              <span><Camera size={14} /> Camera</span>
              <div className="paraview-example-tabs">
                {cameraPresets.map((preset) => (
                  <button className={cameraPreset === preset.id ? "active" : ""} disabled={running} key={preset.id} onClick={() => renderCamera(preset.id)} type="button">
                    {preset.label}
                  </button>
                ))}
              </div>
            </div>
            <div className="paraview-control-group">
              <span><ImageIcon size={14} /> CFD modes</span>
              <div className="paraview-example-tabs">
                {cfdModes.map((mode) => (
                  <button className={activeMode === mode.id ? "active" : ""} disabled={running} key={mode.id} onClick={() => renderMode(mode.id)} type="button">
                    {mode.label}
                  </button>
                ))}
              </div>
            </div>
            <div className="paraview-control-group">
              <span><Timer size={14} /> Time</span>
              <div className="paraview-example-tabs">
                <button className={selectedTime === "latest" ? "active" : ""} disabled={running} onClick={() => renderTime("latest")} type="button">Latest</button>
                {(report?.availableTimes ?? []).map((time) => (
                  <button className={selectedTime === time ? "active" : ""} disabled={running} key={time} onClick={() => renderTime(time)} type="button">
                    {time}
                  </button>
                ))}
              </div>
            </div>
          </div>
          {report?.views?.length ? (
            <div className="paraview-example-tabs" aria-label="ParaView result views">
              {report.views.map((view) => (
                <button className={view.id === selectedView?.id ? "active" : ""} key={view.id} onClick={() => setSelectedViewId(view.id)} type="button">
                  {view.title}
                </button>
              ))}
            </div>
          ) : null}
          <div className="paraview-render-frame">
            {selectedViewSrc ? (
              <img alt={`ParaView render of ${selectedView?.title ?? "OpenFOAM result"}`} src={selectedViewSrc} />
            ) : (
              <div className="paraview-empty">
                <strong>{running ? "Running OpenFOAM and rendering in ParaView..." : "No ParaView result render yet."}</strong>
                <span>{report?.message ?? "Click Run FOAM + Render to solve the aircraft case and request ParaView field images."}</span>
              </div>
            )}
          </div>
        </article>

      </section>
    </main>
  );
}
