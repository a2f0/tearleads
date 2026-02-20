import { type RefObject, useCallback, useEffect, useRef } from 'react';

/**
 * A hook that provides accessibility features for dialog components:
 * - Focus restoration when dialog closes
 * - Escape key to close
 * - Focus trapping with Tab key
 */
export function useDialogAccessibility(
  dialogRef: RefObject<HTMLDivElement | null>,
  open: boolean,
  isProcessing: boolean,
  onClose: () => void
) {
  const previousActiveElement = useRef<HTMLElement | null>(null);

  useEffect(() => {
    if (open) {
      previousActiveElement.current = document.activeElement as HTMLElement;
    } else {
      previousActiveElement.current?.focus();
    }
  }, [open]);

  const handleKeyDown = useCallback(
    (e: React.KeyboardEvent) => {
      if (e.key === 'Escape' && !isProcessing) {
        onClose();
        return;
      }

      if (e.key === 'Tab') {
        const focusableElements =
          dialogRef.current?.querySelectorAll<HTMLElement>(
            'button:not([disabled]), input:not([disabled]), [tabindex]:not([tabindex="-1"])'
          );
        if (!focusableElements || focusableElements.length === 0) return;

        const firstElement = focusableElements[0];
        const lastElement = focusableElements[focusableElements.length - 1];

        if (!firstElement || !lastElement) return;

        if (e.shiftKey && document.activeElement === firstElement) {
          e.preventDefault();
          lastElement.focus();
        } else if (!e.shiftKey && document.activeElement === lastElement) {
          e.preventDefault();
          firstElement.focus();
        }
      }
    },
    [isProcessing, onClose, dialogRef]
  );

  return { handleKeyDown };
}
