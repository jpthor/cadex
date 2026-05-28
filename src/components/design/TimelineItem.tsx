import type { TimelineEvent } from "../../types";

export function TimelineItem({
  active,
  event,
  index,
  onSelect,
}: {
  active: boolean;
  event: TimelineEvent;
  index: number;
  onSelect: () => void;
}) {
  return (
    <button
      className={`timeline-item ${active ? "active" : ""}`}
      onClick={onSelect}
      title={`${event.label}\n${event.detail}`}
      aria-label={`${event.label}: ${event.detail}`}
      aria-pressed={active}
    >
      <span>{index + 1}</span>
    </button>
  );
}
