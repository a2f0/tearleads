import { useRef, useState } from 'react';
import { Button } from '@/components/ui/button';
import { useDialogAccessibility } from '@/hooks/useDialogAccessibility';

export interface NewConversationDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  onConfirm: () => Promise<void>;
}

export function NewConversationDialog({
  open,
  onOpenChange,
  onConfirm
}: NewConversationDialogProps) {
  const [isCreating, setIsCreating] = useState(false);
  const dialogRef = useRef<HTMLDivElement>(null);

  const { handleKeyDown } = useDialogAccessibility(
    dialogRef,
    open,
    isCreating,
    () => onOpenChange(false)
  );

  const handleCreate = async () => {
    if (isCreating) return;

    setIsCreating(true);
    try {
      await onConfirm();
      onOpenChange(false);
    } catch (error) {
      console.error('Failed to create conversation:', error);
    } finally {
      setIsCreating(false);
    }
  };

  const handleCancel = () => {
    if (isCreating) return;
    onOpenChange(false);
  };

  if (!open) return null;

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center">
      <div
        className="fixed inset-0 bg-black/50 backdrop-blur-sm"
        onClick={handleCancel}
        aria-hidden="true"
        data-testid="new-conversation-dialog-backdrop"
      />
      <div
        ref={dialogRef}
        className="relative z-10 w-full max-w-md rounded-lg border bg-background p-6 shadow-lg"
        role="dialog"
        aria-modal="true"
        aria-labelledby="new-conversation-dialog-title"
        data-testid="new-conversation-dialog"
        tabIndex={-1}
        onKeyDown={handleKeyDown}
      >
        <h2
          id="new-conversation-dialog-title"
          className="font-semibold text-lg"
        >
          New Conversation
        </h2>
        <p className="mt-2 text-muted-foreground text-sm">
          Start a new conversation? Any unsent messages in the current chat will
          be discarded.
        </p>
        <div className="mt-6 flex justify-end gap-3">
          <Button
            type="button"
            variant="outline"
            onClick={handleCancel}
            disabled={isCreating}
            data-testid="new-conversation-dialog-cancel"
          >
            Cancel
          </Button>
          <Button
            type="button"
            onClick={handleCreate}
            disabled={isCreating}
            data-testid="new-conversation-dialog-create"
          >
            {isCreating ? 'Creating...' : 'Create'}
          </Button>
        </div>
      </div>
    </div>
  );
}
