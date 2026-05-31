import type * as THREE from "three";
import type { CadProject } from "../types";
import type { SizingProject } from "../sizing";
import type { unitOptions } from "./constants";

export type DisplayUnit = (typeof unitOptions)[number];
export type AppMode = "sizing" | "sketch" | "compute" | "openfoam" | "paraview" | "propulsion" | "jet" | "endurance" | "ijet" | "final" | "max" | "design";

export type OpenVspSizingResult = {
  scriptPath: string;
  vsp3Path: string;
  ranOpenvsp: boolean;
  message: string;
  stdout: string;
  stderr: string;
};

export type BrowserContextTarget = {
  canDelete?: boolean;
  canHide?: boolean;
  groupId?: BrowserGroupId;
  id: string;
  label: string;
  objectId?: string;
};

export type BrowserGroupId =
  | "project"
  | "section:bodies"
  | "section:surfaces"
  | "section:sketches"
  | "section:planes"
  | "origin";

export type CursorPlane = {
  label: string;
  normal: THREE.Vector3;
  point: THREE.Vector3;
};

export type AircraftProjectEntry = {
  id: string;
  name: string;
  path: string;
  updatedAtMs: number;
};

export type PropulsionTabState = {
  selectedBatteryId: string;
  selectedMotorId: string;
  selectedPropellerId: string;
  targetEnduranceMin: number;
  targetThrustToWeight: number;
};

export type AircraftMasterState = {
  id?: string;
  name: string;
  schemaVersion: number;
  updatedAt?: number;
  project: CadProject;
  sizing: SizingProject;
  propulsion: PropulsionTabState;
};

export type DependencyTreeNode = {
  id: string;
  label: string;
  children: DependencyTreeNode[];
};
