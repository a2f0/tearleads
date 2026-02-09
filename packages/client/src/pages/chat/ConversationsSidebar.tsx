import type { DecryptedAiConversation } from '@rapid/shared';
import { useResizableSidebar } from '@rapid/window-manager';
import { Loader2, MessageSquare, Plus } from 'lucide-react';
import { useCallback, useState } from 'react';
import { ConversationsContextMenu } from './ConversationsContextMenu';
import { DeleteConversationDialog } from './DeleteConversationDialog';
import { NewConversationDialog } from './NewConversationDialog';
import { RenameConversationDialog } from './RenameConversationDialog';

interface ConversationsSidebarProps {
  width: number;
  onWidthChange: (width: number) => void;
  conversations: DecryptedAiConversation[];
  selectedConversationId: string | null;
  onConversationSelect: (id: string | null) => void;
  onNewConversation: () => Promise<void>;
  onRenameConversation: (id: string, title: string) => Promise<void>;
  onDeleteConversation: (id: string) => Promise<void>;
  loading?: boolean;
  error?: string | null;
}

export function ConversationsSidebar({
  width,
  onWidthChange,
  conversations,
  selectedConversationId,
  onConversationSelect,
  onNewConversation,
  onRenameConversation,
  onDeleteConversation,
  loading,
  error
}: ConversationsSidebarProps) {
  const [newDialogOpen, setNewDialogOpen] = useState(false);
  const [renameDialogConversation, setRenameDialogConversation] =
    useState<DecryptedAiConversation | null>(null);
  const [deleteDialogConversation, setDeleteDialogConversation] =
    useState<DecryptedAiConversation | null>(null);

  const [contextMenu, setContextMenu] = useState<{
    x: number;
    y: number;
    conversation: DecryptedAiConversation;
  } | null>(null);

  const { resizeHandleProps } = useResizableSidebar({
    width,
    onWidthChange,
    ariaLabel: 'Resize conversations sidebar'
  });

  const handleContextMenu = useCallback(
    (e: React.MouseEvent, conversation: DecryptedAiConversation) => {
      e.preventDefault();
      e.stopPropagation();
      setContextMenu({ x: e.clientX, y: e.clientY, conversation });
    },
    []
  );

  const handleNewClick = useCallback(async () => {
    setNewDialogOpen(false);
    await onNewConversation();
  }, [onNewConversation]);

  const handleConversationDeleted = useCallback(
    async (deletedId: string) => {
      await onDeleteConversation(deletedId);
    },
    [onDeleteConversation]
  );

  const formatDate = (dateStr: string) => {
    const date = new Date(dateStr);
    const now = new Date();
    const diffMs = now.getTime() - date.getTime();
    const diffDays = Math.floor(diffMs / (1000 * 60 * 60 * 24));

    if (diffDays === 0) {
      return date.toLocaleTimeString(undefined, {
        hour: 'numeric',
        minute: '2-digit'
      });
    } else if (diffDays === 1) {
      return 'Yesterday';
    } else if (diffDays < 7) {
      return date.toLocaleDateString(undefined, { weekday: 'short' });
    } else {
      return date.toLocaleDateString(undefined, {
        month: 'short',
        day: 'numeric'
      });
    }
  };

  return (
    <div
      className="relative flex shrink-0 flex-col border-r bg-muted/20"
      style={{ width }}
      data-testid="conversations-sidebar"
    >
      <div className="flex items-center justify-between border-b px-3 py-2">
        <span className="font-medium text-muted-foreground text-xs">
          Conversations
        </span>
        <button
          type="button"
          onClick={() => setNewDialogOpen(true)}
          className="rounded p-1 text-muted-foreground hover:bg-accent hover:text-accent-foreground"
          title="New Conversation"
        >
          <Plus className="h-4 w-4" />
        </button>
      </div>
      <div className="flex-1 overflow-y-auto p-1">
        {loading && (
          <div className="flex items-center justify-center py-4">
            <Loader2 className="h-4 w-4 animate-spin text-muted-foreground" />
          </div>
        )}
        {error && (
          <div className="px-2 py-4 text-center text-destructive text-xs">
            {error}
          </div>
        )}
        {!loading &&
          !error &&
          conversations.map((conversation) => (
            <button
              key={conversation.id}
              type="button"
              className={`flex w-full items-center gap-2 rounded px-2 py-1.5 text-left text-sm transition-colors ${
                selectedConversationId === conversation.id
                  ? 'bg-accent text-accent-foreground'
                  : 'hover:bg-accent/50'
              }`}
              onClick={() => onConversationSelect(conversation.id)}
              onContextMenu={(e) => handleContextMenu(e, conversation)}
            >
              <MessageSquare className="h-4 w-4 shrink-0 text-primary" />
              <div className="flex flex-1 flex-col overflow-hidden">
                <span className="truncate">{conversation.title}</span>
                <span className="text-muted-foreground text-xs">
                  {formatDate(conversation.updatedAt)}
                </span>
              </div>
            </button>
          ))}
        {!loading && !error && conversations.length === 0 && (
          <div className="px-2 py-4 text-center text-muted-foreground text-xs">
            No conversations yet
          </div>
        )}
      </div>
      <hr
        className="absolute top-0 right-0 bottom-0 w-1 cursor-col-resize border-0 bg-transparent hover:bg-accent focus:outline-none focus:ring-2 focus:ring-ring"
        {...resizeHandleProps}
      />

      {contextMenu && (
        <ConversationsContextMenu
          x={contextMenu.x}
          y={contextMenu.y}
          conversation={contextMenu.conversation}
          onClose={() => setContextMenu(null)}
          onRename={(conversation) => setRenameDialogConversation(conversation)}
          onDelete={(conversation) => setDeleteDialogConversation(conversation)}
        />
      )}

      <NewConversationDialog
        open={newDialogOpen}
        onOpenChange={setNewDialogOpen}
        onConfirm={handleNewClick}
      />

      <RenameConversationDialog
        open={renameDialogConversation !== null}
        onOpenChange={(open) => {
          if (!open) setRenameDialogConversation(null);
        }}
        conversation={renameDialogConversation}
        onRename={onRenameConversation}
      />

      <DeleteConversationDialog
        open={deleteDialogConversation !== null}
        onOpenChange={(open) => {
          if (!open) setDeleteDialogConversation(null);
        }}
        conversation={deleteDialogConversation}
        onDelete={handleConversationDeleted}
      />
    </div>
  );
}
