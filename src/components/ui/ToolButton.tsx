import type { ReactNode } from "react";

export function ToolButton({
  active,
  label,
  onClick,
  children,
}: {
  active: boolean;
  label: string;
  onClick: () => void;
  children: React.ReactNode;
}) {
  return (
    <button className={`tool-button ${active ? "active" : ""}`} onClick={onClick} title={label} aria-label={label}>
      {children}
    </button>
  );
}
