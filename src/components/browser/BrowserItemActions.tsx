import { Eye, EyeOff, Trash2 } from "lucide-react";
import type { MouseEvent } from "react";

export function BrowserItemActions({
  canDelete,
  hidden,
  onDelete,
  onToggleVisibility,
}: {
  canDelete: boolean;
  hidden: boolean;
  onDelete: (event: MouseEvent) => void;
  onToggleVisibility: (event: MouseEvent) => void;
}) {
  return (
    <div className="browser-item-actions" onClick={(event) => event.stopPropagation()}>
      <button
        type="button"
        className="browser-icon-button"
        onClick={onToggleVisibility}
        aria-label={hidden ? "Show" : "Hide"}
        title={hidden ? "Show" : "Hide"}
      >
        {hidden ? <EyeOff size={15} /> : <Eye size={15} />}
      </button>
      <button
        type="button"
        className="browser-icon-button danger"
        disabled={!canDelete}
        onClick={onDelete}
        aria-label="Delete"
        title={canDelete ? "Delete" : "Cannot delete"}
      >
        <Trash2 size={15} />
      </button>
    </div>
  );
}
