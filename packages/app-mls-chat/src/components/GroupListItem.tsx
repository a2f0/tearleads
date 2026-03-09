import type { FC } from 'react';
import type { ActiveGroup } from '../lib/index.js';

interface GroupListItemProps {
  group: ActiveGroup;
  selectedGroupId: string | null;
  onSelectGroup: (groupId: string) => void;
}

export const GroupListItem: FC<GroupListItemProps> = ({
  group,
  selectedGroupId,
  onSelectGroup
}) => {
  return (
    <li>
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
  );
};
