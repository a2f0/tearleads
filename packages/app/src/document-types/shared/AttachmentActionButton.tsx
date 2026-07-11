import type { ReactNode } from "react";
import "./AttachmentActionButton.css";

// The shared "attach something" control used across document attachment
// surfaces: the structured-document image slots (Upload / Choose Blob / Clear)
// and the note attachments panel (Upload / Select Blob). Centralizing the
// chrome here keeps every attach affordance visually and behaviorally identical
// no matter which document type renders it. Callers supply the label plus an
// optional leading icon via `children`; `ariaLabel` overrides the accessible
// name when the visible text alone is ambiguous (e.g. a per-slot "Clear").
export function AttachmentActionButton({
  ariaLabel,
  children,
  disabled = false,
  label,
  onClick,
  title,
}: {
  ariaLabel?: string | undefined;
  children?: ReactNode;
  disabled?: boolean;
  label: string;
  onClick: () => void;
  title?: string | undefined;
}) {
  return (
    <button
      type="button"
      className="attachment-action-button"
      disabled={disabled}
      onClick={onClick}
      aria-label={ariaLabel}
      title={title}
    >
      {children}
      <span>{label}</span>
    </button>
  );
}
