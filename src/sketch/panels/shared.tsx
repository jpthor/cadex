import { useEffect, useState, type ReactNode } from "react";
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
  const [draftValue, setDraftValue] = useState(formatNumberInputValue(value));
  const [focused, setFocused] = useState(false);

  useEffect(() => {
    if (!focused) setDraftValue(formatNumberInputValue(value));
  }, [focused, value]);

  function commitDraft(nextDraftValue = draftValue) {
    if (!isCompleteNumberInput(nextDraftValue)) {
      setDraftValue(formatNumberInputValue(value));
      return;
    }
    const nextValue = Number(nextDraftValue);
    onChange(nextValue);
    setDraftValue(formatNumberInputValue(nextValue));
  }

  return (
    <label className="sizing-field">
      <span>{label}</span>
      <div>
        <input
          inputMode="decimal"
          step={step}
          type="text"
          value={draftValue}
          onBlur={() => {
            setFocused(false);
            commitDraft();
          }}
          onChange={(event) => {
            const nextDraftValue = event.target.value;
            setDraftValue(nextDraftValue);
            if (isCompleteNumberInput(nextDraftValue)) onChange(Number(nextDraftValue));
          }}
          onFocus={() => setFocused(true)}
          onKeyDown={(event) => {
            if (event.key === "Enter") {
              event.currentTarget.blur();
            }
          }}
        />
        {suffix ? <em>{suffix}</em> : null}
      </div>
    </label>
  );
}

function formatNumberInputValue(value: number) {
  return Number.isFinite(value) ? String(value) : "0";
}

function isCompleteNumberInput(value: string) {
  const trimmed = value.trim();
  if (!trimmed || trimmed === "-" || trimmed === "+" || trimmed === "." || trimmed === "-." || trimmed === "+.") return false;
  return Number.isFinite(Number(trimmed));
}

export function Metric({ label, value }: { label: string; value: string }) {
  return (
    <div className="analysis-metric">
      <span>{label}</span>
      <strong>{value}</strong>
    </div>
  );
}
