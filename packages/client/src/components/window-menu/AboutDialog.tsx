import { useCallback, useEffect, useRef } from 'react';
import { createPortal } from 'react-dom';
import { Button } from '@/components/ui/button';
import { zIndex } from '@/constants/zIndex';

interface AboutDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  version: string;
  appName?: string | undefined;
  closeLabel?: string | undefined;
}

export function AboutDialog({
  open,
  onOpenChange,
  version,
  appName = 'Notes',
  closeLabel = 'OK'
}: AboutDialogProps) {
  const dialogRef = useRef<HTMLDivElement>(null);

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
            'a[href]:not([disabled]), button:not([disabled]), textarea:not([disabled]), input:not([disabled]), select:not([disabled]), [tabindex]:not([tabindex="-1"])'
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

  const handleClose = () => {
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
        onClick={handleClose}
        aria-hidden="true"
        data-testid="about-backdrop"
      />
      <div
        ref={dialogRef}
        className="relative w-full max-w-sm rounded-lg border bg-background p-6 shadow-lg"
        style={{ zIndex: zIndex.modal }}
        role="dialog"
        aria-modal="true"
        aria-labelledby="about-title"
        data-testid="about-dialog"
        tabIndex={-1}
        onKeyDown={handleKeyDown}
      >
        <h2 id="about-title" className="font-semibold text-lg">
          About {appName}
        </h2>
        <div className="mt-4 space-y-2">
          <p className="text-muted-foreground text-sm">
            Version: <span data-testid="about-version">{version}</span>
          </p>
        </div>
        <div className="mt-6 flex justify-end">
          <Button onClick={handleClose} data-testid="about-ok">
            {closeLabel}
          </Button>
        </div>
      </div>
    </div>,
    document.body
  );
}
