/**
 * Full page MLS chat component.
 * Combines group list, chat window, and member management.
 */
import type { FC, ReactElement } from 'react';
import { useCallback, useEffect, useState } from 'react';

import { GroupList, MemberList, MlsChatWindow } from '../components/index.js';
import {
  useGroupMembers,
  useGroupMessages,
  useGroups,
  useKeyPackages,
  useMlsClient,
  useMlsRealtime,
  useWelcomeMessages
} from '../hooks/index.js';

interface MlsChatProps {
  className?: string;
}

export const MlsChat: FC<MlsChatProps> = ({ className = '' }) => {
  const { client, isInitialized, hasCredential, generateCredential } =
    useMlsClient();
  const {
    groups,
    isLoading: groupsLoading,
    createGroup,
    leaveGroup
  } = useGroups(client);
  const { keyPackages, generateAndUpload } = useKeyPackages(client);
  const { welcomeMessages, processWelcome } = useWelcomeMessages(client);
  const { subscribe, unsubscribe, connectionState } = useMlsRealtime(client);

  const [selectedGroupId, setSelectedGroupId] = useState<string | null>(null);
  const [showMembers, setShowMembers] = useState(false);
  const [isCreatingGroup, setIsCreatingGroup] = useState(false);

  const selectedGroup = groups.find((g) => g.id === selectedGroupId);

  const {
    messages,
    isLoading: messagesLoading,
    isSending,
    hasMore,
    sendMessage,
    loadMore
  } = useGroupMessages(selectedGroupId, client);

  const {
    members,
    isLoading: membersLoading,
    // addMember will be used when member lookup is implemented
    addMember: _addMember,
    removeMember
  } = useGroupMembers(selectedGroupId, client);

  // Subscribe to selected group for realtime updates
  useEffect(() => {
    if (!selectedGroupId) {
      return;
    }
    subscribe(selectedGroupId);
    return () => unsubscribe(selectedGroupId);
  }, [selectedGroupId, subscribe, unsubscribe]);

  // Process pending welcome messages
  useEffect(() => {
    welcomeMessages.forEach((welcome) => {
      void processWelcome(welcome.id);
    });
  }, [welcomeMessages, processWelcome]);

  // Ensure we have key packages
  useEffect(() => {
    if (isInitialized && hasCredential && keyPackages.length < 5) {
      void generateAndUpload(5 - keyPackages.length);
    }
  }, [isInitialized, hasCredential, keyPackages.length, generateAndUpload]);

  const handleCreateGroup = useCallback(async () => {
    const name = window.prompt('Enter group name:');
    if (!name?.trim()) return;

    setIsCreatingGroup(true);
    try {
      const group = await createGroup(name.trim());
      setSelectedGroupId(group.id);
    } finally {
      setIsCreatingGroup(false);
    }
  }, [createGroup]);

  const handleLeaveGroup = useCallback(async () => {
    if (!selectedGroupId) return;

    const confirmed = window.confirm(
      'Are you sure you want to leave this group?'
    );
    if (!confirmed) return;

    await leaveGroup(selectedGroupId);
    setSelectedGroupId(null);
    setShowMembers(false);
  }, [selectedGroupId, leaveGroup]);

  const handleAddMember = useCallback(async () => {
    const email = window.prompt('Enter user email to add:');
    if (!email?.trim()) return;

    // In a real app, you'd look up the user ID by email
    // For now, we'll just show an error
    window.alert('Member lookup by email not yet implemented');
  }, []);

  // Show setup screen if not initialized
  if (!isInitialized || !hasCredential) {
    return (
      <div className={`flex h-full items-center justify-center ${className}`}>
        <div className="text-center">
          <h2 className="mb-4 font-semibold text-xl">MLS Chat Setup</h2>
          {!isInitialized ? (
            <p className="text-muted-foreground">Initializing MLS client...</p>
          ) : (
            <div>
              <p className="mb-4 text-muted-foreground">
                Generate your MLS credentials to start chatting securely.
              </p>
              <button
                type="button"
                onClick={() => void generateCredential()}
                className="rounded-lg bg-primary px-4 py-2 text-primary-foreground"
              >
                Generate Credentials
              </button>
            </div>
          )}
        </div>
      </div>
    );
  }

  return (
    <div className={`flex h-full ${className}`}>
      {/* Group list sidebar */}
      <div className="w-64 flex-shrink-0 border-r">
        <GroupList
          groups={groups}
          selectedGroupId={selectedGroupId}
          onSelectGroup={setSelectedGroupId}
          onCreateGroup={() => void handleCreateGroup()}
          isLoading={groupsLoading || isCreatingGroup}
        />
      </div>

      {/* Main chat area */}
      <div className="flex flex-1 flex-col">
        {selectedGroup ? (
          <MlsChatWindow
            groupName={selectedGroup.name}
            messages={messages}
            isLoading={messagesLoading}
            isSending={isSending}
            hasMore={hasMore}
            canDecrypt={selectedGroup.canDecrypt}
            onSend={sendMessage}
            onLoadMore={loadMore}
            onOpenMembers={() => setShowMembers(true)}
            onLeaveGroup={() => void handleLeaveGroup()}
          />
        ) : (
          <div className="flex h-full items-center justify-center">
            <div className="text-center text-muted-foreground">
              <p className="mb-2">Select a group to start chatting</p>
              <p className="text-xs">Connection: {connectionState}</p>
            </div>
          </div>
        )}
      </div>

      {/* Member list sidebar */}
      {showMembers && selectedGroup && (
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
            isLoading={membersLoading}
            canManageMembers={true}
            onAddMember={() => void handleAddMember()}
            onRemoveMember={(userId) => void removeMember(userId)}
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
