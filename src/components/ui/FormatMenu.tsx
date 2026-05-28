import { ChevronDown } from "lucide-react";
import { useEffect, useRef, useState } from "react";
import type { ReactNode } from "react";
import type { GeometryFormat } from "../../types";

export function FormatMenu({
  ariaLabel,
  icon,
  label,
  onPick,
}: {
  ariaLabel: string;
  icon: React.ReactNode;
  label: string;
  onPick: (format: GeometryFormat) => void;
}) {
  const [open, setOpen] = useState(false);
  const containerRef = useRef<HTMLDivElement | null>(null);

  useEffect(() => {
    if (!open) return;
    const closeOnOutside = (event: PointerEvent) => {
      if (!containerRef.current?.contains(event.target as Node)) setOpen(false);
    };
    const closeOnEscape = (event: KeyboardEvent) => {
      if (event.key === "Escape") setOpen(false);
    };
    window.addEventListener("pointerdown", closeOnOutside);
    window.addEventListener("keydown", closeOnEscape);
    return () => {
      window.removeEventListener("pointerdown", closeOnOutside);
      window.removeEventListener("keydown", closeOnEscape);
    };
  }, [open]);

  function pick(format: GeometryFormat) {
    setOpen(false);
    onPick(format);
  }

  return (
    <div className="format-menu" ref={containerRef}>
      <button
        className={`command-button ${open ? "active" : ""}`}
        aria-label={ariaLabel}
        aria-haspopup="menu"
        aria-expanded={open}
        onClick={() => setOpen((value) => !value)}
      >
        {icon}
        {label}
      </button>
      {open ? (
        <div className="format-menu-options" role="menu">
          <button role="menuitem" onClick={() => pick("stl")}>
            STL
          </button>
          <button role="menuitem" onClick={() => pick("step")}>
            STEP
          </button>
        </div>
      ) : null}
    </div>
  );
}
