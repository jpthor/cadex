import { invoke } from "@tauri-apps/api/core";
import { FlaskConical, Image as ImageIcon, Play } from "lucide-react";
import { useMemo, useState } from "react";
import type { SizingProject } from "../../sizing";
import { isTauriRuntime } from "../../lib/tauriRuntime";
import { Metric } from "../ui/Metric";

type ParaViewReport = {
  ok: boolean;
  backendReady?: boolean;
  solver: "ParaView";
  message: string;
  executable?: string;
  geometryReady?: boolean;
  componentCount?: number;
  geometryDir?: string;
  manifestPath?: string;
  scriptPath?: string;
  imagePath?: string;
  renderDataUrl?: string;
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

export function ParaViewDashboard({ project, projectName }: { project: SizingProject; projectName: string }) {
  const [report, setReport] = useState<ParaViewReport | undefined>();
  const [running, setRunning] = useState(false);
  const [error, setError] = useState<string | undefined>();
  const shapeCount = project.shapes.length;
  const missingText = useMemo(() => report?.verification?.missing?.join(", ") || "none", [report]);

  async function renderGeometry() {
    setRunning(true);
    setError(undefined);
    try {
      const request = { projectName, sizing: project };
      const nextReport = isTauriRuntime()
        ? await invoke<ParaViewReport>("render_sizing_paraview", { request })
        : await fetch("/api/paraview", {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify(request),
          }).then((response) => response.json() as Promise<ParaViewReport>);
      setReport(nextReport);
      if (!nextReport.ok) setError(nextReport.message);
    } catch (nextError) {
      setError(nextError instanceof Error ? nextError.message : String(nextError));
    } finally {
      setRunning(false);
    }
  }

  return (
    <main className="compute-dashboard paraview-dashboard">
      <section className="compute-panel compute-wide paraview-panel">
        <div className="openfoam-section-head">
          <div>
            <FlaskConical size={18} />
            <h2>ParaView</h2>
            <p>Exports the actual aircraft geometry, asks ParaView to render it, then displays the returned image.</p>
          </div>
          <button className="openfoam-action" disabled={running || shapeCount === 0} onClick={renderGeometry} type="button">
            <Play size={15} />
            {running ? "Rendering" : "Render Geometry"}
          </button>
        </div>

        <div className="openfoam-mission-panel" aria-label="Mission parameters">
          <Metric label="Geometry source" value="actual Sketch" />
          <Metric label="Sketch shapes" value={String(shapeCount)} />
          <Metric label="Backend" note={report?.executable} noteTone={report?.backendReady ? "good" : "caution"} value={report?.backendReady ? "ParaView found" : "not rendered"} />
          <Metric label="Rendered output" note={report?.imagePath} noteTone={report?.ok ? "good" : "neutral"} value={report?.ok ? "PNG" : "--"} />
        </div>

        {error ? <div className="openfoam-error-banner">{error}</div> : null}

        <article className="paraview-render-card">
          <div className="paraview-render-head">
            <div>
              <ImageIcon size={16} />
              <h3>Aircraft Geometry Render</h3>
            </div>
            <span>{report?.solver ?? "ParaView"}</span>
          </div>
          <div className="paraview-render-frame">
            {report?.renderDataUrl ? (
              <img alt="ParaView render of exported aircraft geometry" src={report.renderDataUrl} />
            ) : (
              <div className="paraview-empty">
                <strong>{running ? "Rendering in ParaView..." : "No ParaView render yet."}</strong>
                <span>{report?.message ?? "Click Render Geometry to export the aircraft and request a ParaView PNG."}</span>
              </div>
            )}
          </div>
        </article>

        <div className="compute-machupx-grid openfoam-result-grid">
          <Metric label="Exported components" note={report?.geometryDir} value={report?.componentCount != null ? String(report.componentCount) : "--"} />
          <Metric label="Geometry check" note={report?.verification?.warnings?.[0]} noteTone={report?.verification?.ok ? "good" : "caution"} value={report?.verification?.ok ? "passed" : "--"} />
          <Metric label="Missing groups" noteTone={missingText === "none" ? "good" : "caution"} value={missingText} />
          <Metric label="Report" note={report?.reportPath} value={report?.reportPath ? "saved" : "--"} />
        </div>
      </section>
    </main>
  );
}
