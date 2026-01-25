import { useCallback, useEffect, useRef, useState } from 'react';
import { Button } from '@/components/ui/button';

export interface WindowStateSettingsDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  preserveWindowState: boolean;
  onSave: (preserveWindowState: boolean) => void;
}

export function WindowStateSettingsDialog({
  open,
  onOpenChange,
  preserveWindowState,
  onSave
}: WindowStateSettingsDialogProps) {
  const [selectedOption, setSelectedOption] = useState(preserveWindowState);
  const dialogRef = useRef<HTMLDivElement>(null);
  const previousActiveElement = useRef<HTMLElement | null>(null);

  useEffect(() => {
    if (open) {
      setSelectedOption(preserveWindowState);
      previousActiveElement.current = document.activeElement as HTMLElement;
      dialogRef.current?.focus();
    } else {
      previousActiveElement.current?.focus();
    }
  }, [open, preserveWindowState]);

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

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center">
      <div
        className="fixed inset-0 bg-black/50 backdrop-blur-sm"
        onClick={handleCancel}
        aria-hidden="true"
        data-testid="window-state-settings-backdrop"
      />
      <div
        ref={dialogRef}
        className="relative z-10 w-full max-w-sm rounded-lg border bg-background p-6 shadow-lg"
        role="dialog"
        aria-modal="true"
        aria-labelledby="window-state-settings-title"
        data-testid="window-state-settings-dialog"
        tabIndex={-1}
        onKeyDown={handleKeyDown}
      >
        <h2 id="window-state-settings-title" className="font-semibold text-lg">
          Window State Settings
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
            data-testid="window-state-settings-cancel"
          >
            Cancel
          </Button>
          <Button onClick={handleOk} data-testid="window-state-settings-ok">
            OK
          </Button>
        </div>
      </div>
    </div>
  );
}
