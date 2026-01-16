import { useCallback, useEffect, useRef, useState } from 'react';
import { Button } from '@/components/ui/button';

export interface ConfirmDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  title: string;
  description: React.ReactNode;
  confirmLabel?: string;
  cancelLabel?: string;
  confirmingLabel?: string;
  onConfirm: () => Promise<void>;
  variant?: 'default' | 'destructive';
}

export function ConfirmDialog({
  open,
  onOpenChange,
  title,
  description,
  confirmLabel = 'Confirm',
  cancelLabel = 'Cancel',
  confirmingLabel = 'Confirming...',
  onConfirm,
  variant = 'destructive'
}: ConfirmDialogProps) {
  const [isConfirming, setIsConfirming] = useState(false);
  const isMountedRef = useRef(true);
  const dialogRef = useRef<HTMLDivElement>(null);
  const previousActiveElement = useRef<HTMLElement | null>(null);

  useEffect(() => {
    return () => {
      isMountedRef.current = false;
    };
  }, []);

  useEffect(() => {
    if (open) {
      previousActiveElement.current = document.activeElement as HTMLElement;
      dialogRef.current?.focus();
    } else {
      previousActiveElement.current?.focus();
    }
  }, [open]);

  const handleKeyDown = useCallback(
    (e: React.KeyboardEvent) => {
      if (e.key === 'Escape' && !isConfirming) {
        onOpenChange(false);
        return;
      }

      if (e.key === 'Tab') {
        const focusableElements =
          dialogRef.current?.querySelectorAll<HTMLElement>(
            'button:not([disabled]), [href], input:not([disabled]), select:not([disabled]), textarea:not([disabled]), [tabindex]:not([tabindex="-1"])'
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
    [isConfirming, onOpenChange]
  );

  const handleConfirm = async () => {
    setIsConfirming(true);
    try {
      await onConfirm();
      if (isMountedRef.current) {
        onOpenChange(false);
      }
    } catch (_error) {
      if (isMountedRef.current) {
        setIsConfirming(false);
      }
    }
  };

  const handleCancel = () => {
    if (isConfirming) return;
    onOpenChange(false);
  };

  if (!open) return null;

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center">
      <div
        className="fixed inset-0 bg-black/50 backdrop-blur-sm"
        onClick={handleCancel}
        aria-hidden="true"
        data-testid="confirm-dialog-backdrop"
      />
      <div
        ref={dialogRef}
        className="relative z-10 w-full max-w-md rounded-lg border bg-background p-6 shadow-lg"
        role="dialog"
        aria-modal="true"
        aria-labelledby="confirm-dialog-title"
        data-testid="confirm-dialog"
        tabIndex={-1}
        onKeyDown={handleKeyDown}
      >
        <h2 id="confirm-dialog-title" className="font-semibold text-lg">
          {title}
        </h2>
        <div className="mt-2 text-muted-foreground text-sm">{description}</div>
        <div className="mt-6 flex justify-end gap-3">
          <Button
            variant="outline"
            onClick={handleCancel}
            disabled={isConfirming}
            data-testid="confirm-dialog-cancel"
          >
            {cancelLabel}
          </Button>
          <Button
            variant={variant}
            onClick={handleConfirm}
            disabled={isConfirming}
            data-testid="confirm-dialog-confirm"
          >
            {isConfirming ? confirmingLabel : confirmLabel}
          </Button>
        </div>
      </div>
    </div>
  );
}
