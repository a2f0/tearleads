import { type RefObject, useEffect, useRef } from "react";

/**
 * The app's modal dismiss-and-focus contract: close on Escape, move focus to
 * the initial focus target on open, and restore it to the triggering element
 * on close, so keyboard focus is never dropped to the document body.
 *
 * `previouslyFocusedRef` captures `document.activeElement` before React commits
 * the dialog DOM (and any `autoFocus` attribute inside it), so focus restoration
 * still returns to the triggering control outside the dialog rather than to an
 * unmounting control inside it.
 */
export function useModalEscapeAndFocusRestore(
  onClose: () => void,
  initialFocusRef?: RefObject<HTMLElement | null> | undefined,
): void {
  const previouslyFocusedRef = useRef<Element | null | undefined>(undefined);
  if (previouslyFocusedRef.current === undefined) {
    previouslyFocusedRef.current =
      typeof document !== "undefined" ? document.activeElement : null;
  }

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
    const previouslyFocused = previouslyFocusedRef.current;
    initialFocusRef?.current?.focus();
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
