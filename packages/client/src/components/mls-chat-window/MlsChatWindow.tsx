import {
  AddMemberDialog,
  MlsChatProvider,
  type MlsChatUIComponents,
  NewGroupDialog,
  useGroupMembers,
  useGroupMessages,
  useGroups,
  useKeyPackages,
  useMlsClient,
  useMlsRealtime,
  useWelcomeMessages
} from '@tearleads/mls-chat';
import {
  DesktopFloatingWindow as FloatingWindow,
  WindowControlBar,
  type WindowDimensions
} from '@tearleads/window-manager';
import { useCallback, useEffect, useState } from 'react';
import { InlineRequiresLoginAndUnlock } from '@/components/auth';
import { Button } from '@/components/ui/button';
import { DropdownMenu, DropdownMenuItem } from '@/components/ui/dropdown-menu';
import { Input } from '@/components/ui/input';
import { useAuth } from '@/contexts/AuthContext';
import { useTypedTranslation } from '@/i18n';
import { API_BASE_URL } from '@/lib/api';
import { MlsChatContent } from './MlsChatContent';
import { MlsChatGroupsSidebar } from './MlsChatGroupsSidebar';
import { MlsChatWindowMenuBar } from './MlsChatWindowMenuBar';

const MIN_KEY_PACKAGES_COUNT = 5;

interface MlsChatWindowProps {
  id: string;
  onClose: () => void;
  onMinimize: (dimensions: WindowDimensions) => void;
  onDimensionsChange?: ((dimensions: WindowDimensions) => void) | undefined;
  onRename?: ((title: string) => void) | undefined;
  onFocus: () => void;
  zIndex: number;
  initialDimensions?: WindowDimensions | undefined;
}

// Map our UI components to what MlsChat expects
const MlsChatButton: MlsChatUIComponents['Button'] = ({
  onClick,
  children,
  disabled,
  variant,
  size,
  className
}) => (
  <Button
    onClick={onClick}
    disabled={disabled}
    variant={variant}
    size={size}
    className={className}
  >
    {children}
  </Button>
);

const MlsChatInput: MlsChatUIComponents['Input'] = ({
  value,
  onChange,
  placeholder,
  disabled,
  className
}) => (
  <Input
    value={value}
    onChange={(e) => onChange(e.target.value)}
    placeholder={placeholder}
    disabled={disabled}
    className={className}
  />
);

const MlsChatAvatar: MlsChatUIComponents['Avatar'] = ({
  userId,
  email,
  size,
  className
}) => {
  const sizeClasses = {
    sm: 'h-8 w-8',
    md: 'h-10 w-10',
    lg: 'h-12 w-12'
  };

  const initials = email
    ? (email.split('@')[0]?.charAt(0)?.toUpperCase() ?? '?')
    : userId.charAt(0).toUpperCase();

  return (
    <div
      className={`flex items-center justify-center rounded-full bg-muted ${sizeClasses[size ?? 'md']} ${className ?? ''}`}
    >
      <span className="font-medium text-sm">{initials}</span>
    </div>
  );
};

const MlsChatScrollArea: MlsChatUIComponents['ScrollArea'] = ({
  children,
  className
}) => <div className={`overflow-auto ${className ?? ''}`}>{children}</div>;

const MlsChatDropdownMenu: MlsChatUIComponents['DropdownMenu'] = ({
  trigger,
  children,
  align
}) => (
  <DropdownMenu trigger={trigger} {...(align !== undefined && { align })}>
    {children}
  </DropdownMenu>
);

const MlsChatDropdownMenuItem: MlsChatUIComponents['DropdownMenuItem'] = ({
  onClick,
  icon,
  children
}) => (
  <DropdownMenuItem onClick={onClick} icon={icon}>
    {children}
  </DropdownMenuItem>
);

const uiComponents: MlsChatUIComponents = {
  Button: MlsChatButton,
  Input: MlsChatInput,
  Avatar: MlsChatAvatar,
  ScrollArea: MlsChatScrollArea,
  DropdownMenu: MlsChatDropdownMenu,
  DropdownMenuItem: MlsChatDropdownMenuItem
};

export function MlsChatWindow({
  id,
  onClose,
  onMinimize,
  onDimensionsChange,
  onRename,
  onFocus,
  zIndex,
  initialDimensions
}: MlsChatWindowProps) {
  const { t } = useTypedTranslation('menu');
  const { token, user } = useAuth();

  const apiBaseUrl = API_BASE_URL ?? 'http://localhost:5001/v1';
  const getAuthHeader = useCallback(
    () => (token ? `Bearer ${token}` : null),
    [token]
  );
  const userId = user?.id ?? '';
  const userEmail = user?.email ?? '';

  return (
    <FloatingWindow
      id={id}
      title={t('mlsChat')}
      onClose={onClose}
      onMinimize={onMinimize}
      onDimensionsChange={onDimensionsChange}
      onRename={onRename}
      onFocus={onFocus}
      zIndex={zIndex}
      {...(initialDimensions !== undefined && { initialDimensions })}
      defaultWidth={700}
      defaultHeight={550}
      minWidth={500}
      minHeight={400}
    >
      <div className="flex h-full flex-col overflow-hidden">
        <InlineRequiresLoginAndUnlock
          description="MLS Chat"
          unlockDescription="MLS chat"
        >
          <MlsChatProvider
            apiBaseUrl={apiBaseUrl}
            getAuthHeader={getAuthHeader}
            userId={userId}
            userEmail={userEmail}
            ui={uiComponents}
          >
            <MlsChatWindowInner onClose={onClose} />
          </MlsChatProvider>
        </InlineRequiresLoginAndUnlock>
      </div>
    </FloatingWindow>
  );
}

