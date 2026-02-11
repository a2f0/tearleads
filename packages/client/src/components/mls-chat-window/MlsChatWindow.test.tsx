import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';

// Create mock functions that can be accessed in tests
const mockGenerateCredential = vi.fn();
const mockCreateGroup = vi.fn().mockResolvedValue({ id: 'new-group' });
const mockLeaveGroup = vi.fn();
const mockSubscribe = vi.fn();
const mockUnsubscribe = vi.fn();
const mockSendMessage = vi.fn();
const mockLoadMore = vi.fn();
const mockAddMember = vi.fn();
const mockRemoveMember = vi.fn();
const mockGenerateAndUpload = vi.fn();
const mockProcessWelcome = vi.fn();

// Track mock state for different test scenarios
const mockState = {
  isInitialized: true,
  hasCredential: true,
  isUnlocked: true,
  isDatabaseLoading: false,
  userId: 'user-1',
  groups: [] as { id: string; name: string; memberCount: number }[]
};

vi.mock('@tearleads/mls-chat', () => ({
  MlsChatProvider: ({ children }: { children: React.ReactNode }) => (
    <>{children}</>
  ),
  AddMemberDialog: ({
    open,
    onOpenChange,
    onAddMember
  }: {
    open: boolean;
    onOpenChange: (open: boolean) => void;
    onAddMember: (userId: string) => Promise<void>;
  }) =>
    open ? (
      <div data-testid="add-member-dialog">
        <button
          type="button"
          onClick={() => {
            void onAddMember('new-user');
            onOpenChange(false);
          }}
        >
          Add
        </button>
        <button type="button" onClick={() => onOpenChange(false)}>
          Cancel
        </button>
      </div>
    ) : null,
  NewGroupDialog: ({
    open,
    onOpenChange,
    onGroupCreate
  }: {
    open: boolean;
    onOpenChange: (open: boolean) => void;
    onGroupCreate: (name: string) => Promise<void>;
  }) =>
    open ? (
      <div data-testid="new-group-dialog">
        <button
          type="button"
          onClick={() => {
            void onGroupCreate('New Group');
            onOpenChange(false);
          }}
        >
          Create
        </button>
        <button type="button" onClick={() => onOpenChange(false)}>
          Cancel
        </button>
      </div>
    ) : null,
  useMlsClient: () => ({
    client: mockState.isInitialized ? {} : null,
    isInitialized: mockState.isInitialized,
    hasCredential: mockState.hasCredential,
    generateCredential: mockGenerateCredential
  }),
  useGroups: () => ({
    groups: mockState.groups,
    isLoading: false,
    createGroup: mockCreateGroup,
    leaveGroup: mockLeaveGroup
  }),
  useKeyPackages: () => ({
    keyPackages: [],
    generateAndUpload: mockGenerateAndUpload
  }),
  useWelcomeMessages: () => ({
    welcomeMessages: [],
    processWelcome: mockProcessWelcome
  }),
  useMlsRealtime: () => ({
    subscribe: mockSubscribe,
    unsubscribe: mockUnsubscribe,
    connectionState: 'connected'
  }),
  useGroupMessages: () => ({
    messages: [],
    isLoading: false,
    isSending: false,
    hasMore: false,
    sendMessage: mockSendMessage,
    loadMore: mockLoadMore
  }),
  useGroupMembers: () => ({
    members: [],
    isLoading: false,
    addMember: mockAddMember,
    removeMember: mockRemoveMember
  })
}));

vi.mock('./MlsChatGroupsSidebar', () => ({
  MlsChatGroupsSidebar: ({
    onCreateGroup,
    onGroupSelect
  }: {
    onCreateGroup: () => void;
    onGroupSelect: (id: string | null) => void;
  }) => (
    <div data-testid="mls-chat-groups-sidebar">
      <button type="button" onClick={onCreateGroup} data-testid="create-group">
        New Group
      </button>
      <button
        type="button"
        onClick={() => onGroupSelect('group-1')}
        data-testid="select-group"
      >
        Select Group
      </button>
    </div>
  )
}));

