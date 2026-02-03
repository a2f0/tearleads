import type { DecryptedAiConversation } from '@rapid/shared';
import { useRef, useState } from 'react';
import { Button } from '@/components/ui/button';
import { useDialogAccessibility } from '@/hooks/useDialogAccessibility';

export interface DeleteConversationDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  conversation: DecryptedAiConversation | null;
  onDelete: (conversationId: string) => Promise<void>;
}

export function DeleteConversationDialog({
  open,
  onOpenChange,
  conversation,
  onDelete
}: DeleteConversationDialogProps) {
  const [isDeleting, setIsDeleting] = useState(false);
  const dialogRef = useRef<HTMLDivElement>(null);

  const { handleKeyDown } = useDialogAccessibility(
    dialogRef,
    open,
    isDeleting,
    () => onOpenChange(false)
  );

  const handleDelete = async () => {
    if (!conversation || isDeleting) return;

    setIsDeleting(true);
    try {
      await onDelete(conversation.id);
      onOpenChange(false);
    } catch (error) {
      console.error('Failed to delete conversation:', error);
    } finally {
      setIsDeleting(false);
    }
  };

  const handleCancel = () => {
    if (isDeleting) return;
    onOpenChange(false);
  };

  if (!open || !conversation) return null;

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center">
      <div
        className="fixed inset-0 bg-black/50 backdrop-blur-sm"
        onClick={handleCancel}
        aria-hidden="true"
        data-testid="delete-conversation-dialog-backdrop"
      />
      <div
        ref={dialogRef}
        className="relative z-10 w-full max-w-md rounded-lg border bg-background p-6 shadow-lg"
        role="dialog"
        aria-modal="true"
        aria-labelledby="delete-conversation-dialog-title"
        data-testid="delete-conversation-dialog"
        tabIndex={-1}
        onKeyDown={handleKeyDown}
      >
        <h2
          id="delete-conversation-dialog-title"
          className="font-semibold text-lg"
        >
          Delete Conversation
        </h2>
        <p className="mt-2 text-muted-foreground text-sm">
          Are you sure you want to delete &ldquo;{conversation.title}&rdquo;?
          This action cannot be undone.
        </p>
        <div className="mt-6 flex justify-end gap-3">
          <Button
            type="button"
            variant="outline"
            onClick={handleCancel}
            disabled={isDeleting}
            data-testid="delete-conversation-dialog-cancel"
          >
            Cancel
          </Button>
          <Button
            type="button"
            variant="destructive"
            onClick={handleDelete}
            disabled={isDeleting}
            data-testid="delete-conversation-dialog-delete"
          >
            {isDeleting ? 'Deleting...' : 'Delete'}
          </Button>
        </div>
      </div>
    </div>
  );
}
