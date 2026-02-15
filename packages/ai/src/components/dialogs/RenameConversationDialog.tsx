import { useEffect, useRef, useState } from 'react';
import { type DecryptedConversation, useAIUI } from '../../context';
import { useDialogAccessibility } from '../../hooks';

export interface RenameConversationDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  conversation: DecryptedConversation | null;
  onRename: (conversationId: string, newTitle: string) => Promise<void>;
}

export function RenameConversationDialog({
  open,
  onOpenChange,
  conversation,
  onRename
}: RenameConversationDialogProps) {
  const { Button, Input } = useAIUI();
  const [newTitle, setNewTitle] = useState('');
  const [isRenaming, setIsRenaming] = useState(false);
  const dialogRef = useRef<HTMLDivElement>(null);

  const { handleKeyDown } = useDialogAccessibility(
    dialogRef,
    open,
    isRenaming,
    () => onOpenChange(false)
  );

  useEffect(() => {
    if (open && conversation) {
      setNewTitle(conversation.title);
    }
  }, [open, conversation]);

  const handleRename = async () => {
    if (!conversation || !newTitle.trim() || isRenaming) return;

    setIsRenaming(true);
    try {
      await onRename(conversation.id, newTitle.trim());
      onOpenChange(false);
    } catch (error) {
      console.error('Failed to rename conversation:', error);
    } finally {
      setIsRenaming(false);
    }
  };

  const handleCancel = () => {
    if (isRenaming) return;
    onOpenChange(false);
  };

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    handleRename();
  };

  if (!open || !conversation) return null;

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center">
      <div
        className="fixed inset-0 bg-black/50 backdrop-blur-sm"
        onClick={handleCancel}
        aria-hidden="true"
        data-testid="rename-conversation-dialog-backdrop"
      />
      <div
        ref={dialogRef}
        className="relative z-10 w-full max-w-md rounded-lg border bg-background p-6 shadow-lg"
        role="dialog"
        aria-modal="true"
        aria-labelledby="rename-conversation-dialog-title"
        data-testid="rename-conversation-dialog"
        tabIndex={-1}
        onKeyDown={handleKeyDown}
      >
        <h2
          id="rename-conversation-dialog-title"
          className="font-semibold text-lg"
        >
          Rename Conversation
        </h2>
        <form onSubmit={handleSubmit}>
          <div className="mt-4">
            <Input
              type="text"
              value={newTitle}
              onChange={(e) => setNewTitle(e.target.value)}
              placeholder="Conversation title"
              disabled={isRenaming}
              data-testid="rename-conversation-title-input"
              autoComplete="off"
              autoFocus
              className="text-base"
            />
          </div>
          <div className="mt-6 flex justify-end gap-3">
            <Button
              type="button"
              variant="outline"
              onClick={handleCancel}
              disabled={isRenaming}
              data-testid="rename-conversation-dialog-cancel"
            >
              Cancel
            </Button>
            <Button
              type="submit"
              disabled={isRenaming || !newTitle.trim()}
              data-testid="rename-conversation-dialog-rename"
            >
              {isRenaming ? 'Renaming...' : 'Rename'}
            </Button>
          </div>
        </form>
      </div>
    </div>
  );
}