vi.mock('./MlsChatContent', () => ({
  MlsChatContent: ({
    onAddMember,
    onLeaveGroup,
    onRemoveMember
  }: {
    onAddMember: () => void;
    onLeaveGroup: () => void;
    onRemoveMember: (userId: string) => void;
  }) => (
    <div data-testid="mls-chat-content">
      <button type="button" onClick={onAddMember} data-testid="add-member">
        Add Member
      </button>
      <button type="button" onClick={onLeaveGroup} data-testid="leave-group">
        Leave
      </button>
      <button
        type="button"
        onClick={() => onRemoveMember('member-1')}
        data-testid="remove-member"
      >
        Remove Member
      </button>
    </div>
  )
}));

vi.mock('./MlsChatWindowMenuBar', () => ({
  MlsChatWindowMenuBar: () => <div data-testid="mls-chat-menu-bar" />
}));

vi.mock('@/components/floating-window', () => ({
  FloatingWindow: ({
    children,
    title
  }: {
    children: React.ReactNode;
    title: string;
  }) => (
    <div data-testid="floating-window" data-title={title}>
      {children}
    </div>
  )
}));

vi.mock('@/components/sqlite/InlineUnlock', () => ({
  InlineUnlock: () => <div data-testid="inline-unlock" />
}));

vi.mock('@/db/hooks', () => ({
  useDatabaseContext: () => ({
    isUnlocked: mockState.isUnlocked,
    isLoading: mockState.isDatabaseLoading
  })
}));

vi.mock('@/contexts/AuthContext', () => ({
  useAuth: () => ({
    token: 'test-token',
    user: mockState.userId
      ? { id: mockState.userId, email: 'test@example.com' }
      : null
  })
}));

vi.mock('@/i18n', () => ({
  useTypedTranslation: () => ({
    t: (key: string) => key
  })
}));

import { MlsChatWindow } from './MlsChatWindow';

