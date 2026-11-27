import { type RefObject, useEffect } from "react";

/**
 * The app's modal dismiss-and-focus contract: close on Escape, move focus to
 * `initialFocusRef` on open, and restore it to the triggering element on close,
 * so keyboard focus is never dropped to the document body.
 *
 * Initial focus is moved imperatively inside `useEffect` (never via `autoFocus`)
 * so `document.activeElement` still points to the triggering control outside
 * the dialog before focus moves, and React `<StrictMode>` mount-cleanup-remount
 * restores and re-applies dialog focus cleanly.
 */
export function useModalEscapeAndFocusRestore(
  onClose: () => void,
  initialFocusRef: RefObject<HTMLElement | null>,
): void {
  useEffect(() => {
    function handleKeyDown(event: KeyboardEvent) {
      if (event.key === "Escape" && !event.defaultPrevented) {
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
    initialFocusRef.current?.focus();
    return () => {
      if (
        previouslyFocused instanceof HTMLElement &&
        previouslyFocused.isConnected
      ) {
        previouslyFocused.focus();
      }
    };
  }, [initialFocusRef]);
}
