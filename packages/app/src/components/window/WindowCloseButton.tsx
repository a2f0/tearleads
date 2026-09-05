import type { RefObject } from "react";

// The floating-window close control (the `×` in the title bar). Shared beyond
// WindowTitleBar so any surface dressing as a window — e.g. the note attachment
// preview — closes with the identical glyph and chrome instead of a look-alike.
// `label` names it for assistive tech; `buttonRef` lets a caller move focus to it.
export function WindowCloseButton({
  buttonRef,
  label,
  onClick,
}: {
  buttonRef?: RefObject<HTMLButtonElement | null>;
  label?: string;
  onClick: () => void;
}) {
  return (
    <button
      type="button"
      className="window-close"
      onClick={onClick}
      ref={buttonRef}
      aria-label={label}
      title={label}
    >
      &times;
    </button>
  );
}
