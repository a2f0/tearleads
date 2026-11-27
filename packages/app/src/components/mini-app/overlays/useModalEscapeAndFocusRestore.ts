import { type RefObject, useEffect, useEffectEvent } from "react";

interface ModalEscapeEntry {
  readonly getDialog: () => HTMLElement | null;
  readonly onClose: () => void;
}

const modalEscapeStack: ModalEscapeEntry[] = [];

function findEscapeTarget(): ModalEscapeEntry | undefined {
  const active = document.activeElement;
  if (active instanceof Node) {
    for (let index = modalEscapeStack.length - 1; index >= 0; index -= 1) {
      const entry = modalEscapeStack[index];
      const dialog = entry?.getDialog();
      if (dialog?.contains(active)) {
        return entry;
      }
    }
  }
  return modalEscapeStack[modalEscapeStack.length - 1];
}

function handleDocumentEscape(event: KeyboardEvent): void {
  if (event.key !== "Escape" || event.defaultPrevented) {
    return;
  }
  const target = findEscapeTarget();
  if (!target) {
    return;
  }
  event.preventDefault();
  target.onClose();
}

/**
 * The app's modal dismiss-and-focus contract: close on Escape, move focus to
 * `initialFocusRef` on open, and restore it to the triggering element on close,
 * so keyboard focus is never dropped to the document body.
 *
 * Initial focus is moved imperatively inside `useEffect` (never via `autoFocus`)
 * so `document.activeElement` still points to the triggering control outside
 * the dialog before focus moves, and React `<StrictMode>` mount-cleanup-remount
 * restores and re-applies dialog focus cleanly. Escape routes through a LIFO,
 * focus-aware stack so a background or busy modal never steals Escape from a
 * newer or focused dialog.
 */
export function useModalEscapeAndFocusRestore(
  onClose: () => void,
  initialFocusRef: RefObject<HTMLElement | null>,
): void {
  const close = useEffectEvent(onClose);

  useEffect(() => {
    const entry: ModalEscapeEntry = {
      getDialog: () =>
        initialFocusRef.current?.closest<HTMLElement>(
          '[role="dialog"], [role="alertdialog"]',
        ) ?? null,
      onClose: close,
    };
    if (modalEscapeStack.length === 0) {
      document.addEventListener("keydown", handleDocumentEscape);
    }
    modalEscapeStack.push(entry);
    return () => {
      const index = modalEscapeStack.indexOf(entry);
      if (index !== -1) {
        modalEscapeStack.splice(index, 1);
      }
      if (modalEscapeStack.length === 0) {
        document.removeEventListener("keydown", handleDocumentEscape);
      }
    };
  }, [initialFocusRef]);

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
