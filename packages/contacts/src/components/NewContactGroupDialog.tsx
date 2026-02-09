import { useCallback, useEffect, useRef, useState } from 'react';
import { useContactsUI } from '../context';

interface NewContactGroupDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  onCreate: (name: string) => Promise<void>;
}

export function NewContactGroupDialog({
  open,
  onOpenChange,
  onCreate
}: NewContactGroupDialogProps) {
  const { Button, Input } = useContactsUI();
  const [name, setName] = useState('');
  const [isCreating, setIsCreating] = useState(false);
  const previousActiveElement = useRef<HTMLElement | null>(null);

  useEffect(() => {
    if (open) {
      setName('');
      previousActiveElement.current = document.activeElement as HTMLElement;
    } else {
      previousActiveElement.current?.focus();
    }
  }, [open]);

  const handleCancel = useCallback(() => {
    if (isCreating) return;
    onOpenChange(false);
  }, [isCreating, onOpenChange]);

  const handleSubmit = useCallback(
    async (event: React.FormEvent) => {
      event.preventDefault();
      const trimmed = name.trim();
      if (!trimmed || isCreating) return;

      setIsCreating(true);
      try {
        await onCreate(trimmed);
        onOpenChange(false);
      } catch (error) {
        console.error('Failed to create contact group:', error);
      } finally {
        setIsCreating(false);
      }
    },
    [isCreating, name, onCreate, onOpenChange]
  );

  if (!open) return null;

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center">
      <div
        className="fixed inset-0 bg-black/50 backdrop-blur-sm"
        onClick={handleCancel}
        aria-hidden="true"
      />
      <div
        className="relative z-10 w-full max-w-md rounded-lg border bg-background p-6 shadow-lg"
        role="dialog"
        aria-modal="true"
      >
        <h2 className="font-semibold text-lg">New Group</h2>
        <form onSubmit={handleSubmit}>
          <div className="mt-4">
            <Input
              value={name}
              onChange={(event) => setName(event.target.value)}
              placeholder="Group name"
              disabled={isCreating}
              autoFocus
              className="text-base"
            />
          </div>
          <div className="mt-6 flex justify-end gap-3">
            <Button
              type="button"
              variant="outline"
              onClick={handleCancel}
              disabled={isCreating}
            >
              Cancel
            </Button>
            <Button type="submit" disabled={isCreating || !name.trim()}>
              {isCreating ? 'Creating...' : 'Create'}
            </Button>
          </div>
        </form>
      </div>
    </div>
  );
}
