import type { CadProject } from "../types";

export function fallbackProject(): CadProject {
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
