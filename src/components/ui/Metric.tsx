import type { ReactNode } from "react";

export function Metric({ label, value }: { label: string; value: string }) {
  return (
    <div className="analysis-metric">
      <span>{label}</span>
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