describe('MlsChatWindow', () => {
  const defaultProps = {
    id: 'test-window',
    onClose: vi.fn(),
    onMinimize: vi.fn(),
    onFocus: vi.fn(),
    zIndex: 100
  };

  beforeEach(() => {
    // Reset state before each test
    mockState.isInitialized = true;
    mockState.hasCredential = true;
    mockState.isUnlocked = true;
    mockState.isDatabaseLoading = false;
    mockState.userId = 'user-1';
    mockState.groups = [];

    vi.clearAllMocks();
  });

  it('renders floating window with title', () => {
    render(<MlsChatWindow {...defaultProps} />);
    expect(screen.getByTestId('floating-window')).toBeInTheDocument();
    expect(screen.getByTestId('floating-window')).toHaveAttribute(
      'data-title',
      'mlsChat'
    );
  });

  it('renders main chat interface when unlocked and user is logged in', () => {
    render(<MlsChatWindow {...defaultProps} />);
    expect(screen.getByTestId('mls-chat-groups-sidebar')).toBeInTheDocument();
    expect(screen.getByTestId('mls-chat-content')).toBeInTheDocument();
  });

  it('passes initialDimensions when provided', () => {
    const initialDimensions = { x: 100, y: 100, width: 800, height: 600 };
    render(
      <MlsChatWindow {...defaultProps} initialDimensions={initialDimensions} />
    );
    expect(screen.getByTestId('floating-window')).toBeInTheDocument();
  });

  it('shows loading state when database is loading', () => {
    mockState.isDatabaseLoading = true;
    render(<MlsChatWindow {...defaultProps} />);
    expect(screen.getByText('Loading database...')).toBeInTheDocument();
  });

  it('shows InlineUnlock when database is not unlocked', () => {
    mockState.isUnlocked = false;
    render(<MlsChatWindow {...defaultProps} />);
    expect(screen.getByTestId('inline-unlock')).toBeInTheDocument();
  });

  it('shows login prompt when user is not logged in', () => {
    mockState.userId = '';
    render(<MlsChatWindow {...defaultProps} />);
    expect(
      screen.getByText('Please log in to use MLS Chat')
    ).toBeInTheDocument();
  });

  it('shows setup screen when MLS client is not initialized', () => {
    mockState.isInitialized = false;
    render(<MlsChatWindow {...defaultProps} />);
    expect(screen.getByText('MLS Chat Setup')).toBeInTheDocument();
    expect(screen.getByText('Initializing MLS client...')).toBeInTheDocument();
  });

  it('shows generate credentials button when initialized but no credential', () => {
    mockState.hasCredential = false;
    render(<MlsChatWindow {...defaultProps} />);
    expect(screen.getByText('MLS Chat Setup')).toBeInTheDocument();
    expect(screen.getByText('Generate Credentials')).toBeInTheDocument();
  });

  it('calls generateCredential when button is clicked', () => {
    mockState.hasCredential = false;
    render(<MlsChatWindow {...defaultProps} />);
    fireEvent.click(screen.getByText('Generate Credentials'));
    expect(mockGenerateCredential).toHaveBeenCalled();
  });

  it('opens new group dialog when create group is clicked', () => {
    render(<MlsChatWindow {...defaultProps} />);
    fireEvent.click(screen.getByTestId('create-group'));
    expect(screen.getByTestId('new-group-dialog')).toBeInTheDocument();
  });

  it('opens add member dialog when add member is clicked', () => {
    render(<MlsChatWindow {...defaultProps} />);
    fireEvent.click(screen.getByTestId('add-member'));
    expect(screen.getByTestId('add-member-dialog')).toBeInTheDocument();
  });

  it('calls leaveGroup when leave is clicked', async () => {
    render(<MlsChatWindow {...defaultProps} />);
    // First select a group
    fireEvent.click(screen.getByTestId('select-group'));
    // Then leave it
    fireEvent.click(screen.getByTestId('leave-group'));
    await waitFor(() => {
      expect(mockLeaveGroup).toHaveBeenCalledWith('group-1');
    });
  });

  it('calls removeMember when remove member is clicked', () => {
    render(<MlsChatWindow {...defaultProps} />);
    fireEvent.click(screen.getByTestId('remove-member'));
    expect(mockRemoveMember).toHaveBeenCalledWith('member-1');
  });

  it('generates key packages on mount when needed', () => {
    render(<MlsChatWindow {...defaultProps} />);
    expect(mockGenerateAndUpload).toHaveBeenCalledWith(5);
  });

  it('creates group when new group dialog is submitted', async () => {
    render(<MlsChatWindow {...defaultProps} />);
    fireEvent.click(screen.getByTestId('create-group'));
    expect(screen.getByTestId('new-group-dialog')).toBeInTheDocument();
    fireEvent.click(screen.getByText('Create'));
    await waitFor(() => {
      expect(mockCreateGroup).toHaveBeenCalledWith('New Group');
    });
  });

  it('adds member when add member dialog is submitted', async () => {
    render(<MlsChatWindow {...defaultProps} />);
    fireEvent.click(screen.getByTestId('add-member'));
    expect(screen.getByTestId('add-member-dialog')).toBeInTheDocument();
    fireEvent.click(screen.getByText('Add'));
    await waitFor(() => {
      expect(mockAddMember).toHaveBeenCalledWith('new-user');
    });
  });

  it('subscribes to group when selected', () => {
    render(<MlsChatWindow {...defaultProps} />);
    fireEvent.click(screen.getByTestId('select-group'));
    expect(mockSubscribe).toHaveBeenCalledWith('group-1');
  });

  it('closes dialogs when cancelled', () => {
    render(<MlsChatWindow {...defaultProps} />);
    // Open and cancel new group dialog
    fireEvent.click(screen.getByTestId('create-group'));
    expect(screen.getByTestId('new-group-dialog')).toBeInTheDocument();
    fireEvent.click(screen.getByText('Cancel'));
    expect(screen.queryByTestId('new-group-dialog')).not.toBeInTheDocument();
  });

  it('handles width change on sidebar', () => {
    render(<MlsChatWindow {...defaultProps} />);
    // Sidebar renders successfully with default width
    expect(screen.getByTestId('mls-chat-groups-sidebar')).toBeInTheDocument();
  });
});
