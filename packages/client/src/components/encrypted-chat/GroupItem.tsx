import { Users } from 'lucide-react';
import { cn } from '@/lib/utils';

export interface ChatGroupInfo {
  id: string;
  name: string;
  memberCount: number;
  lastMessage?: string;
  lastMessageTime?: Date;
  unreadCount?: number;
}

interface GroupItemProps {
  group: ChatGroupInfo;
  isSelected: boolean;
  onClick: () => void;
}

export function GroupItem({ group, isSelected, onClick }: GroupItemProps) {
  return (
    <button
      type="button"
      onClick={onClick}
      className={cn(
        'flex w-full items-center gap-3 rounded-lg px-3 py-2 text-left transition-colors',
        isSelected
          ? 'bg-accent text-accent-foreground'
          : 'hover:bg-accent/50 hover:text-accent-foreground'
      )}
    >
      <div className="flex h-10 w-10 shrink-0 items-center justify-center rounded-full bg-muted">
        <Users className="h-5 w-5 text-muted-foreground" />
      </div>
      <div className="min-w-0 flex-1">
        <div className="flex items-center justify-between gap-2">
          <span className="truncate font-medium">{group.name}</span>
          {group.lastMessageTime && (
            <span className="shrink-0 text-muted-foreground text-xs">
              {formatRelativeTime(group.lastMessageTime)}
            </span>
          )}
        </div>
        <div className="flex items-center justify-between gap-2">
          <span className="truncate text-muted-foreground text-sm">
            {group.lastMessage ?? `${group.memberCount} members`}
          </span>
          {group.unreadCount !== undefined && group.unreadCount > 0 && (
            <span className="flex h-5 min-w-5 shrink-0 items-center justify-center rounded-full bg-primary px-1.5 font-medium text-primary-foreground text-xs">
              {group.unreadCount > 99 ? '99+' : group.unreadCount}
            </span>
          )}
        </div>
      </div>
    </button>
  );
}

function formatRelativeTime(date: Date): string {
  const now = new Date();
  const diffMs = now.getTime() - date.getTime();
  const diffMins = Math.floor(diffMs / 60000);
  const diffHours = Math.floor(diffMs / 3600000);
  const diffDays = Math.floor(diffMs / 86400000);

  if (diffMins < 1) return 'now';
  if (diffMins < 60) return `${diffMins}m`;
  if (diffHours < 24) return `${diffHours}h`;
  if (diffDays < 7) return `${diffDays}d`;
  return date.toLocaleDateString([], { month: 'short', day: 'numeric' });
}
