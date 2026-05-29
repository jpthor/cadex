import { batterySamples, motorSamples, propellerSamples } from "../propulsionEngine";
import { defaultSizingProject, normalizeSizingProject } from "../sizing";
import type { SizingProject } from "../sizing";
import type { CadProject } from "../types";
import type { AircraftMasterState, AircraftProjectEntry, PropulsionTabState } from "../app/types";
import { defaultPropulsionTabState, projectStorageKey } from "../app/constants";
import { fallbackProject } from "./projectDefaults";

export function loadStoredProject(): CadProject | undefined {
  try {
    const raw = localStorage.getItem(projectStorageKey);
    if (!raw) return undefined;
    const parsed = JSON.parse(raw) as Partial<CadProject>;
    return normalizeCadProject(parsed);
  } catch {
    return undefined;
  }
}

export function loadStoredAircraftState(): AircraftMasterState | undefined {
  try {
    const raw = localStorage.getItem(projectStorageKey);
    if (!raw) return undefined;
    const parsed = JSON.parse(raw) as Partial<AircraftMasterState>;
    if (!parsed.project && !parsed.sizing && !parsed.propulsion) return undefined;
    const sizing = normalizeSizingProject(parsed.sizing ?? parsed.project?.sizing);
    const project = normalizeCadProject({ ...parsed.project, sizing });
    return {
      id: typeof parsed.id === "string" ? parsed.id : project.id,
      name: typeof parsed.name === "string" ? parsed.name : project.name,
      schemaVersion: typeof parsed.schemaVersion === "number" ? parsed.schemaVersion : 1,
      updatedAt: typeof parsed.updatedAt === "number" ? parsed.updatedAt : undefined,
      project,
      sizing,
      propulsion: normalizePropulsionTabState(parsed.propulsion),
    };
  } catch {
    return undefined;
  }
}

export function normalizeCadProject(parsed: Partial<CadProject> | undefined): CadProject {
  if (!parsed || !Array.isArray(parsed.objects) || !Array.isArray(parsed.timeline)) return fallbackProject();
  return {
    id: typeof parsed.id === "string" ? parsed.id : crypto.randomUUID(),
    name: typeof parsed.name === "string" ? parsed.name : "Untitled aircraft",
    units: typeof parsed.units === "string" ? parsed.units : "m",
    objects: parsed.objects as CadProject["objects"],
    timeline: parsed.timeline as CadProject["timeline"],
    sizing: parsed.sizing,
  };
}

export function buildAircraftMasterState(
  id: string | undefined,
  name: string,
  project: CadProject,
  sizing: SizingProject,
  propulsion: PropulsionTabState,
): AircraftMasterState {
  return {
    id,
    name,
    schemaVersion: 1,
    updatedAt: Date.now(),
    project: { ...project, name, sizing },
    propulsion: normalizePropulsionTabState(propulsion),
    sizing,
  };
}

export function normalizePropulsionTabState(input: Partial<PropulsionTabState> | undefined): PropulsionTabState {
  return {
    selectedBatteryId:
      typeof input?.selectedBatteryId === "string" && batterySamples.some((battery) => battery.id === input.selectedBatteryId)
        ? input.selectedBatteryId
        : defaultPropulsionTabState.selectedBatteryId,
    selectedMotorId:
      typeof input?.selectedMotorId === "string" && motorSamples.some((motor) => motor.id === input.selectedMotorId)
        ? input.selectedMotorId
        : defaultPropulsionTabState.selectedMotorId,
    selectedPropellerId:
      typeof input?.selectedPropellerId === "string" &&
      propellerSamples.some((propeller) => propeller.id === input.selectedPropellerId)
        ? input.selectedPropellerId
        : defaultPropulsionTabState.selectedPropellerId,
    targetEnduranceMin:
      typeof input?.targetEnduranceMin === "number" && Number.isFinite(input.targetEnduranceMin)
        ? Math.max(1, input.targetEnduranceMin)
        : defaultPropulsionTabState.targetEnduranceMin,
    targetThrustToWeight:
      typeof input?.targetThrustToWeight === "number" && Number.isFinite(input.targetThrustToWeight)
        ? Math.max(0.1, input.targetThrustToWeight)
        : defaultPropulsionTabState.targetThrustToWeight,
  };
}

export function upsertAircraftProject(projects: AircraftProjectEntry[], entry: AircraftProjectEntry) {
  return [entry, ...projects.filter((project) => project.id !== entry.id)].sort((a, b) => b.updatedAtMs - a.updatedAtMs);
}

export async function listAircraftProjects() {
  const response = await fetchWithCadBridgeFallback("/api/cad/projects");
  if (!response.ok) throw new Error(await response.text());
  const payload = (await response.json()) as { projects: AircraftProjectEntry[] };
  return payload.projects ?? [];
}

export async function createAircraftProject(name: string, state: AircraftMasterState) {
  return projectApi<{ project: AircraftProjectEntry; state: AircraftMasterState }>("/api/cad/projects/create", {
    name,
    state,
  });
}

export async function fetchAircraftProject(id: string) {
  return projectApi<{ project: AircraftProjectEntry; state: AircraftMasterState }>("/api/cad/projects/load", { id });
}

export async function persistAircraftProject(id: string, state: AircraftMasterState, expectedUpdatedAt?: number) {
  return projectApi<{ project: AircraftProjectEntry; state: AircraftMasterState }>("/api/cad/projects/save", {
    expectedUpdatedAt,
    id,
    state,
  });
}

export async function deleteAircraftProject(id: string) {
  return projectApi<{ deletedId: string; projects: AircraftProjectEntry[] }>("/api/cad/projects/delete", { id });
}

async function projectApi<T>(url: string, body: unknown): Promise<T> {
  const response = await fetchWithCadBridgeFallback(url, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });
  if (!response.ok) throw new Error(await response.text());
  return (await response.json()) as T;
}

async function fetchWithCadBridgeFallback(path: string, init?: RequestInit) {
  try {
    return await fetch(path, init);
  } catch (error) {
    if (!path.startsWith("/api/cad")) throw error;
    return fetch(`http://127.0.0.1:1421${path.replace(/^\/api\/cad/, "")}`, init);
  }
}
