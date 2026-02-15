import { useCallback, useEffect, useRef, useState } from 'react';
import { useContactsContext, useContactsUI } from '../context';
import type { ContactGroup } from '../hooks';

interface DeleteContactGroupDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  group: ContactGroup | null;
  onDelete: (groupId: string) => Promise<void>;
}

export function DeleteContactGroupDialog({
  open,
  onOpenChange,
  group,
  onDelete
}: DeleteContactGroupDialogProps) {
  const { Button } = useContactsUI();
  const { t } = useContactsContext();
  const [isDeleting, setIsDeleting] = useState(false);
  const previousActiveElement = useRef<HTMLElement | null>(null);

  useEffect(() => {
    if (open) {
      previousActiveElement.current = document.activeElement as HTMLElement;
    } else {
      previousActiveElement.current?.focus();
    }
  }, [open]);

  const handleCancel = useCallback(() => {
    if (isDeleting) return;
    onOpenChange(false);
  }, [isDeleting, onOpenChange]);

  const handleDelete = useCallback(async () => {
    if (!group || isDeleting) return;

    setIsDeleting(true);
    try {
      await onDelete(group.id);
      onOpenChange(false);
    } catch (error) {
      console.error('Failed to delete contact group:', error);
    } finally {
      setIsDeleting(false);
    }
  }, [group, isDeleting, onDelete, onOpenChange]);

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
        <h2 className="font-semibold text-lg">{t('deleteGroup')}</h2>
        <p className="mt-3 text-muted-foreground text-sm">
          {t('deleteGroupConfirm').replace('{{name}}', group.name)}
        </p>
        <div className="mt-6 flex justify-end gap-3">
          <Button
            type="button"
            variant="outline"
            onClick={handleCancel}
            disabled={isDeleting}
          >
            {t('cancel')}
          </Button>
          <Button
            type="button"
            variant="destructive"
            onClick={handleDelete}
            disabled={isDeleting}
          >
            {isDeleting ? t('deleting') : t('delete')}
          </Button>
        </div>
      </div>
    </div>
  );
}
