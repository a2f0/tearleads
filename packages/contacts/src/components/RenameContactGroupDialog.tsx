import { useCallback, useEffect, useRef, useState } from 'react';
import { useContactsUI } from '../context';
import type { ContactGroup } from '../hooks';

interface RenameContactGroupDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  group: ContactGroup | null;
  onRename: (groupId: string, name: string) => Promise<void>;
}

export function RenameContactGroupDialog({
  open,
  onOpenChange,
  group,
  onRename
}: RenameContactGroupDialogProps) {
  const { Button, Input } = useContactsUI();
  const [name, setName] = useState('');
  const [isSaving, setIsSaving] = useState(false);
  const previousActiveElement = useRef<HTMLElement | null>(null);

  useEffect(() => {
    if (open && group) {
      setName(group.name);
      previousActiveElement.current = document.activeElement as HTMLElement;
    } else if (!open) {
      previousActiveElement.current?.focus();
    }
  }, [group, open]);

  const handleCancel = useCallback(() => {
    if (isSaving) return;
    onOpenChange(false);
  }, [isSaving, onOpenChange]);

  const handleSubmit = useCallback(
    async (event: React.FormEvent) => {
      event.preventDefault();
      const trimmed = name.trim();
      if (!group || !trimmed || isSaving) return;
      if (trimmed === group.name) {
        onOpenChange(false);
        return;
      }

      setIsSaving(true);
      try {
        await onRename(group.id, trimmed);
        onOpenChange(false);
      } catch (error) {
        console.error('Failed to rename contact group:', error);
      } finally {
        setIsSaving(false);
      }
    },
    [group, isSaving, name, onOpenChange, onRename]
  );

  if (!open || !group) return null;

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
        <h2 className="font-semibold text-lg">Rename Group</h2>
        <form onSubmit={handleSubmit}>
          <div className="mt-4">
            <Input
              value={name}
              onChange={(event) => setName(event.target.value)}
              placeholder="Group name"
              disabled={isSaving}
              autoFocus
              className="text-base"
            />
          </div>
          <div className="mt-6 flex justify-end gap-3">
            <Button
              type="button"
              variant="outline"
              onClick={handleCancel}
              disabled={isSaving}
            >
              Cancel
            </Button>
            <Button type="submit" disabled={isSaving || !name.trim()}>
              {isSaving ? 'Saving...' : 'Save'}
            </Button>
          </div>
        </form>
      </div>
    </div>
  );
}
