import { ChevronDown, Trash2 } from "lucide-react";
import { useEffect, useState } from "react";
import type { AircraftProjectEntry } from "../../app/types";

export function ProjectMenu({
  activeProject,
  currentName,
  open,
  projects,
  onCreate,
  onDelete,
  onOpenChange,
  onSelect,
}: {
  activeProject?: AircraftProjectEntry;
  currentName: string;
  open: boolean;
  projects: AircraftProjectEntry[];
  onCreate: (name: string) => void;
  onDelete: (id: string) => void;
  onOpenChange: (open: boolean) => void;
  onSelect: (id: string) => void;
}) {
  const label = activeProject?.name ?? currentName;
  const [draftName, setDraftName] = useState(currentName === "Untitled part" ? "Untitled aircraft" : currentName);
  const [confirmDeleteId, setConfirmDeleteId] = useState("");

  useEffect(() => {
    if (open) setDraftName((current) => current.trim() || (currentName === "Untitled part" ? "Untitled aircraft" : currentName));
  }, [currentName, open]);

  return (
    <div className="project-menu">
      <button
        className={`project-menu-button ${open ? "active" : ""}`}
        onClick={() => onOpenChange(!open)}
        type="button"
      >
        <span>Project</span>
        <strong>{label}</strong>
        <ChevronDown size={15} />
      </button>
      {open ? (
        <div className="project-menu-popover">
          <form
            className="project-menu-create-form"
            onSubmit={(event) => {
              event.preventDefault();
              onCreate(draftName);
            }}
          >
            <input
              aria-label="Aircraft project name"
              onChange={(event) => setDraftName(event.target.value)}
              placeholder="Aircraft project name"
              value={draftName}
            />
            <button className="project-menu-create" disabled={!draftName.trim()} type="submit">
              Create
            </button>
          </form>
          <div className="project-menu-list">
            {projects.length ? (
              projects.map((entry) => (
                <div className={`project-menu-item ${entry.id === activeProject?.id ? "active" : ""}`} key={entry.id}>
                  <button
                    className="project-menu-select"
                    onClick={() => onSelect(entry.id)}
                    type="button"
                  >
                    <strong>{entry.name}</strong>
                    <span>{entry.path}</span>
                  </button>
                  {confirmDeleteId === entry.id ? (
                    <div className="project-menu-confirm">
                      <button
                        className="project-menu-delete-confirm"
                        onClick={() => {
                          onDelete(entry.id);
                          setConfirmDeleteId("");
                        }}
                        type="button"
                      >
                        Delete
                      </button>
                      <button className="project-menu-cancel-delete" onClick={() => setConfirmDeleteId("")} type="button">
                        Cancel
                      </button>
                    </div>
                  ) : (
                    <button
                      aria-label={`Delete ${entry.name}`}
                      className="project-menu-trash"
                      onClick={(event) => {
                        event.stopPropagation();
                        setConfirmDeleteId(entry.id);
                      }}
                      title={`Delete ${entry.name}`}
                      type="button"
                    >
                      <Trash2 size={15} />
                    </button>
                  )}
                </div>
              ))
            ) : (
              <p>No saved aircraft projects yet.</p>
            )}
          </div>
        </div>
      ) : null}
    </div>
  );
}
