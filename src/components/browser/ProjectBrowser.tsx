import { Box, Eye, EyeOff, FolderTree, Trash2, Crosshair } from "lucide-react";
import { useEffect, useMemo, useState } from "react";
import type { CadObject, ReferenceGeometry, SelectedGeometry } from "../../types";
import { BrowserItemActions } from "./BrowserItemActions";
import type { BrowserContextTarget, BrowserGroupId } from "../../app/types";
import { PanelTitle } from "../ui/PanelTitle";
import { unitOptions } from "../../app/constants";
import { browserGroupIdForObject, isObjectHidden } from "./browserSelection";
import { BrowserSection, ObjectRow, ReferenceObject, WingObject } from "./browserSections";
import { DependencyTreeView } from "./dependencyTree";
import { SelectionTable } from "./SelectionTable";
import { formatLength, toDisplayUnit, type DisplayUnit } from "./units";
export function ProjectBrowser({
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
