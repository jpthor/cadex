export type CadProject = {
  id: string;
  name: string;
  units: string;
  objects: CadObject[];
  timeline: TimelineEvent[];
  sizing?: unknown;
};

export type CadObject = WingObject | MeshObject | SolidObject | ReferenceGeometry;

export type SolidObject = {
  kind: "solid";
  id: string;
  name: string;
  source: string;
  kernelHandle: string;
  triangleCount: number;
  positions: number[];
  normals: number[];
  parentId?: string;
  dependsOn?: string[];
};

export type WingObject = {
  kind: "wing";
} & Wing;

export type MeshObject = {
  kind: "mesh";
  id: string;
  name: string;
  source: string;
  triangleCount: number;
  positions: number[];
  normals: number[];
  parentId?: string;
  dependsOn?: string[];
};

export type ReferenceGeometryKind = "plane" | "point" | "line" | "face" | "surface";

export type ReferenceGeometry = {
  kind: "reference";
  id: string;
  name: string;
  referenceKind: ReferenceGeometryKind;
  origin: Vector3Tuple;
  normal?: Vector3Tuple;
  end?: Vector3Tuple;
  points?: Vector3Tuple[];
  sizeM?: number;
  cadRole?: string;
  operation?: string;
  parentId?: string;
  dependsOn?: string[];
  sourceSelection?: SelectedGeometry;
};

export type Vector3Tuple = [number, number, number];

export type SelectedGeometryType = "plane" | "point" | "line" | "face" | "surface" | "body";

export type SelectedGeometry = {
  type: SelectedGeometryType;
  objectId?: string;
  objectName?: string;
  position: Vector3Tuple;
  normal?: Vector3Tuple;
  polygon?: Vector3Tuple[];
  start?: Vector3Tuple;
  end?: Vector3Tuple;
  description: string;
};

export type Wing = {
  id: string;
  name: string;
  spanM: number;
  rootChordM: number;
  tipChordM: number;
  sweepDeg: number;
  dihedralDeg: number;
  twistDeg: number;
  airfoil: string;
  symmetry: boolean;
  rootAtOrigin?: boolean;
  orientationPlane?: "XZ";
  parentId?: string;
  dependsOn?: string[];
};

export type TimelineEvent = {
  id: string;
  label: string;
  detail: string;
};

export type ToolMode = "select" | "pan" | "orbit" | "zoom";

export type GeometryFormat = "stl" | "step";
