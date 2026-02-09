import type { ActiveGroup } from '@rapid/mls-chat';
import { useResizableSidebar, WindowContextMenu } from '@rapid/window-manager';
import { Loader2, MessageCircle, Plus } from 'lucide-react';
import { useCallback, useState } from 'react';

const MIN_SIDEBAR_WIDTH = 150;
const MAX_SIDEBAR_WIDTH = 400;

interface MlsChatGroupsSidebarProps {
  width: number;
  onWidthChange: (width: number) => void;
  groups: ActiveGroup[];
  selectedGroupId: string | null;
  onGroupSelect: (groupId: string | null) => void;
  onCreateGroup: () => void;
  isLoading?: boolean;
  error?: string | null;
}

export function MlsChatGroupsSidebar({
  width,
  onWidthChange,
  groups,
  selectedGroupId,
  onGroupSelect,
  onCreateGroup,
  isLoading = false,
  error = null
}: MlsChatGroupsSidebarProps) {
  const [contextMenu, setContextMenu] = useState<{
    x: number;
    y: number;
    group: ActiveGroup;
  } | null>(null);

  const [emptySpaceContextMenu, setEmptySpaceContextMenu] = useState<{
    x: number;
    y: number;
  } | null>(null);

  const { resizeHandleProps } = useResizableSidebar({
    width,
    onWidthChange,
    minWidth: MIN_SIDEBAR_WIDTH,
    maxWidth: MAX_SIDEBAR_WIDTH,
    ariaLabel: 'Resize groups sidebar'
  });

  const handleContextMenu = useCallback(
    (e: React.MouseEvent, group: ActiveGroup) => {
      e.preventDefault();
      e.stopPropagation();
      setContextMenu({ x: e.clientX, y: e.clientY, group });
    },
    []
  );

  const handleEmptySpaceContextMenu = useCallback((e: React.MouseEvent) => {
    e.preventDefault();
    setEmptySpaceContextMenu({ x: e.clientX, y: e.clientY });
  }, []);

  return (
    <div
      className="relative flex shrink-0 flex-col border-r bg-muted/20"
      style={{ width }}
      data-testid="mls-chat-groups-sidebar"
    >
      <div className="flex items-center justify-between border-b px-3 py-2">
        <span className="font-medium text-muted-foreground text-xs">
          Groups
        </span>
        <button
          type="button"
          onClick={onCreateGroup}
          className="rounded p-1 text-muted-foreground hover:bg-accent hover:text-accent-foreground"
          title="New Group"
        >
          <Plus className="h-4 w-4" />
        </button>
      </div>
      {/* biome-ignore lint/a11y/noStaticElementInteractions: Context menu on empty space */}
      <div
        className="flex-1 overflow-y-auto p-1"
        onContextMenu={handleEmptySpaceContextMenu}
      >
        {isLoading && (
          <div className="flex items-center justify-center py-4">
            <Loader2 className="h-4 w-4 animate-spin text-muted-foreground" />
          </div>
        )}
        {error && (
          <div className="px-2 py-4 text-center text-destructive text-xs">
            {error}
          </div>
        )}
        {!isLoading && !error && groups.length === 0 && (
          <div className="p-4 text-center text-muted-foreground text-sm">
            No groups yet. Create one to start chatting.
          </div>
        )}
        {!isLoading &&
          !error &&
          groups.map((group) => (
            <button
              key={group.id}
              type="button"
              className={`flex w-full items-center gap-1 rounded px-2 py-1 text-left text-sm transition-colors ${
                selectedGroupId === group.id
                  ? 'bg-accent text-accent-foreground'
                  : 'hover:bg-accent/50'
              }`}
              style={{ paddingLeft: '8px' }}
              onClick={() => onGroupSelect(group.id)}
              onContextMenu={(e) => handleContextMenu(e, group)}
            >
              <span className="flex h-4 w-4 shrink-0 items-center justify-center" />
              <MessageCircle className="h-4 w-4 shrink-0 text-primary" />
              <span className="flex-1 truncate">{group.name}</span>
              <div className="flex items-center gap-1">
                {group.unreadCount > 0 && (
                  <span className="flex h-4 min-w-[1rem] items-center justify-center rounded-full bg-primary px-1 font-medium text-primary-foreground text-xs">
                    {group.unreadCount}
                  </span>
                )}
                <span className="text-muted-foreground text-xs">
                  {group.memberCount}
                </span>
              </div>
            </button>
          ))}
      </div>
      <hr
        className="absolute top-0 right-0 bottom-0 w-1 cursor-col-resize border-0 bg-transparent hover:bg-accent focus:outline-none focus:ring-2 focus:ring-ring"
        {...resizeHandleProps}
      />

      {contextMenu && (
        <GroupContextMenu
          x={contextMenu.x}
          y={contextMenu.y}
          group={contextMenu.group}
          onClose={() => setContextMenu(null)}
        />
      )}

      {emptySpaceContextMenu && (
        <EmptySpaceContextMenu
          x={emptySpaceContextMenu.x}
          y={emptySpaceContextMenu.y}
          onClose={() => setEmptySpaceContextMenu(null)}
          onNewGroup={() => {
            onCreateGroup();
            setEmptySpaceContextMenu(null);
          }}
        />
      )}
    </div>
  );
}

interface GroupContextMenuProps {
  x: number;
  y: number;
  group: ActiveGroup;
  onClose: () => void;
}

function GroupContextMenu({ x, y, group, onClose }: GroupContextMenuProps) {
  return (
    <WindowContextMenu
      x={x}
      y={y}
      onClose={onClose}
      backdropTestId="group-context-menu-backdrop"
      menuTestId="group-context-menu"
    >
      <div className="px-2 py-1.5 text-muted-foreground text-sm">
        {group.memberCount} member{group.memberCount !== 1 ? 's' : ''}
      </div>
    </WindowContextMenu>
  );
}

interface EmptySpaceContextMenuProps {
  x: number;
  y: number;
  onClose: () => void;
  onNewGroup: () => void;
}

function EmptySpaceContextMenu({
  x,
  y,
  onClose,
  onNewGroup
}: EmptySpaceContextMenuProps) {
  return (
    <WindowContextMenu
      x={x}
      y={y}
      onClose={onClose}
      backdropTestId="empty-space-context-menu-backdrop"
      menuTestId="empty-space-context-menu"
    >
      <button
        type="button"
        className="flex w-full items-center gap-2 rounded-sm px-2 py-1.5 text-sm hover:bg-accent hover:text-accent-foreground"
        onClick={onNewGroup}
      >
        <Plus className="h-4 w-4" />
        New Group
      </button>
    </WindowContextMenu>
  );
}
