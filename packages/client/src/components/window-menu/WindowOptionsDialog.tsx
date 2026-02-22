import { useCallback, useEffect, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import { Button } from '@/components/ui/button';
import { zIndex } from '@/constants/zIndex';

interface WindowOptionsDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  preserveWindowState: boolean;
  onSave: (preserveWindowState: boolean) => void;
}

export function WindowOptionsDialog({
  open,
  onOpenChange,
  preserveWindowState,
  onSave
}: WindowOptionsDialogProps) {
  const [selectedOption, setSelectedOption] = useState(preserveWindowState);
  const dialogRef = useRef<HTMLDivElement>(null);

  // biome-ignore lint/correctness/useExhaustiveDependencies: Only sync prop to state when dialog opens, not on prop changes while open
  useEffect(() => {
    if (open) {
      setSelectedOption(preserveWindowState);
    }
  }, [open]);

  useEffect(() => {
    if (!open) {
      return;
    }

    const previouslyFocused = document.activeElement as HTMLElement;
    dialogRef.current?.focus();

    return () => {
      previouslyFocused?.focus();
    };
  }, [open]);

  const handleKeyDown = useCallback(
    (e: React.KeyboardEvent) => {
      if (e.key === 'Escape') {
        onOpenChange(false);
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
    [onOpenChange]
  );

  const handleOk = () => {
    onSave(selectedOption);
    onOpenChange(false);
  };

  const handleCancel = () => {
    onOpenChange(false);
  };

  if (!open) return null;

  return createPortal(
    // biome-ignore lint/a11y/noStaticElementInteractions: stopPropagation prevents dropdown close
    <div
      className="fixed inset-0 flex items-center justify-center"
      style={{ zIndex: zIndex.modalBackdrop }}
      onMouseDown={(e) => e.stopPropagation()}
    >
      <div
        className="absolute inset-0 bg-black/50"
        onClick={handleCancel}
        aria-hidden="true"
        data-testid="window-options-backdrop"
      />
      <div
        ref={dialogRef}
        className="relative w-full max-w-sm rounded-lg border bg-background p-6 shadow-lg"
        style={{ zIndex: zIndex.modal }}
        role="dialog"
        aria-modal="true"
        aria-labelledby="window-options-title"
        data-testid="window-options-dialog"
        tabIndex={-1}
        onKeyDown={handleKeyDown}
      >
        <h2 id="window-options-title" className="font-semibold text-lg">
          Window Options
        </h2>
        <div className="mt-4 space-y-3">
          <label className="flex cursor-pointer items-center gap-3">
            <input
              type="radio"
              name="windowState"
              checked={selectedOption}
              onChange={() => setSelectedOption(true)}
              className="h-4 w-4"
              data-testid="window-state-preserve-radio"
            />
            <span className="text-sm">Preserve window state</span>
          </label>
          <label className="flex cursor-pointer items-center gap-3">
            <input
              type="radio"
              name="windowState"
              checked={!selectedOption}
              onChange={() => setSelectedOption(false)}
              className="h-4 w-4"
              data-testid="window-state-default-radio"
            />
            <span className="text-sm">Use default window state</span>
          </label>
        </div>
        <div className="mt-6 flex justify-end gap-3">
          <Button
            variant="outline"
            onClick={handleCancel}
            data-testid="window-options-cancel"
          >
            Cancel
          </Button>
          <Button onClick={handleOk} data-testid="window-options-ok">
            OK
          </Button>
        </div>
      </div>
    </div>,
    document.body
  );
}
