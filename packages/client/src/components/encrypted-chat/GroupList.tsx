import { Plus, Lock } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { GroupItem, type ChatGroupInfo } from './GroupItem';

interface GroupListProps {
  groups: ChatGroupInfo[];
  selectedGroupId: string | null;
  onSelectGroup: (groupId: string) => void;
  onCreateGroup: () => void;
  isLoading?: boolean;
}

export function GroupList({
  groups,
  selectedGroupId,
  onSelectGroup,
  onCreateGroup,
  isLoading
}: GroupListProps) {
  return (
    <div className="flex h-full flex-col border-r">
      <div className="flex items-center justify-between border-b px-4 py-3">
        <div className="flex items-center gap-2">
          <Lock className="h-4 w-4 text-muted-foreground" />
          <h2 className="font-semibold">Encrypted Chats</h2>
        </div>
        <Button
          variant="ghost"
          size="icon"
          onClick={onCreateGroup}
          aria-label="Create new group"
        >
          <Plus className="h-4 w-4" />
        </Button>
      </div>

      <div className="flex-1 overflow-y-auto p-2">
        {isLoading ? (
          <div className="flex items-center justify-center py-8">
            <div className="h-6 w-6 animate-spin rounded-full border-2 border-primary border-t-transparent" />
          </div>
        ) : groups.length === 0 ? (
          <div className="px-2 py-8 text-center">
            <p className="text-sm text-muted-foreground">No groups yet</p>
            <Button
              variant="link"
              size="sm"
              onClick={onCreateGroup}
              className="mt-2"
            >
              Create your first group
            </Button>
          </div>
        ) : (
          groups.map((group) => (
            <GroupItem
              key={group.id}
              group={group}
              isSelected={selectedGroupId === group.id}
              onClick={() => onSelectGroup(group.id)}
            />
          ))
        )}
      </div>
    </div>
  );
}
