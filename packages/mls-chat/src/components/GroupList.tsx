/**
 * Sidebar list of MLS groups.
 * Shows groups the user is a member of with unread counts.
 */
import type { FC, ReactElement } from 'react';

import { useMlsChatUI } from '../context/index.js';
import type { ActiveGroup } from '../lib/index.js';
import { GroupListItem } from './GroupListItem';

interface GroupListProps {
  groups: ActiveGroup[];
  selectedGroupId: string | null;
  onSelectGroup: (groupId: string) => void;
  onCreateGroup: () => void;
  isLoading?: boolean;
}

function PlusIcon(): ReactElement {
  return (
    <svg
      aria-hidden="true"
      xmlns="http://www.w3.org/2000/svg"
      width="16"
      height="16"
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="2"
      strokeLinecap="round"
      strokeLinejoin="round"
    >
      <path d="M5 12h14" />
      <path d="M12 5v14" />
    </svg>
  );
}

export const GroupList: FC<GroupListProps> = ({
  groups,
  selectedGroupId,
  onSelectGroup,
  onCreateGroup,
  isLoading = false
}) => {
  const { ScrollArea } = useMlsChatUI();

  if (isLoading) {
    return (
      <div className="flex h-full items-center justify-center">
        <div className="text-muted-foreground text-sm">Loading groups...</div>
      </div>
    );
  }

  return (
    <div className="flex h-full flex-col">
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
          <PlusIcon />
        </button>
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
                <GroupListItem
                  key={group.id}
                  group={group}
                  selectedGroupId={selectedGroupId}
                  onSelectGroup={onSelectGroup}
                />
              ))}
            </ul>
          )}
        </div>
      </ScrollArea>
    </div>
  );
};
