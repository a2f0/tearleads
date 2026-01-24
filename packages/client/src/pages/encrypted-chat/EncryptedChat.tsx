import { Loader2, MessageSquareLock, Shield } from 'lucide-react';
import { useCallback, useEffect, useState } from 'react';
import { toast } from 'sonner';
import {
  AddMembersDialog,
  type ChatGroupInfo,
  ChatHeader,
  ChatInput,
  CreateGroupDialog,
  GroupList,
  type Message,
  MessageList,
  type UserInfo
} from '@/components/encrypted-chat';
import { useAuth } from '@/contexts/AuthContext';
import { useMLS } from '@/hooks/useMLS';

export function EncryptedChat() {
  const { user, token } = useAuth();
  const mls = useMLS();

  const [groups, setGroups] = useState<ChatGroupInfo[]>([]);
  const [selectedGroupId, setSelectedGroupId] = useState<string | null>(null);
  const [messages, setMessages] = useState<Message[]>([]);
  const [isLoadingGroups, setIsLoadingGroups] = useState(false);
  const [isLoadingMessages, setIsLoadingMessages] = useState(false);
  const [showCreateDialog, setShowCreateDialog] = useState(false);
  const [showAddMembersDialog, setShowAddMembersDialog] = useState(false);
  const [availableUsers, setAvailableUsers] = useState<UserInfo[]>([]);
  const [groupMembers, setGroupMembers] = useState<string[]>([]);

  const selectedGroup = groups.find((g) => g.id === selectedGroupId);

  const loadGroups = useCallback(async () => {
    if (!token) return;

    setIsLoadingGroups(true);
    try {
      const response = await fetch('/api/v1/mls/groups', {
        headers: { Authorization: `Bearer ${token}` }
      });
      if (!response.ok) throw new Error('Failed to load groups');
      const data = await response.json();
      setGroups(
        data.groups.map(
          (g: { id: string; name: string; memberCount: number }) => ({
            id: g.id,
            name: g.name,
            memberCount: g.memberCount
          })
        )
      );
    } catch (err) {
      console.error('Failed to load groups:', err);
      toast.error('Failed to load groups');
    } finally {
      setIsLoadingGroups(false);
    }
  }, [token]);

  // Initialize MLS when component mounts
  useEffect(() => {
    if (user && !mls.isInitialized && !mls.isLoading) {
      mls.initialize(user.id).catch((err) => {
        console.error('Failed to initialize MLS:', err);
        toast.error('Failed to initialize encryption');
      });
    }
  }, [user, mls]);

  // Load groups after MLS is initialized
  useEffect(() => {
    if (mls.isInitialized && token) {
      loadGroups();
    }
  }, [mls.isInitialized, token, loadGroups]);

  const loadMessages = useCallback(
    async (groupId: string) => {
      if (!token) return;

      setIsLoadingMessages(true);
      try {
        const response = await fetch(`/api/v1/mls/groups/${groupId}/messages`, {
          headers: { Authorization: `Bearer ${token}` }
        });
        if (!response.ok) throw new Error('Failed to load messages');
        const data = await response.json();

        // Decrypt messages
        const decryptedMessages: Message[] = [];
        for (const msg of data.messages) {
          try {
            const result = await mls.decrypt(groupId, msg.ciphertext);
            // Skip commit messages (they update state but have no content)
            if (result === null) continue;
            decryptedMessages.push({
              id: msg.id,
              senderId: msg.senderId,
              senderName: msg.senderEmail?.split('@')[0] ?? 'Unknown',
              content: result.plaintext,
              timestamp: new Date(msg.createdAt),
              isOwn: msg.senderId === user?.id
            });
          } catch {
            decryptedMessages.push({
              id: msg.id,
              senderId: msg.senderId,
              senderName: msg.senderEmail?.split('@')[0] ?? 'Unknown',
              content: '[Unable to decrypt]',
              timestamp: new Date(msg.createdAt),
              isOwn: msg.senderId === user?.id
            });
          }
        }
        setMessages(decryptedMessages);
      } catch (err) {
        console.error('Failed to load messages:', err);
        toast.error('Failed to load messages');
      } finally {
        setIsLoadingMessages(false);
      }
    },
    [token, mls, user]
  );

  const handleSelectGroup = useCallback(
    (groupId: string) => {
      setSelectedGroupId(groupId);
      loadMessages(groupId);
    },
    [loadMessages]
  );

  const handleCreateGroup = useCallback(
    async (name: string) => {
      if (!token) return;

      const { mlsGroupId } = await mls.createGroup(name);

      const response = await fetch('/api/v1/mls/groups', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${token}`
        },
        body: JSON.stringify({ name, mlsGroupId })
      });

      if (!response.ok) throw new Error('Failed to create group');

      const data = await response.json();
      setGroups((prev) => [
        {
          id: data.group.id,
          name: data.group.name,
          memberCount: 1
        },
        ...prev
      ]);
      setSelectedGroupId(data.group.id);
      setMessages([]);
      toast.success('Group created');
    },
    [token, mls]
  );

  const handleSendMessage = useCallback(
    async (plaintext: string) => {
      if (!selectedGroupId || !token) return;

      try {
        const { ciphertext, epoch } = await mls.encrypt(
          selectedGroupId,
          plaintext
        );

        const response = await fetch(
          `/api/v1/mls/groups/${selectedGroupId}/messages`,
          {
            method: 'POST',
            headers: {
              'Content-Type': 'application/json',
              Authorization: `Bearer ${token}`
            },
            body: JSON.stringify({ ciphertext, epoch })
          }
        );

        if (!response.ok) throw new Error('Failed to send message');

        const data = await response.json();
        setMessages((prev) => [
          ...prev,
          {
            id: data.message.id,
            senderId: user?.id ?? '',
            senderName: 'Me',
            content: plaintext,
            timestamp: new Date(data.message.createdAt),
            isOwn: true
          }
        ]);
      } catch (err) {
        console.error('Failed to send message:', err);
        toast.error('Failed to send message');
      }
    },
    [selectedGroupId, token, mls, user]
  );

  const handleAddMembers = useCallback(
    async (userIds: string[]) => {
      if (!selectedGroupId || !token) return;

      // Fetch key packages for each user
      const keyPackages: string[] = [];
      for (const userId of userIds) {
        const response = await fetch(`/api/v1/mls/key-packages/${userId}`, {
          headers: { Authorization: `Bearer ${token}` }
        });
        if (!response.ok) throw new Error(`Failed to get key package for user`);
        const data = await response.json();
        keyPackages.push(data.keyPackageData);
      }

      // Add members via MLS
      const { commit, welcomes } = await mls.addMembers(
        selectedGroupId,
        keyPackages
      );

      if (welcomes.length === 0) {
        throw new Error('MLS add members returned no welcome messages');
      }

      const welcomeMessages =
        welcomes.length === 1
          ? userIds.map((userId) => ({
              userId,
              welcomeData: welcomes[0]?.welcome ?? ''
            }))
          : welcomes.length === userIds.length
          ? welcomes.map((welcome, index) => ({
              userId: userIds[index] ?? '',
              welcomeData: welcome.welcome
            }))
          : null;

      if (!welcomeMessages || welcomeMessages.some((w) => !w.userId)) {
        throw new Error('MLS welcome messages do not match selected members');
      }

      // Send to server
      const response = await fetch(
        `/api/v1/mls/groups/${selectedGroupId}/members`,
        {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
            Authorization: `Bearer ${token}`
          },
          body: JSON.stringify({
            memberUserIds: userIds,
            commitData: commit,
            welcomeMessages
          })
        }
      );

      if (!response.ok) throw new Error('Failed to add members');

      const commitEpoch = await mls.getEpoch(selectedGroupId);
      const commitResponse = await fetch(
        `/api/v1/mls/groups/${selectedGroupId}/messages`,
        {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
            Authorization: `Bearer ${token}`
          },
          body: JSON.stringify({ ciphertext: commit, epoch: commitEpoch })
        }
      );

      if (!commitResponse.ok) {
        throw new Error('Failed to broadcast group commit');
      }

      toast.success(`Added ${userIds.length} member(s)`);
      loadGroups();
    },
    [selectedGroupId, token, mls, loadGroups]
  );

  const openAddMembersDialog = useCallback(async () => {
    if (!selectedGroupId || !token) return;

    try {
      // Fetch group members
      const groupResponse = await fetch(
        `/api/v1/mls/groups/${selectedGroupId}`,
        {
          headers: { Authorization: `Bearer ${token}` }
        }
      );
      if (!groupResponse.ok) throw new Error('Failed to fetch group');
      const groupData = await groupResponse.json();
      setGroupMembers(
        groupData.members.map((m: { userId: string }) => m.userId)
      );

      // Fetch available users (contacts)
      const usersResponse = await fetch('/api/v1/contacts', {
        headers: { Authorization: `Bearer ${token}` }
      });
      if (usersResponse.ok) {
        const usersData = await usersResponse.json();
        setAvailableUsers(
          usersData.contacts.map(
            (c: { id: string; email: string; firstName?: string }) => ({
              id: c.id,
              email: c.email,
              displayName: c.firstName
            })
          )
        );
      }

      setShowAddMembersDialog(true);
    } catch (err) {
      console.error('Failed to open add members dialog:', err);
      toast.error('Failed to load users');
    }
  }, [selectedGroupId, token]);

  // Show loading/initializing state
  if (!user) {
    return (
      <div className="flex h-full items-center justify-center">
        <p className="text-muted-foreground">
          Please sign in to use encrypted chat
        </p>
      </div>
    );
  }

  if (mls.isLoading || !mls.isInitialized) {
    return (
      <div className="flex h-full flex-col items-center justify-center gap-4">
        <Loader2 className="h-8 w-8 animate-spin text-primary" />
        <div className="text-center">
          <p className="font-medium">Initializing End-to-End Encryption</p>
          <p className="mt-1 text-muted-foreground text-sm">
            Setting up your secure identity...
          </p>
        </div>
      </div>
    );
  }

  if (mls.error) {
    return (
      <div className="flex h-full flex-col items-center justify-center gap-4 px-4 text-center">
        <Shield className="h-12 w-12 text-destructive" />
        <div>
          <p className="font-medium">Encryption Error</p>
          <p className="mt-1 text-muted-foreground text-sm">{mls.error}</p>
        </div>
      </div>
    );
  }

  return (
    <div className="flex h-full">
      {/* Group List Sidebar */}
      <div className="w-80 shrink-0">
        <GroupList
          groups={groups}
          selectedGroupId={selectedGroupId}
          onSelectGroup={handleSelectGroup}
          onCreateGroup={() => setShowCreateDialog(true)}
          isLoading={isLoadingGroups}
        />
      </div>

      {/* Chat Area */}
      <div className="flex flex-1 flex-col">
        {selectedGroup ? (
          <>
            <ChatHeader
              groupName={selectedGroup.name}
              memberCount={selectedGroup.memberCount}
              onAddMembers={openAddMembersDialog}
            />
            <MessageList messages={messages} isLoading={isLoadingMessages} />
            <ChatInput onSend={handleSendMessage} />
          </>
        ) : (
          <div className="flex flex-1 flex-col items-center justify-center gap-4 px-4 text-center">
            <div className="flex h-16 w-16 items-center justify-center rounded-full bg-muted">
              <MessageSquareLock className="h-8 w-8 text-muted-foreground" />
            </div>
            <div>
              <h3 className="font-semibold text-lg">Select a Group</h3>
              <p className="mt-1 text-muted-foreground text-sm">
                Choose a group from the sidebar or create a new one to start
                chatting.
              </p>
            </div>
          </div>
        )}
      </div>

      {/* Dialogs */}
      <CreateGroupDialog
        isOpen={showCreateDialog}
        onClose={() => setShowCreateDialog(false)}
        onCreate={handleCreateGroup}
      />

      <AddMembersDialog
        isOpen={showAddMembersDialog}
        onClose={() => setShowAddMembersDialog(false)}
        onAdd={handleAddMembers}
        availableUsers={availableUsers}
        existingMemberIds={groupMembers}
      />
    </div>
  );
}