interface MlsChatWindowInnerProps {
  onClose: () => void;
}

function MlsChatWindowInner({ onClose }: MlsChatWindowInnerProps) {
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
  const [sidebarWidth, setSidebarWidth] = useState(200);
  const [isCreatingGroup, setIsCreatingGroup] = useState(false);
  const [newGroupDialogOpen, setNewGroupDialogOpen] = useState(false);
  const [addMemberDialogOpen, setAddMemberDialogOpen] = useState(false);
  const [isAddingMember, setIsAddingMember] = useState(false);

  const selectedGroup = groups.find((g) => g.id === selectedGroupId) ?? null;

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
    addMember,
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
    if (
      isInitialized &&
      hasCredential &&
      keyPackages.length < MIN_KEY_PACKAGES_COUNT
    ) {
      void generateAndUpload(MIN_KEY_PACKAGES_COUNT - keyPackages.length);
    }
  }, [isInitialized, hasCredential, keyPackages.length, generateAndUpload]);

  const handleCreateGroup = useCallback(
    async (name: string) => {
      setIsCreatingGroup(true);
      try {
        const group = await createGroup(name);
        setSelectedGroupId(group.id);
      } finally {
        setIsCreatingGroup(false);
      }
    },
    [createGroup]
  );

  const handleLeaveGroup = useCallback(async () => {
    if (!selectedGroupId) return;
    await leaveGroup(selectedGroupId);
    setSelectedGroupId(null);
  }, [selectedGroupId, leaveGroup]);

  const handleAddMember = useCallback(
    async (userId: string) => {
      setIsAddingMember(true);
      try {
        await addMember(userId);
      } finally {
        setIsAddingMember(false);
      }
    },
    [addMember]
  );

  // Show setup screen if not initialized
  if (!isInitialized || !hasCredential) {
    return (
      <div className="flex h-full flex-col">
        <MlsChatWindowMenuBar onClose={onClose} />
        <WindowControlBar>{null}</WindowControlBar>
        <div className="flex flex-1 items-center justify-center">
          <div className="text-center">
            <h2 className="mb-4 font-semibold text-xl">MLS Chat Setup</h2>
            {!isInitialized ? (
              <p className="text-muted-foreground">
                Initializing MLS client...
              </p>
            ) : (
              <div>
                <p className="mb-4 text-muted-foreground">
                  Generate your MLS credentials to start chatting securely.
                </p>
                <Button onClick={() => void generateCredential()}>
                  Generate Credentials
                </Button>
              </div>
            )}
          </div>
        </div>
      </div>
    );
  }

  return (
    <>
      <MlsChatWindowMenuBar onClose={onClose} />
      <WindowControlBar>{null}</WindowControlBar>
      <div className="flex flex-1 overflow-hidden">
        <MlsChatGroupsSidebar
          width={sidebarWidth}
          onWidthChange={setSidebarWidth}
          groups={groups}
          selectedGroupId={selectedGroupId}
          onGroupSelect={setSelectedGroupId}
          onCreateGroup={() => setNewGroupDialogOpen(true)}
          isLoading={groupsLoading}
        />
        <div className="flex-1 overflow-hidden">
          <MlsChatContent
            selectedGroup={selectedGroup}
            messages={messages}
            members={members}
            isMessagesLoading={messagesLoading}
            isMembersLoading={membersLoading}
            isSending={isSending}
            hasMore={hasMore}
            connectionState={connectionState}
            onSend={sendMessage}
            onLoadMore={loadMore}
            onAddMember={() => setAddMemberDialogOpen(true)}
            onRemoveMember={(userId) => void removeMember(userId)}
            onLeaveGroup={() => void handleLeaveGroup()}
          />
        </div>
      </div>

      <NewGroupDialog
        open={newGroupDialogOpen}
        onOpenChange={setNewGroupDialogOpen}
        onGroupCreate={handleCreateGroup}
        isCreating={isCreatingGroup}
      />

      <AddMemberDialog
        open={addMemberDialogOpen}
        onOpenChange={setAddMemberDialogOpen}
        onAddMember={handleAddMember}
        isAdding={isAddingMember}
      />
    </>
  );
}
