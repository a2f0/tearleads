/**
 * Dialog for adding a member to an MLS group.
 * Provides a modal interface for entering the member's user ID.
 */

import type { FC } from 'react';
import { useCallback, useEffect, useRef, useState } from 'react';

import { useMlsChatUI } from '../context/index.js';

export interface AddMemberDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  onAddMember: (userId: string) => Promise<void>;
  isAdding?: boolean;
}

export const AddMemberDialog: FC<AddMemberDialogProps> = ({
  open,
  onOpenChange,
  onAddMember,
  isAdding = false
}) => {
  const { Button } = useMlsChatUI();
  const [userId, setUserId] = useState('');
  const [error, setError] = useState<string | null>(null);
  const dialogRef = useRef<HTMLDivElement>(null);
  const inputRef = useRef<HTMLInputElement>(null);
  const previousActiveElement = useRef<HTMLElement | null>(null);

  useEffect(() => {
    if (open) {
      setUserId('');
      setError(null);
      previousActiveElement.current = document.activeElement as HTMLElement;
      setTimeout(() => inputRef.current?.focus(), 0);
    } else {
      previousActiveElement.current?.focus();
    }
  }, [open]);

  const handleKeyDown = useCallback(
    (e: React.KeyboardEvent) => {
      if (e.key === 'Escape' && !isAdding) {
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
    [isAdding, onOpenChange]
  );

  const handleAdd = async () => {
    if (!userId.trim() || isAdding) return;
    setError(null);

    try {
      await onAddMember(userId.trim());
      onOpenChange(false);
    } catch (err) {
      console.error('Failed to add member:', err);
      setError(
        err instanceof Error ? err.message : 'An unknown error occurred.'
      );
    }
  };

  const handleCancel = () => {
    if (isAdding) return;
    onOpenChange(false);
  };

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    void handleAdd();
  };

  if (!open) return null;

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center">
      <div
        className="fixed inset-0 bg-black/50 backdrop-blur-sm"
        onClick={handleCancel}
        aria-hidden="true"
        data-testid="add-member-dialog-backdrop"
      />
      <div
        ref={dialogRef}
        className="relative z-10 w-full max-w-md rounded-lg border bg-background p-6 shadow-lg"
        role="dialog"
        aria-modal="true"
        aria-labelledby="add-member-dialog-title"
        data-testid="add-member-dialog"
        tabIndex={-1}
        onKeyDown={handleKeyDown}
      >
        <h2 id="add-member-dialog-title" className="font-semibold text-lg">
          Add Member
        </h2>
        <form onSubmit={handleSubmit}>
          <div className="mt-4">
            <input
              ref={inputRef}
              type="text"
              value={userId}
              onChange={(e) => setUserId(e.target.value)}
              placeholder="User ID"
              disabled={isAdding}
              className="flex h-10 w-full rounded-md border border-input bg-background px-3 py-2 text-base ring-offset-background file:border-0 file:bg-transparent file:font-medium file:text-sm placeholder:text-muted-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 disabled:cursor-not-allowed disabled:opacity-50"
              data-testid="add-member-userid-input"
              autoComplete="off"
            />
            {error && <p className="mt-2 text-destructive text-sm">{error}</p>}
          </div>
          <div className="mt-6 flex justify-end gap-3">
            <Button
              variant="outline"
              onClick={handleCancel}
              disabled={isAdding}
            >
              Cancel
            </Button>
            <Button
              onClick={() => void handleAdd()}
              disabled={isAdding || !userId.trim()}
            >
              {isAdding ? 'Adding...' : 'Add'}
            </Button>
          </div>
        </form>
      </div>
    </div>
  );
};
