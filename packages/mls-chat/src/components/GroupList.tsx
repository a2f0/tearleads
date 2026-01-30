/**
 * Sidebar list of MLS groups.
 * Shows groups the user is a member of with unread counts.
 */
import type { FC } from 'react';

import { useMlsChatUI } from '../context/index.js';
import type { ActiveGroup } from '../lib/index.js';

interface GroupListProps {
  groups: ActiveGroup[];
  selectedGroupId: string | null;
  onSelectGroup: (groupId: string) => void;
  onCreateGroup: () => void;
  isLoading?: boolean;
}

export const GroupList: FC<GroupListProps> = ({
  groups,
  selectedGroupId,
  onSelectGroup,
  onCreateGroup,
  isLoading = false
}) => {
  const { Button, ScrollArea } = useMlsChatUI();

  if (isLoading) {
    return (
      <div className="flex h-full items-center justify-center">
        <div className="text-muted-foreground text-sm">Loading groups...</div>
      </div>
    );
  }

  return (
    <div className="flex h-full flex-col">
      <div className="border-b p-4">
        <Button onClick={onCreateGroup} className="w-full">
          New Group
        </Button>
      </div>

      <ScrollArea className="flex-1">
        <div className="p-2">
          {groups.length === 0 ? (
            <div className="p-4 text-center text-muted-foreground text-sm">
              No groups yet. Create one to start chatting.
            </div>
          ) : (
            <ul className="space-y-1">
              {groups.map((group) => (
                <li key={group.id}>
                  <button
                    type="button"
                    onClick={() => onSelectGroup(group.id)}
                    className={`w-full rounded-lg px-3 py-2 text-left transition-colors ${
                      selectedGroupId === group.id
                        ? 'bg-primary text-primary-foreground'
                        : 'hover:bg-muted'
                    }`}
                  >
                    <div className="flex items-center justify-between">
                      <span className="truncate font-medium">{group.name}</span>
                      {group.unreadCount > 0 && (
                        <span className="ml-2 flex h-5 min-w-[1.25rem] items-center justify-center rounded-full bg-primary px-1.5 font-medium text-primary-foreground text-xs">
                          {group.unreadCount}
                        </span>
                      )}
                    </div>
                    <div className="mt-0.5 flex items-center gap-2 text-muted-foreground text-xs">
                      <span>{group.memberCount} members</span>
                      {!group.canDecrypt && (
                        <span className="text-destructive">No keys</span>
                      )}
                    </div>
                  </button>
                </li>
              ))}
            </ul>
          )}
        </div>
      </ScrollArea>
    </div>
  );
};
