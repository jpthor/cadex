import type { ReactNode } from "react";

export function Metric({
  info,
  label,
  note,
  noteTone = "neutral",
  value,
  verification,
}: {
  info?: string;
  label: string;
  note?: string;
  noteTone?: "good" | "caution" | "bad" | "neutral";
  value: string;
  verification?: string;
}) {
  return (
    <div className="analysis-metric">
      <span className={`metric-label ${info ? "has-info" : ""}`} data-info={info}>
        <span>{label}</span>
        {info ? <span className="metric-tooltip">{info}</span> : null}
        {note ? <small className={`metric-note ${noteTone}`}>{note}</small> : null}
        {verification ? <small>{verification}</small> : null}
      </span>
      <strong>{value}</strong>
    </div>
  );
}

export function MetricTile({ info, label, value }: { info?: string; label: string; value: string }) {
  return (
    <div className="metric-tile">
      <span className={`metric-label ${info ? "has-info" : ""}`} data-info={info}>
        <span>{label}</span>
        {info ? <span className="metric-tooltip">{info}</span> : null}
      </span>
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
