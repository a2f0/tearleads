import type { MlsGroupMember } from '@tearleads/shared';
import type { FC, ReactElement } from 'react';
import { useMlsChatUI, useMlsChatUser } from '../context/index.js';

interface MemberListItemProps {
  member: MlsGroupMember;
  canManageMembers: boolean;
  onRemoveMember?: (userId: string) => void;
}

function MoreIcon(): ReactElement {
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
      <circle cx="12" cy="12" r="1" />
      <circle cx="19" cy="12" r="1" />
      <circle cx="5" cy="12" r="1" />
    </svg>
  );
}

function RemoveIcon(): ReactElement {
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
      <path d="M16 21v-2a4 4 0 0 0-4-4H6a4 4 0 0 0-4 4v2" />
      <circle cx="9" cy="7" r="4" />
      <line x1="17" x2="22" y1="11" y2="11" />
    </svg>
  );
}

export const MemberListItem: FC<MemberListItemProps> = ({
  member,
  canManageMembers,
  onRemoveMember
}) => {
  const { Button, Avatar, DropdownMenu, DropdownMenuItem } = useMlsChatUI();
  const { userId: currentUserId } = useMlsChatUser();

  return (
    <li
      key={member.userId}
      className="flex items-center justify-between rounded-lg px-2 py-2"
    >
      <div className="flex items-center gap-3">
        <Avatar userId={member.userId} email={member.email} size="sm" />
        <div>
          <div className="font-medium text-sm">
            {member.email}
            {member.userId === currentUserId && (
              <span className="ml-1 text-muted-foreground">(you)</span>
            )}
          </div>
          <div className="text-muted-foreground text-xs">
            Joined{' '}
            {new Intl.DateTimeFormat('en-US', {
              month: 'short',
              day: 'numeric'
            }).format(new Date(member.joinedAt))}
          </div>
        </div>
      </div>

      {canManageMembers &&
        member.userId !== currentUserId &&
        onRemoveMember && (
          <DropdownMenu
            trigger={
              <Button variant="ghost" size="icon">
                <MoreIcon />
              </Button>
            }
            align="right"
          >
            <DropdownMenuItem
              onClick={() => onRemoveMember(member.userId)}
              icon={<RemoveIcon />}
            >
              Remove from group
            </DropdownMenuItem>
          </DropdownMenu>
        )}
    </li>
  );
};
