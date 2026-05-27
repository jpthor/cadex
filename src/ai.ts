import type {
  CadObject,
  CadProject,
  ReferenceGeometry,
  ReferenceGeometryKind,
  SelectedGeometry,
  SolidObject,
  Vector3Tuple,
} from "./types";

export type AiDesignRequest = {
  apiKey: string;
  model: string;
  message: string;
  project: CadProject;
  selectedGeometry?: SelectedGeometry | null;
};

export type AiDesignResult = {
  assistantText: string;
  project: CadProject;
};

type CylinderSpec = {
  diameterM: number;
  lengthM: number;
  origin: Vector3Tuple;
  plane: "XZ";
  name: string;
};

type OpenAiToolCall = {
  name: string;
  arguments: Record<string, unknown>;
};

export function runLocalDesignCommand(
  project: CadProject,
  message: string,
  selectedGeometry?: SelectedGeometry | null,
): AiDesignResult | undefined {
  const cylinderSpec = parseRoundExtrudeCommand(message, selectedGeometry);
  if (!cylinderSpec) return undefined;

  const solid = cylinderFromSpec(cylinderSpec);
  const construction = decomposeCylinderIntoCadFeatures(solid, cylinderSpec);
  return {
    assistantText: `Created a ${formatMm(cylinderSpec.diameterM)} round extruded solid on the ${cylinderSpec.plane} plane at the origin.`,
    project: {
      ...project,
      objects: [...project.objects, ...construction, solid],
      timeline: [
        ...project.timeline,
        {
          id: crypto.randomUUID(),
          label: "Created round extruded solid",
          detail: `${solid.name}: ${formatMm(cylinderSpec.diameterM)} diameter, ${formatMm(cylinderSpec.lengthM)} extrusion on ${cylinderSpec.plane}`,
        },
      ],
    },
  };
}

