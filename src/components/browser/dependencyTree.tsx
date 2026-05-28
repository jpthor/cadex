import { Box, ChevronRight, Crosshair, FolderTree, Orbit, Plane } from "lucide-react";
import { useMemo, useState } from "react";
import type { CadObject } from "../../types";
import type { BrowserGroupId } from "../../app/types";
import { PanelTitle } from "../ui/PanelTitle";
import { BrowserItemActions } from "./BrowserItemActions";

export type DependencyTreeNode = {
  id: string;
  label: string;
  level: number;
  meta: string;
  dependencyIds: string[];
};
export function DependencyTreeView({
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

export function DependencyTreeNodeView({
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

export function DependencyIcon({ id, object }: { id: string; object?: CadObject }) {
  if (id === "root" || id === "origin") return <Crosshair size={14} />;
  if (!object) return <ChevronRight size={14} />;
  if (object.kind === "wing" || object.kind === "solid" || object.kind === "mesh") return <Box size={14} />;
  if (object.referenceKind === "plane") return <Plane size={14} />;
  if (object.referenceKind === "surface" || object.referenceKind === "face") return <Orbit size={14} />;
  return <Crosshair size={14} />;
}

export function buildDependencyLevels(objects: CadObject[]): DependencyTreeNode[][] {
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

export function directDependencyIds(object: CadObject, objects: CadObject[]) {
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

export function normalizeDependencyIds(ids: string[]) {
  return [...new Set(ids)];
}

export function compareDependencyNodes(a: DependencyTreeNode, b: DependencyTreeNode) {
  return a.level - b.level || a.label.localeCompare(b.label);
}

export function isVirtualDependencyNode(id: string, objectMap: Map<string, CadObject>) {
  return id === "origin" || (id.startsWith("origin-plane-") && !objectMap.has(id));
}

export function virtualDependencyLabel(id: string) {
  if (id === "origin") return "Origin";
  return `${id.replace("origin-plane-", "").toUpperCase()} origin plane`;
}

export function dependencyMeta(object: CadObject) {
  if (object.kind === "wing") return `body · profile ${object.airfoil}`;
  if (object.kind === "solid") return `solid · ${object.source}`;
  if (object.kind === "mesh") return `mesh · ${object.triangleCount} triangles`;
  return object.operation ?? object.cadRole?.replace(/_/g, " ") ?? `${object.referenceKind} reference`;
}

export function dependencyLabel(id: string, objectMap: Map<string, CadObject>) {
  if (id === "origin") return "Origin";
  return objectMap.get(id)?.name ?? id;
}

export function dependencyTitle(node: DependencyTreeNode, objectMap: Map<string, CadObject>) {
  const dependencies = node.dependencyIds.map((id) => dependencyLabel(id, objectMap));
  const parts = [node.label, node.meta];
  if (dependencies.length > 0) parts.push(`Depends on: ${dependencies.join(", ")}`);
  return parts.filter(Boolean).join("\n");
}
