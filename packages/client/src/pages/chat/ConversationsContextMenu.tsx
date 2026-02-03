import type { DecryptedAiConversation } from '@rapid/shared';
import { Pencil, Trash2 } from 'lucide-react';
import { useCallback, useEffect, useRef } from 'react';
import { createPortal } from 'react-dom';
import { zIndex } from '@/constants/zIndex';

interface ConversationsContextMenuProps {
  x: number;
  y: number;
  conversation: DecryptedAiConversation;
  onClose: () => void;
  onRename: (conversation: DecryptedAiConversation) => void;
  onDelete: (conversation: DecryptedAiConversation) => void;
}

export function ConversationsContextMenu({
  x,
  y,
  conversation,
  onClose,
  onRename,
  onDelete
}: ConversationsContextMenuProps) {
  const menuRef = useRef<HTMLDivElement>(null);
  const handleBackdropClick = useCallback(() => {
    onClose();
  }, [onClose]);

  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      if (e.key === 'Escape') {
        onClose();
      }
    };

    document.addEventListener('keydown', handleKeyDown);

    return () => {
      document.removeEventListener('keydown', handleKeyDown);
    };
  }, [onClose]);

  const handleRename = () => {
    onRename(conversation);
    onClose();
  };

  const handleDelete = () => {
    onDelete(conversation);
    onClose();
  };

  return createPortal(
    <>
      <div
        className="fixed inset-0"
        style={{ zIndex: zIndex.floatingWindowContextMenuBackdrop }}
        onClick={handleBackdropClick}
        aria-hidden="true"
        data-testid="conversation-context-menu-backdrop"
      />
      <div
        ref={menuRef}
        className="fixed min-w-[160px] rounded-md border bg-popover p-1 shadow-md"
        style={{
          left: x,
          top: y,
          zIndex: zIndex.floatingWindowContextMenu
        }}
        data-testid="conversation-context-menu"
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
      </div>
    </>,
    document.body
  );
}
