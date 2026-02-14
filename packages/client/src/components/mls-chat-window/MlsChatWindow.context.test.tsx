/**
 * Test to verify MlsChatWindow context integration.
 * We mock @tearleads/mls-chat hooks at the package boundary so this test remains
 * stable even when workspace React versions diverge across packages.
 */
import { render, screen, waitFor } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';

// Mock dependencies EXCEPT @tearleads/mls-chat to test real context integration
vi.mock('@tearleads/window-manager', async (importOriginal) => {
  const actual =
    await importOriginal<typeof import('@tearleads/window-manager')>();

  return {
    ...actual,
    DesktopFloatingWindow: ({
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
  };
});

vi.mock('@/components/sqlite/InlineUnlock', () => ({
  InlineUnlock: () => <div data-testid="inline-unlock" />
}));

vi.mock('@/db/hooks', () => ({
  useDatabaseContext: () => ({
    isUnlocked: true,
    isLoading: false
  })
}));

vi.mock('@/contexts/AuthContext', () => ({
  useAuth: () => ({
    token: 'test-token',
    user: { id: 'user-1', email: 'test@example.com' }
  })
}));

vi.mock('@/i18n', () => ({
  useTypedTranslation: () => ({
    t: (key: string) => key
  })
}));

vi.mock('@/components/auth', () => ({
  InlineRequiresLoginAndUnlock: ({ children }: { children: React.ReactNode }) =>
    children
}));

vi.mock('@tearleads/mls-chat', () => ({
  AddMemberDialog: () => null,
  MlsChatProvider: ({ children }: { children: React.ReactNode }) => children,
  NewGroupDialog: () => null,
  useGroupMembers: () => ({
    members: [],
    isLoading: false,
    addMember: vi.fn(),
    removeMember: vi.fn()
  }),
  useGroupMessages: () => ({
    messages: [],
    isLoading: false,
    isSending: false,
    hasMore: false,
    sendMessage: vi.fn(),
    loadMore: vi.fn()
  }),
  useGroups: () => ({
    groups: [],
    isLoading: false,
    createGroup: vi.fn(),
    leaveGroup: vi.fn()
  }),
  useKeyPackages: () => ({
    keyPackages: [],
    generateAndUpload: vi.fn()
  }),
  useMlsClient: () => ({
    client: null,
    isInitialized: false,
    hasCredential: false,
    generateCredential: vi.fn()
  }),
  useMlsRealtime: () => ({
    subscribe: vi.fn(),
    unsubscribe: vi.fn(),
    connectionState: 'disconnected'
  }),
  useWelcomeMessages: () => ({
    welcomeMessages: [],
    processWelcome: vi.fn()
  })
}));

// Import AFTER mocks are set up
import { MlsChatWindow } from './MlsChatWindow';

describe('MlsChatWindow context integration', () => {
  const defaultProps = {
    id: 'test-window',
    onClose: vi.fn(),
    onMinimize: vi.fn(),
    onFocus: vi.fn(),
    zIndex: 100
  };

  it('renders MlsChatProvider and children without context errors', async () => {
    // Suppress expected async warnings from setup hooks
    const consoleSpy = vi.spyOn(console, 'error').mockImplementation(() => {});

    render(<MlsChatWindow {...defaultProps} />);

    expect(screen.getByTestId('floating-window')).toBeInTheDocument();

    // Wait for the setup state to render
    await waitFor(() => {
      expect(screen.getByText('MLS Chat Setup')).toBeInTheDocument();
    });

    consoleSpy.mockRestore();
  });
});
