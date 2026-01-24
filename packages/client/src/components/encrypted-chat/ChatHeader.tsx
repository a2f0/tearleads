import { Users, UserPlus, Lock } from 'lucide-react';
import { Button } from '@/components/ui/button';

interface ChatHeaderProps {
  groupName: string;
  memberCount: number;
  onAddMembers: () => void;
}

export function ChatHeader({
  groupName,
  memberCount,
  onAddMembers
}: ChatHeaderProps) {
  return (
    <div className="flex items-center justify-between border-b px-4 py-3">
      <div className="flex min-w-0 items-center gap-3">
        <div className="flex h-10 w-10 shrink-0 items-center justify-center rounded-full bg-muted">
          <Users className="h-5 w-5 text-muted-foreground" />
        </div>
        <div className="min-w-0">
          <h2 className="truncate font-semibold">{groupName}</h2>
          <div className="flex items-center gap-1 text-sm text-muted-foreground">
            <Lock className="h-3 w-3" />
            <span>
              {memberCount} member{memberCount !== 1 ? 's' : ''} - End-to-end
              encrypted
            </span>
          </div>
        </div>
      </div>
      <Button
        variant="ghost"
        size="icon"
        onClick={onAddMembers}
        aria-label="Add members"
      >
        <UserPlus className="h-4 w-4" />
      </Button>
    </div>
  );
}
