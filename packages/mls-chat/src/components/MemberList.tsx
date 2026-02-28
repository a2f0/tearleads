/**
 * Group member list component.
 * Shows members with options to add/remove.
 */

import type { MlsGroupMember } from '@tearleads/shared';
import type { FC } from 'react';

import { useMlsChatUI } from '../context/index.js';
import { MemberListItem } from './MemberListItem.js';

interface MemberListProps {
  members: MlsGroupMember[];
  isLoading?: boolean;
  canManageMembers?: boolean;
  onAddMember?: () => void;
  onRemoveMember?: (userId: string) => void;
}

export const MemberList: FC<MemberListProps> = ({
  members,
  isLoading = false,
  canManageMembers = false,
  onAddMember,
  onRemoveMember
}) => {
  const { Button, ScrollArea } = useMlsChatUI();

  if (isLoading) {
    return (
      <div className="flex h-full items-center justify-center">
        <div className="text-muted-foreground text-sm">Loading members...</div>
      </div>
    );
  }

  return (
    <div className="flex h-full flex-col">
      <div className="border-b p-4">
        <div className="flex items-center justify-between">
          <h3 className="font-medium">Members ({members.length})</h3>
          {canManageMembers && onAddMember && (
            <Button onClick={onAddMember} size="sm" variant="outline">
              Add
            </Button>
          )}
        </div>
      </div>

      <ScrollArea className="flex-1">
        <ul className="p-2">
          {members.map((member) => (
            <MemberListItem
              key={member.userId}
              member={member}
              canManageMembers={canManageMembers}
              onRemoveMember={onRemoveMember}
            />
          ))}
        </ul>
      </ScrollArea>
    </div>
  );
};
