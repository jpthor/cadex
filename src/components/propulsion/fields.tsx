import { useEffect, useState } from "react";

export function PropulsionNumberField({
  label,
  suffix,
  step,
  value,
  onChange,
}: {
  label: string;
  suffix?: string;
  step: number;
  value: number;
  onChange: (value: number) => void;
}) {
  const [draftValue, setDraftValue] = useState(formatNumberInputValue(value));
  const [isEditing, setIsEditing] = useState(false);

  useEffect(() => {
    if (!isEditing) setDraftValue(formatNumberInputValue(value));
  }, [isEditing, value]);

  return (
    <label className="propulsion-field">
      <span>{label}</span>
      <div>
        <input
          type="number"
          step={step}
          value={draftValue}
          onBlur={() => {
            setIsEditing(false);
            if (draftValue.trim() === "") {
              setDraftValue(formatNumberInputValue(value));
              return;
            }
            const nextValue = Number(draftValue);
            if (Number.isFinite(nextValue)) onChange(nextValue);
          }}
          onChange={(event) => {
            const nextDraftValue = event.target.value;
            setDraftValue(nextDraftValue);
            if (nextDraftValue.trim() === "") return;
            const nextValue = Number(nextDraftValue);
            if (Number.isFinite(nextValue)) onChange(nextValue);
          }}
          onFocus={() => setIsEditing(true)}
        />
        {suffix ? <em>{suffix}</em> : null}
      </div>
    </label>
  );
}

function formatNumberInputValue(value: number) {
  return Number.isFinite(value) ? String(value) : "0";
}
