import { invoke } from "@tauri-apps/api/core";
import { open as openFileDialog, save as saveFileDialog } from "@tauri-apps/plugin-dialog";
import { sendOpenAiDesignMessage } from "../ai";
import { projectToStl } from "../geometry";
import type { CadProject, GeometryFormat, SelectedGeometry } from "../types";
import { isTauriRuntime } from "./tauriRuntime";

export async function runAiDesignCommand(request: {
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

export async function exportCurrentProject(project: CadProject, format: "stl" | "step") {
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

export async function importIntoProject(project: CadProject, format: GeometryFormat) {
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
