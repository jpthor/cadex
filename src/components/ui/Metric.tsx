import type { ReactNode } from "react";

export function Metric({
  label,
  note,
  noteTone = "neutral",
  value,
  verification,
}: {
  label: string;
  note?: string;
  noteTone?: "good" | "caution" | "bad" | "neutral";
  value: string;
  verification?: string;
}) {
  return (
    <div className="analysis-metric">
      <span>
        {label}
        {note ? <small className={`metric-note ${noteTone}`}>{note}</small> : null}
        {verification ? <small>{verification}</small> : null}
      </span>
      <strong>{value}</strong>
    </div>
  );
}

export function MetricTile({ label, value }: { label: string; value: string }) {
  return (
    <div className="metric-tile">
      <span>{label}</span>
      <strong>{value}</strong>
    </div>
  );
}

export function ResultGroup({ children, title }: { children: ReactNode; title: string }) {
  return (
    <section className="result-group">
      <h3>{title}</h3>
      {children}
    </section>
  );
}
