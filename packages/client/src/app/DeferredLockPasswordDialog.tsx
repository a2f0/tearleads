import { handleDialogTabTrap } from '@tearleads/shared';
import { useCallback, useEffect, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { zIndex } from '@/constants/zIndex';

interface DeferredLockPasswordDialogProps {
  open: boolean;
  isSaving: boolean;
  errorMessage: string | null;
  onOpenChange: (open: boolean) => void;
  onSubmit: (password: string) => Promise<void>;
}

export function DeferredLockPasswordDialog({
  open,
  isSaving,
  errorMessage,
  onOpenChange,
  onSubmit
}: DeferredLockPasswordDialogProps) {
  const [password, setPassword] = useState('');
  const [localError, setLocalError] = useState<string | null>(null);
  const dialogRef = useRef<HTMLDivElement>(null);
  const inputRef = useRef<HTMLInputElement>(null);
  const previousActiveElement = useRef<HTMLElement | null>(null);

  useEffect(() => {
    if (!open) {
      return;
    }

    setPassword('');
    setLocalError(null);
    previousActiveElement.current =
      document.activeElement instanceof HTMLElement
        ? document.activeElement
        : null;
    inputRef.current?.focus();
  }, [open]);

  useEffect(() => {
    if (!open) {
      const previousElement = previousActiveElement.current;
      if (previousElement && document.body.contains(previousElement)) {
        previousElement.focus();
      }
    }
  }, [open]);

  const handleCancel = useCallback(() => {
    if (isSaving) {
      return;
    }
    onOpenChange(false);
  }, [isSaving, onOpenChange]);

  const handleKeyDown = useCallback(
    (event: React.KeyboardEvent<HTMLDivElement>) => {
      if (event.key === 'Escape') {
        handleCancel();
        return;
      }

      handleDialogTabTrap({
        event,
        containerRef: dialogRef,
        focusableSelector:
          'button:not([disabled]), [href], input:not([disabled]), select:not([disabled]), textarea:not([disabled]), [tabindex]:not([tabindex="-1"])'
      });
    },
    [handleCancel]
  );

  const handleSubmit = useCallback(async () => {
    const normalizedPassword = password.trim();
    if (!normalizedPassword) {
      setLocalError('Enter a password to continue.');
      return;
    }

    setLocalError(null);
    await onSubmit(normalizedPassword);
  }, [onSubmit, password]);

  if (!open) {
    return null;
  }

  return createPortal(
    <div
      className="fixed inset-0 flex items-center justify-center"
      style={{ zIndex: zIndex.modalBackdrop }}
    >
      <div
        className="absolute inset-0 bg-black/50"
        onClick={handleCancel}
        aria-hidden="true"
        data-testid="deferred-lock-password-backdrop"
      />
      <div
        ref={dialogRef}
        className="relative w-full max-w-md rounded-lg border bg-background p-6 shadow-lg"
        style={{ zIndex: zIndex.modal }}
        role="dialog"
        aria-modal="true"
        aria-labelledby="deferred-lock-password-title"
        data-testid="deferred-lock-password-dialog"
        tabIndex={-1}
        onKeyDown={handleKeyDown}
      >
        <h2 id="deferred-lock-password-title" className="font-semibold text-lg">
          Set Password Before Locking
        </h2>
        <p className="mt-2 text-muted-foreground text-sm">
          This instance is using deferred password setup. Create a password now
          so it can be locked while signed out.
        </p>
        <div className="mt-4">
          <label
            htmlFor="deferred-lock-password-input"
            className="mb-2 block font-medium text-sm"
          >
            Database Password
          </label>
          <Input
            id="deferred-lock-password-input"
            ref={inputRef}
            type="password"
            autoComplete="new-password"
            value={password}
            onChange={(event) => setPassword(event.target.value)}
            disabled={isSaving}
            data-testid="deferred-lock-password-input"
          />
          {(localError ?? errorMessage) && (
            <p
              className="mt-2 text-destructive text-sm"
              data-testid="deferred-lock-password-error"
            >
              {localError ?? errorMessage}
            </p>
          )}
        </div>
        <div className="mt-6 flex justify-end gap-3">
          <Button
            variant="outline"
            onClick={handleCancel}
            disabled={isSaving}
            data-testid="deferred-lock-password-cancel"
          >
            Cancel
          </Button>
          <Button
            onClick={handleSubmit}
            disabled={isSaving}
            data-testid="deferred-lock-password-submit"
          >
            {isSaving ? 'Saving...' : 'Save and Lock'}
          </Button>
        </div>
      </div>
    </div>,
    document.body
  );
}
