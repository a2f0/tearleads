import {
  type ActiveGroup,
  type DecryptedMessage,
  MemberList,
  MlsChatWindow as MlsChatWindowComponent
} from '@rapid/mls-chat';
import type { MlsGroupMember } from '@rapid/shared';
import type { FC, ReactElement } from 'react';
import { useCallback, useState } from 'react';

interface MlsChatContentProps {
  selectedGroup: ActiveGroup | null;
  messages: DecryptedMessage[];
  members: MlsGroupMember[];
  isMessagesLoading: boolean;
  isMembersLoading: boolean;
  isSending: boolean;
  hasMore: boolean;
  connectionState: string;
  onSend: (message: string) => Promise<void>;
  onLoadMore?: () => Promise<void>;
  onAddMember: () => void;
  onRemoveMember: (userId: string) => void;
  onLeaveGroup: () => void;
}

export const MlsChatContent: FC<MlsChatContentProps> = ({
  selectedGroup,
  messages,
  members,
  isMessagesLoading,
  isMembersLoading,
  isSending,
  hasMore,
  connectionState,
  onSend,
  onLoadMore,
  onAddMember,
  onRemoveMember,
  onLeaveGroup
}) => {
  const [showMembers, setShowMembers] = useState(false);

  const handleLeaveGroup = useCallback(() => {
    const confirmed = window.confirm(
      'Are you sure you want to leave this group?'
    );
    if (!confirmed) return;
    onLeaveGroup();
  }, [onLeaveGroup]);

  if (!selectedGroup) {
    return (
      <div className="flex h-full items-center justify-center">
        <div className="text-center text-muted-foreground">
          <p className="mb-2">Select a group to start chatting</p>
          <p className="text-xs">Connection: {connectionState}</p>
        </div>
      </div>
    );
  }

  return (
    <div className="flex h-full">
      <div className="flex flex-1 flex-col">
        <MlsChatWindowComponent
          groupName={selectedGroup.name}
          messages={messages}
          isLoading={isMessagesLoading}
          isSending={isSending}
          hasMore={hasMore}
          canDecrypt={selectedGroup.canDecrypt}
          onSend={onSend}
          {...(onLoadMore !== undefined && { onLoadMore })}
          onOpenMembers={() => setShowMembers(true)}
          onLeaveGroup={handleLeaveGroup}
        />
      </div>

      {showMembers && (
        <div className="w-64 flex-shrink-0 border-l">
          <div className="flex items-center justify-between border-b p-4">
            <h3 className="font-medium">Members</h3>
            <button
              type="button"
              onClick={() => setShowMembers(false)}
              className="text-muted-foreground hover:text-foreground"
            >
              <CloseIcon />
            </button>
          </div>
          <MemberList
            members={members}
            isLoading={isMembersLoading}
            canManageMembers={true}
            onAddMember={onAddMember}
            onRemoveMember={onRemoveMember}
          />
        </div>
      )}
    </div>
  );
};

function CloseIcon(): ReactElement {
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
      <path d="M18 6 6 18" />
      <path d="m6 6 12 12" />
    </svg>
  );
}
