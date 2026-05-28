import { Box, ChevronDown, ChevronRight, Plane, Trash2 } from "lucide-react";
import type { MouseEvent, ReactNode } from "react";
import type { CadObject, ReferenceGeometry, WingObject } from "../../types";
import type { BrowserGroupId } from "../../app/types";
import type { Wing } from "../../types";
import { BrowserItemActions } from "./BrowserItemActions";
import { formatLength, type DisplayUnit } from "./units";
import { Crosshair } from "lucide-react";
export function BrowserSection({
  children,
  count,
  expanded,
  hidden,
  id,
  onDelete,
  onContextMenu,
  onSelect,
  onToggleVisibility,
  selected,
  title,
}: {
  children: React.ReactNode;
  count: number;
  expanded: boolean;
  hidden: boolean;
  id: string;
  onDelete: (event: React.MouseEvent) => void;
  onContextMenu: (event: React.MouseEvent) => void;
  onSelect: () => void;
  onToggleVisibility: (event: React.MouseEvent) => void;
  selected: boolean;
  title: string;
}) {
  return (
    <section className="browser-section">
      <div
        className={`browser-section-title selectable ${selected ? "selected" : ""} ${hidden ? "muted" : ""}`}
        onClick={onSelect}
        onContextMenu={onContextMenu}
        role="button"
        tabIndex={0}
        aria-controls={`${id}-contents`}
        aria-expanded={expanded}
        onKeyDown={(event) => {
          if (event.key === "Enter" || event.key === " ") {
            event.preventDefault();
            onSelect();
          }
        }}
      >
        <span className="browser-section-label">
          {expanded ? <ChevronDown size={14} /> : <ChevronRight size={14} />}
          {title}
        </span>
        <div className="browser-section-meta">
          <strong>{count}</strong>
          <BrowserItemActions
            hidden={hidden}
            canDelete={count > 0 && id !== "origin"}
            onDelete={onDelete}
            onToggleVisibility={onToggleVisibility}
          />
        </div>
      </div>
      {expanded ? (
        <div className="object-list" id={`${id}-contents`}>
          {count === 0 ? <p className="empty-text compact">Empty</p> : children}
        </div>
      ) : null}
    </section>
  );
}

export function ObjectRow({
  hidden,
  object,
  onDelete,
  onContextMenu,
  onSelect,
  onToggleVisibility,
  precision,
  selected,
  unit,
}: {
  hidden: boolean;
  object: CadObject;
  onDelete: (event: React.MouseEvent) => void;
  onContextMenu: (event: React.MouseEvent) => void;
  onSelect: () => void;
  onToggleVisibility: (event: React.MouseEvent) => void;
  precision: number;
  selected: boolean;
  unit: DisplayUnit;
}) {
  if (object.kind === "wing") {
    return (
      <WingObject
        wing={object}
        precision={precision}
        unit={unit}
        selected={selected}
        hidden={hidden}
        onSelect={onSelect}
        onContextMenu={onContextMenu}
        onDelete={onDelete}
        onToggleVisibility={onToggleVisibility}
      />
    );
  }
  if (object.kind === "reference") {
    return (
      <ReferenceObject
        reference={object}
        selected={selected}
        hidden={hidden}
        onSelect={onSelect}
        onContextMenu={onContextMenu}
        onDelete={onDelete}
        onToggleVisibility={onToggleVisibility}
      />
    );
  }
  return (
    <div
      className={`object-row selectable ${selected ? "selected" : ""} ${hidden ? "muted" : ""}`}
      onClick={onSelect}
      onContextMenu={onContextMenu}
      role="button"
      tabIndex={0}
    >
      <Box size={17} />
      <div>
        <strong>{object.name}</strong>
        <span>{object.triangleCount} mesh triangles</span>
      </div>
      <BrowserItemActions
        hidden={hidden}
        canDelete
        onDelete={onDelete}
        onToggleVisibility={onToggleVisibility}
      />
    </div>
  );
}

export function WingObject({
  hidden,
  onDelete,
  onContextMenu,
  onSelect,
  onToggleVisibility,
  precision,
  selected,
  unit,
  wing,
}: {
  hidden: boolean;
  onDelete: (event: React.MouseEvent) => void;
  onContextMenu: (event: React.MouseEvent) => void;
  onSelect: () => void;
  onToggleVisibility: (event: React.MouseEvent) => void;
  precision: number;
  selected: boolean;
  unit: DisplayUnit;
  wing: Wing;
}) {
  return (
    <div
      className={`object-row selectable ${selected ? "selected" : ""} ${hidden ? "muted" : ""}`}
      onClick={onSelect}
      onContextMenu={onContextMenu}
      role="button"
      tabIndex={0}
    >
      <Plane size={17} />
      <div>
        <strong>{wing.name}</strong>
        <span>
          {formatLength(wing.spanM, unit, precision)} span, {wing.airfoil}
        </span>
      </div>
      <BrowserItemActions
        hidden={hidden}
        canDelete
        onDelete={onDelete}
        onToggleVisibility={onToggleVisibility}
      />
    </div>
  );
}

export function ReferenceObject({
  hidden,
  onDelete,
  onContextMenu,
  onSelect,
  onToggleVisibility,
  reference,
  selected,
}: {
  hidden: boolean;
  onDelete: (event: React.MouseEvent) => void;
  onContextMenu: (event: React.MouseEvent) => void;
  onSelect: () => void;
  onToggleVisibility: (event: React.MouseEvent) => void;
  reference: ReferenceGeometry;
  selected: boolean;
}) {
  return (
    <div
      className={`object-row selectable ${selected ? "selected" : ""} ${hidden ? "muted" : ""}`}
      onClick={onSelect}
      onContextMenu={onContextMenu}
      role="button"
      tabIndex={0}
    >
      <Crosshair size={17} />
      <div>
        <strong>{reference.name}</strong>
        <span>{reference.cadRole ? reference.cadRole.replace(/_/g, " ") : `${reference.referenceKind} reference`}</span>
      </div>
      <BrowserItemActions
        hidden={hidden}
        canDelete
        onDelete={onDelete}
        onToggleVisibility={onToggleVisibility}
      />
    </div>
  );
}