export async function sendOpenAiDesignMessage(request: AiDesignRequest): Promise<AiDesignResult> {
  const kernelTools = await loadKernelToolCatalog();
  const response = await fetch("/api/openai/v1/responses", {
    method: "POST",
    headers: {
      "Authorization": `Bearer ${request.apiKey}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify(openAiRequestBody(request.model, request.message, request.project, request.selectedGeometry, kernelTools)),
  });

  const payload = await response.json().catch(() => undefined);
  if (!response.ok) {
    throw new Error(extractOpenAiError(payload) ?? `OpenAI request failed with status ${response.status}`);
  }

  const toolCalls = extractFunctionCalls(payload);
  const kernelResult = kernelTools ? await applyKernelToolCalls(request.project, toolCalls, request.selectedGeometry) : undefined;
  const project = kernelResult?.project ?? applyToolCalls(request.project, toolCalls, request.selectedGeometry);
  const assistantText = kernelResult?.assistantText ?? extractOutputText(payload) ?? "Created the requested CAD geometry.";
  return { assistantText, project };
}

export async function isKernelBridgeAvailable() {
  const response = await fetch("/api/cad/health").catch(() => undefined);
  return Boolean(response?.ok);
}

async function loadKernelToolCatalog() {
  const response = await fetch("/api/cad/tools").catch(() => undefined);
  if (!response?.ok) return undefined;
  const payload = await response.json().catch(() => undefined) as { tools?: unknown };
  return Array.isArray(payload?.tools) ? payload.tools : undefined;
}

async function applyKernelToolCalls(
  project: CadProject,
  toolCalls: OpenAiToolCall[],
  selectedGeometry?: SelectedGeometry | null,
): Promise<AiDesignResult | undefined> {
  if (toolCalls.length === 0) return undefined;
  let next = project;
  const messages: string[] = [];
  for (const call of toolCalls) {
    const response = await fetch("/api/cad/tool", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        project: next,
        name: call.name,
        args: call.arguments,
        selectedGeometry,
      }),
    });
    const payload = await response.json().catch(() => undefined) as AiDesignResult & { error?: string } | undefined;
    if (!response.ok) throw new Error(payload?.error ?? `CAD kernel tool ${call.name} failed`);
    if (!payload?.project) throw new Error(`CAD kernel tool ${call.name} did not return a project`);
    next = payload.project;
    messages.push(`[${call.name}] ${payload.assistantText ?? "updated CAD model"}`);
  }
  return { project: next, assistantText: messages.join("\n") };
}

export function applyToolCalls(
  project: CadProject,
  toolCalls: OpenAiToolCall[],
  selectedGeometry?: SelectedGeometry | null,
): CadProject {
  let next = project;
  for (const call of toolCalls) {
    if (call.name === "create_part") {
      const { construction, part } = genericPartFromToolArgs(call.arguments, selectedGeometry, next);
      next = {
        ...next,
        objects: [...next.objects, ...construction, part],
        timeline: [
          ...next.timeline,
          {
            id: crypto.randomUUID(),
            label: "AI generated CAD feature tree",
            detail: `Created ${construction.length} construction feature${construction.length === 1 ? "" : "s"} and ${part.name}`,
          },
        ],
      };
    }
    if (call.name === "create_reference_geometry") {
      const reference = referenceGeometryFromToolArgs(call.arguments);
      next = {
        ...next,
        objects: [...next.objects, reference],
        timeline: [
          ...next.timeline,
          {
            id: crypto.randomUUID(),
            label: `AI generated ${reference.referenceKind}`,
            detail: `${reference.name} at ${reference.origin.map((value) => value.toFixed(3)).join(", ")} m`,
          },
        ],
      };
    }
    if (call.name === "orient_part") {
      next = orientPart(next, call.arguments, selectedGeometry);
    }
  }
  return next;
}

export function openAiRequestBody(
  model: string,
  message: string,
  project: CadProject,
  selectedGeometry?: SelectedGeometry | null,
  toolsOverride?: unknown[],
) {
  const selectedGeometryText = selectedGeometry
    ? `Current selected geometry: ${JSON.stringify(selectedGeometry)}. Use it as the anchor when the user says "here", "this", "selected", "on it", or asks to add a plane, point, line, face, or surface without another location.`
    : "No canvas geometry is currently selected.";
  const projectContextText = `Current project geometry: ${project.objects.map(objectSummary).join(" | ") || "empty project"}.`;

  return {
    model,
    input: [
      {
        role: "system",
        content:
          "You are Cadex, a generic parametric CAD copilot. For any request to design, create, build, generate, or modify geometry, call the matching CAD tool. Use SI units internally. Convert cm and mm into meters. Do not only describe geometry when a CAD tool can create it. When a selected geometry context is provided, treat it as the active CAD selection. Prefer kernel-backed solid tools such as create_box, create_cylinder, extrude_polygon, loft_polygons, sweep_polygon, and boolean operations. Avoid named product templates; infer the needed profile, path, dimensions, and operation from the user's language.",
      },
      {
        role: "system",
        content: projectContextText,
      },
      {
        role: "system",
        content: selectedGeometryText,
      },
      {
        role: "user",
        content: message,
      },
    ],
    tools: toolsOverride ?? [
      {
        type: "function",
        name: "create_part",
        description: "Create a generic parametric CAD part from planes, sketches, paths, and operations.",
        parameters: {
          type: "object",
          properties: {
            operation: {
              type: "string",
              enum: ["loft", "sweep", "extrude"],
              description: "CAD operation used to create the body.",
            },
            profile_kind: {
              type: "string",
              enum: ["airfoil", "circle", "ellipse", "rectangle"],
              description: "Sketch/profile type used by the operation.",
            },
            profile_code: { type: "string", description: "Optional profile identifier, for example NACA 2412." },
            length_m: { type: "number", description: "Main path or extrusion length in meters." },
            span_m: { type: "number", description: "Alias for length when the user describes a span." },
            chord_m: { type: "number", description: "Profile chord/width in meters." },
            root_chord_m: { type: "number", description: "Alias for chord when the user describes a root chord." },
            tip_chord_m: { type: "number", description: "Optional end profile chord/width for lofts." },
            diameter_m: { type: "number", description: "Circular profile diameter in meters." },
            width_m: { type: "number", description: "Profile width in meters." },
            height_m: { type: "number", description: "Profile height/thickness in meters." },
            sweep_deg: { type: "number", description: "Optional path offset angle in degrees." },
            dihedral_deg: { type: "number", description: "Optional secondary path offset angle in degrees." },
            target_plane: {
              type: "string",
              enum: ["XZ"],
              description: "Starting sketch plane.",
            },
            origin: {
              type: "array",
              items: { type: "number" },
              minItems: 3,
              maxItems: 3,
              description: "Part anchor in meters. Defaults to selected geometry position or origin.",
            },
            name: { type: "string", description: "Short object name." },
          },
          required: ["operation", "profile_kind"],
          additionalProperties: false,
        },
        strict: false,
      },
      {
        type: "function",
        name: "create_reference_geometry",
        description: "Create construction/reference geometry in the current project, usually anchored on the active selected geometry.",
        parameters: {
          type: "object",
          properties: {
            reference_kind: {
              type: "string",
              enum: ["plane", "point", "line", "face", "surface"],
              description: "Kind of construction geometry to create.",
            },
            name: { type: "string", description: "Short object name." },
            origin: {
              type: "array",
              items: { type: "number" },
              minItems: 3,
              maxItems: 3,
              description: "Origin or center in meters, as [x, y, z]. Defaults to the selected point.",
            },
            normal: {
              type: "array",
              items: { type: "number" },
              minItems: 3,
              maxItems: 3,
              description: "Plane/face/surface normal as [x, y, z]. Defaults to selected normal or world up.",
            },
            end: {
              type: "array",
              items: { type: "number" },
              minItems: 3,
              maxItems: 3,
              description: "Line endpoint in meters, as [x, y, z].",
            },
            size_m: { type: "number", description: "Display size in meters for plane/face/surface references." },
          },
          required: ["reference_kind"],
          additionalProperties: false,
        },
        strict: false,
      },
      {
        type: "function",
        name: "orient_part",
        description: "Re-orient or place an existing body on an origin plane or at the origin.",
        parameters: {
          type: "object",
          properties: {
            id: { type: "string", description: "Object id to orient. Defaults to selected object, then most recent body." },
            target_plane: {
              type: "string",
              enum: ["XZ"],
              description: "World plane the part should lie on. XZ means chord/span on XZ with thickness along Y.",
            },
            anchor: {
              type: "string",
              enum: ["profile_origin", "bounds_min_z_origin"],
              description: "Anchor placement for the body.",
            },
          },
          required: ["target_plane", "anchor"],
          additionalProperties: false,
        },
        strict: false,
      },
    ],
  };
}

function genericPartFromToolArgs(
  args: Record<string, unknown>,
  selectedGeometry: SelectedGeometry | null | undefined,
  project: CadProject,
): { construction: ReferenceGeometry[]; part: SolidObject } {
  const profileKind =
    stringArg(args, "profile_kind") ??
    (stringArg(args, "profile_code") || stringArg(args, "airfoil") ? "airfoil" : undefined) ??
    "rectangle";
  const operation =
    stringArg(args, "operation") ??
    (profileKind === "airfoil" ? "loft" : "sweep");

  if (operation === "extrude" && profileKind === "circle") {
    const cylinder = cylinderFromToolArgs(args, selectedGeometry);
    return {
      construction: decomposeCylinderIntoCadFeatures(cylinder.solid, cylinder.spec),
      part: {
        ...cylinder.solid,
        source: "create_part:extrude",
        kernelHandle: `extrude:${crypto.randomUUID()}`,
      },
    };
  }
  if (profileKind === "airfoil") {
    return createAirfoilLoftPart(args, project);
  }
  return createSweptProfilePart(args, selectedGeometry, profileKind, operation);
}

function createAirfoilLoftPart(
  args: Record<string, unknown>,
  project: CadProject,
): { construction: ReferenceGeometry[]; part: SolidObject } {
  const profileCode = stringArg(args, "profile_code") ?? stringArg(args, "airfoil") ?? "NACA 0012";
  const lengthM = numberArg(args, "length_m", numberArg(args, "span_m", 1));
  const rootChordM = numberArg(args, "chord_m", numberArg(args, "root_chord_m", 0.2));
  const tipChordM = numberArg(args, "tip_chord_m", rootChordM);
  const sweepDeg = numberArg(args, "sweep_deg", 0);
  const dihedralDeg = numberArg(args, "dihedral_deg", 0);
  const rootOrigin: Vector3Tuple = vectorArg(args, "origin", [0, 0, -lengthM / 2]) ?? [0, 0, -lengthM / 2];
  const tipOrigin: Vector3Tuple = [
    rootOrigin[0] + lengthM * Math.tan(degToRad(sweepDeg)),
    rootOrigin[1] + lengthM * Math.tan(degToRad(dihedralDeg)),
    rootOrigin[2] + lengthM,
  ];
  const name = stringArg(args, "name") ?? "lofted_profile_part";
  const mesh = airfoilLoftMesh(profileCode, rootChordM, tipChordM, rootOrigin, tipOrigin);
  const part: SolidObject = {
    kind: "solid",
    id: crypto.randomUUID(),
    name,
    source: "create_part:loft",
    kernelHandle: `loft:${crypto.randomUUID()}`,
    triangleCount: mesh.positions.length / 9,
    positions: mesh.positions,
    normals: [],
  };
  const prefix = name.replace(/\s+/g, "_");
  const existingPlane = project.objects.find(
    (object): object is ReferenceGeometry => object.kind === "reference" && object.referenceKind === "plane",
  );
  const startPlane =
    existingPlane ??
    cadReference("plane", `${prefix} sketch plane`, rootOrigin, {
      normal: [0, 0, 1],
      sizeM: rootChordM * 1.4,
      cadRole: "construction_plane",
      parentId: part.id,
      dependsOn: ["origin"],
    });
  const construction: ReferenceGeometry[] = existingPlane ? [] : [startPlane];
  const profileSketch = cadReference("line", `${prefix} profile sketch`, rootOrigin, {
    points: airfoilProfilePoints(profileCode, rootChordM, rootOrigin),
    cadRole: "profile_sketch",
    parentId: part.id,
    dependsOn: [startPlane.id],
  });
  const pathSketch = cadReference("line", `${prefix} path sketch`, rootOrigin, {
    end: tipOrigin,
    points: [rootOrigin, tipOrigin],
    cadRole: "path_sketch",
    parentId: part.id,
    dependsOn: [startPlane.id],
  });
  const operationSurface = cadReference("surface", `${prefix} loft operation`, [0, 0, 0], {
    points: [
      [rootOrigin[0] - rootChordM * 0.25, rootOrigin[1], rootOrigin[2]],
      [rootOrigin[0] + rootChordM * 0.75, rootOrigin[1], rootOrigin[2]],
      [tipOrigin[0] + tipChordM * 0.75, tipOrigin[1], tipOrigin[2]],
      [tipOrigin[0] - tipChordM * 0.25, tipOrigin[1], tipOrigin[2]],
      [rootOrigin[0] - rootChordM * 0.25, rootOrigin[1], rootOrigin[2]],
    ],
    normal: [0, 1, 0],
    cadRole: "loft_operation",
    operation: "loft profile along path",
    parentId: part.id,
    dependsOn: [profileSketch.id, pathSketch.id],
  });
  construction.push(profileSketch, pathSketch, operationSurface);
  part.dependsOn = [operationSurface.id];
  return { construction, part };
}

function createSweptProfilePart(
  args: Record<string, unknown>,
  selectedGeometry: SelectedGeometry | null | undefined,
  profileKind: string,
  operation: string,
): { construction: ReferenceGeometry[]; part: SolidObject } {
  const lengthM = numberArg(args, "length_m", numberArg(args, "span_m", 0.72));
  const widthM = numberArg(args, "width_m", numberArg(args, "diameter_m", 0.075));
  const heightM = numberArg(args, "height_m", widthM * 0.72);
  const diameterM = Math.max(widthM, heightM);
  const origin = vectorArg(args, "origin", selectedGeometry?.position ?? [0, 0, 0]) ?? [0, 0, 0];
  const name = stringArg(args, "name") ?? `${operation}_${profileKind}_part`;
  const mesh = taperedTubeMesh(origin, lengthM, diameterM);
  const part: SolidObject = {
    kind: "solid",
    id: crypto.randomUUID(),
    name,
    source: `create_part:${operation}`,
    kernelHandle: `${operation}:${crypto.randomUUID()}`,
    triangleCount: mesh.positions.length / 9,
    positions: mesh.positions,
    normals: [],
  };
  return {
    construction: decomposeSweptProfileIntoCadFeatures(part, origin, lengthM, diameterM, selectedGeometry, profileKind, operation),
    part,
  };
}

function airfoilLoftMesh(
  profileCode: string,
  rootChordM: number,
  tipChordM: number,
  rootOrigin: Vector3Tuple,
  tipOrigin: Vector3Tuple,
) {
  const root = airfoilProfilePoints(profileCode, rootChordM, rootOrigin).slice(0, -1);
  const tip = airfoilProfilePoints(profileCode, tipChordM, tipOrigin).slice(0, -1);
  const samples = Math.min(root.length, tip.length);
  const positions: number[] = [];
  for (let sample = 0; sample < samples; sample += 1) {
    const next = (sample + 1) % samples;
    positions.push(...root[sample], ...tip[sample], ...root[next], ...root[next], ...tip[sample], ...tip[next]);
  }
  return { positions };
}

function objectSummary(object: CadObject) {
  if (object.kind === "wing") {
    return `legacy airfoil loft body id=${object.id} name=${object.name} profile=${object.airfoil} length=${object.spanM}m root=${object.rootChordM}m tip=${object.tipChordM}m originAligned=${Boolean(object.rootAtOrigin)} plane=${object.orientationPlane ?? "default"}`;
  }
  if (object.kind === "solid") {
    return `body id=${object.id} name=${object.name} source=${object.source}`;
  }
  if (object.kind === "mesh") {
    return `mesh id=${object.id} name=${object.name} triangles=${object.triangleCount}`;
  }
  return `reference id=${object.id} name=${object.name} kind=${object.referenceKind} role=${object.cadRole ?? "reference"} parent=${object.parentId ?? "none"}`;
}

function orientPart(
  project: CadProject,
  args: Record<string, unknown>,
  selectedGeometry?: SelectedGeometry | null,
): CadProject {
  const targetPlane = stringArg(args, "target_plane") ?? "XZ";
  const anchor = stringArg(args, "anchor") ?? "profile_origin";
  if (targetPlane !== "XZ") throw new Error(`Unsupported target plane: ${targetPlane}`);

  const targetId = stringArg(args, "id") ?? selectedGeometry?.objectId ?? lastBodyId(project);
  if (!targetId || targetId === "origin" || targetId.startsWith("origin-plane-")) {
    throw new Error("Select a part or create a part before re-orienting.");
  }

  const target = project.objects.find((object) => object.id === targetId);
  if (!target || (target.kind !== "wing" && target.kind !== "mesh" && target.kind !== "solid")) {
    throw new Error("Select a body or solid before re-orienting.");
  }

  const wingDelta: Vector3Tuple | undefined = target.kind === "wing" && !target.rootAtOrigin ? [0, 0, target.spanM / 2] : undefined;
  const meshDelta: Vector3Tuple | undefined =
    target.kind === "mesh" || target.kind === "solid" ? rootOriginDeltaForPositions(target.positions) : undefined;
  const delta = wingDelta ?? meshDelta;

  return {
    ...project,
    objects: project.objects.map((object) => {
      if (object.id === targetId && object.kind === "wing") {
        return {
          ...object,
          dihedralDeg: 0,
          rootAtOrigin: true,
          orientationPlane: "XZ" as const,
        };
      }
      if (object.id === targetId && (object.kind === "mesh" || object.kind === "solid") && meshDelta) {
        return {
          ...object,
          positions: translateFlatPositions(object.positions, meshDelta),
        };
      }
      if (object.kind === "reference" && object.parentId === targetId && delta) {
        return translateReference(object, delta);
      }
      return object;
    }),
    timeline: [
      ...project.timeline,
      {
        id: crypto.randomUUID(),
        label: "Re-oriented part",
        detail:
          anchor === "profile_origin"
            ? "Placed the profile origin at world origin on the XZ plane"
            : "Placed body bounds at world origin on the XZ plane",
      },
    ],
  };
}

function lastBodyId(project: CadProject) {
  return [...project.objects].reverse().find((object) => object.kind === "wing" || object.kind === "mesh" || object.kind === "solid")?.id;
}

function rootOriginDeltaForPositions(positions: number[]): Vector3Tuple | undefined {
  const bounds = boundsFromPositions(positions);
  if (!bounds) return undefined;
  const anchor: Vector3Tuple = [
    (bounds.min[0] + bounds.max[0]) / 2,
    (bounds.min[1] + bounds.max[1]) / 2,
    bounds.min[2],
  ];
  return [-anchor[0], -anchor[1], -anchor[2]];
}

function boundsFromPositions(positions: number[]) {
  if (positions.length < 3) return undefined;
  const min: Vector3Tuple = [Infinity, Infinity, Infinity];
  const max: Vector3Tuple = [-Infinity, -Infinity, -Infinity];
  for (let index = 0; index + 2 < positions.length; index += 3) {
    for (let axis = 0; axis < 3; axis += 1) {
      min[axis] = Math.min(min[axis], positions[index + axis]);
      max[axis] = Math.max(max[axis], positions[index + axis]);
    }
  }
  return { min, max };
}

function translateFlatPositions(positions: number[], delta: Vector3Tuple) {
  return positions.map((value, index) => value + delta[index % 3]);
}

function translateReference(reference: ReferenceGeometry, delta: Vector3Tuple): ReferenceGeometry {
  return {
    ...reference,
    origin: addVectors(reference.origin, delta),
    end: reference.end ? addVectors(reference.end, delta) : undefined,
    points: reference.points?.map((point) => addVectors(point, delta)),
  };
}

function addVectors(a: Vector3Tuple, b: Vector3Tuple): Vector3Tuple {
  return [a[0] + b[0], a[1] + b[1], a[2] + b[2]];
}

function parseRoundExtrudeCommand(
  message: string,
  selectedGeometry?: SelectedGeometry | null,
): CylinderSpec | undefined {
  const lower = message.toLowerCase();
  const asksForRound = /\b(round|circular|circle|cylinder|cylindrical)\b/.test(lower);
  const asksForSolid = /\b(extrud(?:e|ed|ion)?|solid|cylinder)\b/.test(lower);
  if (!asksForRound || !asksForSolid) return undefined;

  const diameterM = parseLengthNear(lower, ["diameter", "dia", "round", "circle"]) ?? parseFirstLength(lower);
  if (!diameterM) return undefined;
  const lengthM = parseLengthNear(lower, ["long", "length", "deep", "extrude", "extruded"]) ?? diameterM;
  const origin: Vector3Tuple = lower.includes("origin") ? [0, 0, 0] : selectedGeometry?.position ?? [0, 0, 0];
  const plane = lower.includes("xz") || selectedGeometry?.description.toLowerCase().includes("xz") ? "XZ" : "XZ";
  return {
    diameterM,
    lengthM,
    origin,
    plane,
    name: "round_extruded_solid",
  };
}

function cylinderFromToolArgs(
  args: Record<string, unknown>,
  selectedGeometry?: SelectedGeometry | null,
): { solid: SolidObject; spec: CylinderSpec } {
  const diameterM = numberArg(args, "diameter_m", 0.05);
  const lengthM = numberArg(args, "length_m", diameterM);
  const origin = vectorArg(args, "origin", selectedGeometry?.position ?? [0, 0, 0]) ?? [0, 0, 0];
  const spec: CylinderSpec = {
    diameterM,
    lengthM,
    origin,
    plane: "XZ",
    name: stringArg(args, "name") ?? "round_extruded_solid",
  };
  return { solid: cylinderFromSpec(spec), spec };
}

function cylinderFromSpec(spec: CylinderSpec): SolidObject {
  const mesh = cylinderMeshOnXZ(spec.origin, spec.lengthM, spec.diameterM);
  return {
    kind: "solid",
    id: crypto.randomUUID(),
    name: spec.name,
    source: "create_part:round_extrude",
    kernelHandle: `round_extrude:${crypto.randomUUID()}`,
    triangleCount: mesh.positions.length / 9,
    positions: mesh.positions,
    normals: [],
  };
}

function decomposeCylinderIntoCadFeatures(solid: SolidObject, spec: CylinderSpec): ReferenceGeometry[] {
  const radius = spec.diameterM / 2;
  const y0 = spec.origin[1] - spec.lengthM / 2;
  const y1 = spec.origin[1] + spec.lengthM / 2;
  const pathStart: Vector3Tuple = [spec.origin[0], y0, spec.origin[2]];
  const pathEnd: Vector3Tuple = [spec.origin[0], y1, spec.origin[2]];
  const prefix = solid.name.replace(/\s+/g, "_");
  const profileSketch = cadReference("line", `${prefix} circle profile sketch`, spec.origin, {
    points: circleProfilePointsOnPlane(spec.origin, radius, 40, spec.plane),
    cadRole: "profile_sketch",
    parentId: solid.id,
    dependsOn: ["origin-plane-xz"],
  });
  const pathSketch = cadReference("line", `${prefix} extrusion path sketch`, pathStart, {
    end: pathEnd,
    points: [pathStart, pathEnd],
    cadRole: "path_sketch",
    parentId: solid.id,
    dependsOn: [profileSketch.id],
  });
  const operationSurface = cadReference("surface", `${prefix} extrude operation`, spec.origin, {
    points: [
      [spec.origin[0] - radius, y0, spec.origin[2]],
      [spec.origin[0] + radius, y0, spec.origin[2]],
      [spec.origin[0] + radius, y1, spec.origin[2]],
      [spec.origin[0] - radius, y1, spec.origin[2]],
      [spec.origin[0] - radius, y0, spec.origin[2]],
    ],
    normal: [0, 0, 1],
    cadRole: "extrude_operation",
    operation: "extrude profile along path",
    parentId: solid.id,
    dependsOn: [profileSketch.id, pathSketch.id],
  });
  solid.dependsOn = [operationSurface.id];
  return [profileSketch, pathSketch, operationSurface];
}

function cylinderMeshOnXZ(origin: Vector3Tuple, lengthM: number, diameterM: number) {
  const radialSegments = 48;
  const positions: number[] = [];
  const radius = diameterM / 2;
  const y0 = origin[1] - lengthM / 2;
  const y1 = origin[1] + lengthM / 2;
  const ringPoint = (y: number, segment: number): Vector3Tuple => {
    const angle = (segment / radialSegments) * Math.PI * 2;
    return [origin[0] + Math.cos(angle) * radius, y, origin[2] + Math.sin(angle) * radius];
  };
  const bottomCenter: Vector3Tuple = [origin[0], y0, origin[2]];
  const topCenter: Vector3Tuple = [origin[0], y1, origin[2]];

  for (let segment = 0; segment < radialSegments; segment += 1) {
    const nextSegment = (segment + 1) % radialSegments;
    const a = ringPoint(y0, segment);
    const b = ringPoint(y1, segment);
    const c = ringPoint(y0, nextSegment);
    const d = ringPoint(y1, nextSegment);
    positions.push(...a, ...b, ...c, ...c, ...b, ...d);
    positions.push(...bottomCenter, ...c, ...a);
    positions.push(...topCenter, ...b, ...d);
  }
  return { positions };
}

function parseFirstLength(text: string) {
  const match = text.match(/(\d+(?:\.\d+)?)\s*(mm|cm|m)\b/);
  return match ? lengthToMeters(Number(match[1]), match[2]) : undefined;
}

function parseLengthNear(text: string, labels: string[]) {
  for (const label of labels) {
    const after = text.match(new RegExp(`${label}\\D{0,16}(\\d+(?:\\.\\d+)?)\\s*(mm|cm|m)\\b`));
    if (after) return lengthToMeters(Number(after[1]), after[2]);
    const before = text.match(new RegExp(`(\\d+(?:\\.\\d+)?)\\s*(mm|cm|m)\\D{0,16}${label}`));
    if (before) return lengthToMeters(Number(before[1]), before[2]);
  }
  return undefined;
}

function lengthToMeters(value: number, unit: string) {
  if (!Number.isFinite(value) || value <= 0) return undefined;
  if (unit === "mm") return value / 1000;
  if (unit === "cm") return value / 100;
  return value;
}

function formatMm(valueM: number) {
  const valueMm = valueM * 1000;
  return `${Number.isInteger(valueMm) ? valueMm.toFixed(0) : valueMm.toFixed(1)} mm`;
}

function decomposeSweptProfileIntoCadFeatures(
  part: SolidObject,
  origin: Vector3Tuple,
  lengthM: number,
  diameterM: number,
  selectedGeometry: SelectedGeometry | null | undefined,
  profileKind: string,
  operation: string,
): ReferenceGeometry[] {
  const radius = diameterM / 2;
  const pathStart: Vector3Tuple = [origin[0] - lengthM / 2, origin[1], origin[2]];
  const pathEnd: Vector3Tuple = [origin[0] + lengthM / 2, origin[1], origin[2]];
  const sourceId = selectedGeometry?.objectId;
  const prefix = part.name.replace(/\s+/g, "_");
  const profilePlane = cadReference("plane", `${prefix} sketch plane`, origin, {
    normal: selectedGeometry?.normal ?? [1, 0, 0],
    sizeM: radius * 3.2,
    cadRole: "construction_plane",
    parentId: part.id,
    dependsOn: sourceId ? [sourceId] : ["origin"],
    sourceSelection: selectedGeometry ?? undefined,
  });
  const profileSketch = cadReference("line", `${prefix} ${profileKind} profile sketch`, origin, {
    points: circleProfilePoints(origin, radius, 28),
    cadRole: "profile_sketch",
    parentId: part.id,
    dependsOn: [profilePlane.id],
  });
  const pathSketch = cadReference("line", `${prefix} path sketch`, pathStart, {
    end: pathEnd,
    points: [pathStart, pathEnd],
    cadRole: "path_sketch",
    parentId: part.id,
    dependsOn: [profilePlane.id],
  });
  const operationNode = cadReference("surface", `${prefix} ${operation} operation`, origin, {
    points: [
      [pathStart[0], origin[1] - radius, origin[2]],
      [pathStart[0], origin[1] + radius, origin[2]],
      [pathEnd[0], origin[1] + radius, origin[2]],
      [pathEnd[0], origin[1] - radius, origin[2]],
      [pathStart[0], origin[1] - radius, origin[2]],
    ],
    normal: [0, 1, 0],
    cadRole: `${operation}_operation`,
    operation: `${operation} profile along path`,
    parentId: part.id,
    dependsOn: [profileSketch.id, pathSketch.id],
  });
  part.dependsOn = [operationNode.id];
  return [profilePlane, profileSketch, pathSketch, operationNode];
}

function taperedTubeMesh(origin: Vector3Tuple, lengthM: number, diameterM: number) {
  const radialSegments = 28;
  const stations = 30;
  const positions: number[] = [];
  const radius = diameterM / 2;
  const ring = (station: number, segment: number): Vector3Tuple => {
    const t = station / stations;
    const x = origin[0] + (t - 0.5) * lengthM;
    const taper = Math.sin(Math.PI * t) ** 0.45;
    const yRadius = radius * taper;
    const zRadius = radius * 0.82 * taper;
    const angle = (segment / radialSegments) * Math.PI * 2;
    return [x, origin[1] + Math.cos(angle) * yRadius, origin[2] + Math.sin(angle) * zRadius];
  };

  for (let station = 0; station < stations; station += 1) {
    for (let segment = 0; segment < radialSegments; segment += 1) {
      const nextSegment = (segment + 1) % radialSegments;
      const a = ring(station, segment);
      const b = ring(station + 1, segment);
      const c = ring(station, nextSegment);
      const d = ring(station + 1, nextSegment);
      positions.push(...a, ...b, ...c, ...c, ...b, ...d);
    }
  }
  return { positions };
}

function circleProfilePoints(origin: Vector3Tuple, radius: number, segments: number): Vector3Tuple[] {
  return Array.from({ length: segments + 1 }, (_, index) => {
    const angle = (index / segments) * Math.PI * 2;
    return [origin[0], origin[1] + Math.cos(angle) * radius, origin[2] + Math.sin(angle) * radius];
  });
}

function circleProfilePointsOnPlane(
  origin: Vector3Tuple,
  radius: number,
  segments: number,
  plane: "XZ",
): Vector3Tuple[] {
  return Array.from({ length: segments + 1 }, (_, index) => {
    const angle = (index / segments) * Math.PI * 2;
    if (plane === "XZ") {
      return [origin[0] + Math.cos(angle) * radius, origin[1], origin[2] + Math.sin(angle) * radius];
    }
    return origin;
  });
}

function cadReference(
  referenceKind: ReferenceGeometryKind,
  name: string,
  origin: [number, number, number],
  options: Partial<ReferenceGeometry> = {},
): ReferenceGeometry {
  return {
    kind: "reference",
    id: crypto.randomUUID(),
    name,
    referenceKind,
    origin,
    ...options,
  };
}

function airfoilProfilePoints(airfoil: string, chord: number, origin: [number, number, number]): [number, number, number][] {
  const samples = 24;
  const upper = Array.from({ length: samples + 1 }, (_, index) => {
    const x = 1 - index / samples;
    return airfoilPoint(airfoil, x, chord, true, origin);
  });
  const lower = Array.from({ length: samples + 1 }, (_, index) => {
    const x = index / samples;
    return airfoilPoint(airfoil, x, chord, false, origin);
  });
  return [...upper, ...lower, upper[0]];
}

function airfoilPoint(
  airfoil: string,
  x: number,
  chord: number,
  upper: boolean,
  origin: [number, number, number],
): [number, number, number] {
  const digits = airfoil.replace(/\D/g, "");
  const camber = digits.length === 4 ? Number(digits[0]) / 100 : 0.02;
  const camberPosition = digits.length === 4 ? Number(digits[1]) / 10 : 0.4;
  const thickness = digits.length === 4 ? Number(digits.slice(2)) / 100 : 0.12;
  const yt =
    5 *
    thickness *
    (0.2969 * Math.sqrt(x) - 0.126 * x - 0.3516 * x ** 2 + 0.2843 * x ** 3 - 0.1015 * x ** 4);
  let yc = 0;
  let dycDx = 0;
  if (camberPosition > 0 && x < camberPosition) {
    yc = (camber / camberPosition ** 2) * (2 * camberPosition * x - x ** 2);
    dycDx = (2 * camber / camberPosition ** 2) * (camberPosition - x);
  } else if (camberPosition > 0) {
    yc = (camber / (1 - camberPosition) ** 2) * (1 - 2 * camberPosition + 2 * camberPosition * x - x ** 2);
    dycDx = (2 * camber / (1 - camberPosition) ** 2) * (camberPosition - x);
  }
  const theta = Math.atan(dycDx);
  const sign = upper ? 1 : -1;
  return [
    origin[0] + (x - sign * yt * Math.sin(theta)) * chord - chord * 0.25,
    origin[1] + (yc + sign * yt * Math.cos(theta)) * chord,
    origin[2],
  ];
}

function degToRad(value: number) {
  return (value * Math.PI) / 180;
}

function referenceGeometryFromToolArgs(args: Record<string, unknown>): ReferenceGeometry {
  const kind = referenceKindArg(args, "reference_kind");
  const origin = vectorArg(args, "origin", [0, 0, 0]) ?? [0, 0, 0];
  const reference: ReferenceGeometry = {
    kind: "reference",
    id: crypto.randomUUID(),
    name: stringArg(args, "name") ?? `${titleCase(kind)} reference`,
    referenceKind: kind,
    origin,
    normal: vectorArg(args, "normal", kind === "point" || kind === "line" ? undefined : [0, 1, 0]),
    end: vectorArg(args, "end"),
    sizeM: numberArg(args, "size_m", 0.18),
  };
  return reference;
}

function numberArg(args: Record<string, unknown>, key: string, fallback?: number) {
  const value = args[key];
  if (typeof value === "number" && Number.isFinite(value)) return value;
  if (typeof value === "string" && Number.isFinite(Number(value))) return Number(value);
  if (fallback !== undefined) return fallback;
  throw new Error(`AI tool call is missing numeric ${key}`);
}

function stringArg(args: Record<string, unknown>, key: string) {
  const value = args[key];
  return typeof value === "string" && value.trim() ? value.trim() : undefined;
}

function booleanArg(args: Record<string, unknown>, key: string, fallback: boolean) {
  const value = args[key];
  return typeof value === "boolean" ? value : fallback;
}

function vectorArg(args: Record<string, unknown>, key: string, fallback?: [number, number, number]) {
  const value = args[key];
  if (Array.isArray(value) && value.length >= 3) {
    const vector = value.slice(0, 3).map((entry) => (typeof entry === "number" ? entry : Number(entry)));
    if (vector.every(Number.isFinite)) return vector as [number, number, number];
  }
  return fallback;
}

function referenceKindArg(args: Record<string, unknown>, key: string): ReferenceGeometryKind {
  const value = stringArg(args, key);
  if (value === "plane" || value === "point" || value === "line" || value === "face" || value === "surface") {
    return value;
  }
  throw new Error(`AI tool call is missing valid ${key}`);
}

function titleCase(value: string) {
  return `${value.slice(0, 1).toUpperCase()}${value.slice(1)}`;
}

function extractFunctionCalls(payload: unknown): OpenAiToolCall[] {
  const output = isRecord(payload) && Array.isArray(payload.output) ? payload.output : [];
  return output.flatMap((item) => {
    if (!isRecord(item) || item.type !== "function_call" || typeof item.name !== "string") return [];
    if (typeof item.arguments !== "string") return [];
    try {
      const parsed = JSON.parse(item.arguments);
      return isRecord(parsed) ? [{ name: item.name, arguments: parsed }] : [];
    } catch {
      return [];
    }
  });
}

function extractOutputText(payload: unknown) {
  if (isRecord(payload) && typeof payload.output_text === "string" && payload.output_text.trim()) {
    return payload.output_text;
  }
  if (!isRecord(payload) || !Array.isArray(payload.output)) return undefined;
  const text = payload.output
    .flatMap((item) => (isRecord(item) && Array.isArray(item.content) ? item.content : []))
    .flatMap((content) => (isRecord(content) && typeof content.text === "string" ? [content.text] : []))
    .join("");
  return text.trim() || undefined;
}

function extractOpenAiError(payload: unknown) {
  if (!isRecord(payload) || !isRecord(payload.error)) return undefined;
  const message = typeof payload.error.message === "string" ? payload.error.message : undefined;
  const code = typeof payload.error.code === "string" ? payload.error.code : undefined;
  return [code, message].filter(Boolean).join(": ");
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null;
}
