import { WindowContextMenu } from '@tearleads/window-manager';
import { Pencil, Trash2 } from 'lucide-react';
import type { DecryptedConversation } from '../../context';

interface ConversationsContextMenuProps {
  x: number;
  y: number;
  conversation: DecryptedConversation;
  onClose: () => void;
  onRename: (conversation: DecryptedConversation) => void;
  onDelete: (conversation: DecryptedConversation) => void;
}

export function ConversationsContextMenu({
  x,
  y,
  conversation,
  onClose,
  onRename,
  onDelete
}: ConversationsContextMenuProps) {
  const handleRename = () => {
    onRename(conversation);
    onClose();
  };

  const handleDelete = () => {
    onDelete(conversation);
    onClose();
  };

  return (
    <WindowContextMenu
      x={x}
      y={y}
      onClose={onClose}
      backdropTestId="conversation-context-menu-backdrop"
      menuTestId="conversation-context-menu"
    >
      <button
        type="button"
        className="flex w-full items-center gap-2 rounded-sm px-2 py-1.5 text-left text-sm hover:bg-accent hover:text-accent-foreground"
        onClick={handleRename}
        data-testid="conversation-context-menu-rename"
      >
        <Pencil className="h-4 w-4" />
        Rename
      </button>
      <button
        type="button"
        className="flex w-full items-center gap-2 rounded-sm px-2 py-1.5 text-left text-destructive text-sm hover:bg-destructive hover:text-destructive-foreground"
        onClick={handleDelete}
        data-testid="conversation-context-menu-delete"
      >
        <Trash2 className="h-4 w-4" />
        Delete
      </button>
    </WindowContextMenu>
  );
}
