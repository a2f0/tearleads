import { type RefObject, useEffect } from "react";

/**
 * The app's modal dismiss-and-focus contract: close on Escape, move focus to
 * the close button on open, and restore it to the triggering element on close,
 * so keyboard focus is never dropped to the document body. The active element
 * is narrowed with instanceof (not a cast) so `.focus()` is only called on
 * something that actually has it.
 */
export function useModalEscapeAndFocusRestore(
  onClose: () => void,
  closeButtonRef: RefObject<HTMLButtonElement | null>,
): void {
  useEffect(() => {
    function handleKeyDown(event: KeyboardEvent) {
      if (event.key === "Escape") {
        event.preventDefault();
        onClose();
      }
    }
    document.addEventListener("keydown", handleKeyDown);
    return () => {
      document.removeEventListener("keydown", handleKeyDown);
    };
  }, [onClose]);

  useEffect(() => {
    const previouslyFocused = document.activeElement;
    closeButtonRef.current?.focus();
    return () => {
      if (previouslyFocused instanceof HTMLElement) {
        previouslyFocused.focus();
      }
    };
  }, [closeButtonRef]);
}
