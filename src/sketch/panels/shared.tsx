import type { ReactNode } from "react";
export function SketchPanelTitle({ icon, title }: { icon: ReactNode; title: string }) {
  return (
    <h2 className="panel-title">
      {icon}
      {title}
    </h2>
  );
}

export function NumberField({
  label,
  suffix,
  value,
  step = 0.01,
  onChange,
}: {
  label: string;
  suffix: string;
  value: number;
  step?: number;
  onChange: (value: number) => void;
}) {
  return (
    <label className="sizing-field">
      <span>{label}</span>
      <div>
        <input
          type="number"
          step={step}
          value={Number.isFinite(value) ? value : 0}
          onChange={(event) => onChange(Number(event.target.value))}
        />
        {suffix ? <em>{suffix}</em> : null}
      </div>
    </label>
  );
}

export function Metric({ label, value }: { label: string; value: string }) {
  return (
    <div className="analysis-metric">
      <span>{label}</span>
      <strong>{value}</strong>
    </div>
  );
}
