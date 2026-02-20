import {
  act,
  fireEvent,
  render,
  screen,
  waitFor
} from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { Chat } from './Chat';

// Mock useLLM hook
vi.mock('@/hooks/llm', () => ({
  useLLM: vi.fn(() => ({
    loadedModel: null,
    modelType: null,
    isLoading: false,
    loadProgress: null,
    error: null,
    isClassifying: false,
    loadModel: vi.fn(),
    unloadModel: vi.fn(),
    generate: vi.fn(),
    classify: vi.fn(),
    abort: vi.fn(),
    isWebGPUSupported: vi.fn().mockResolvedValue(true),
    previouslyLoadedModel: null
  }))
}));

// Mock useConversations hook
vi.mock('@/hooks/ai/useConversations', () => ({
  useConversations: vi.fn(() => ({
    conversations: [],
    loading: false,
    error: null,
    currentConversationId: null,
    currentMessages: [],
    currentSessionKey: null,
    messagesLoading: false,
    createConversation: vi.fn().mockResolvedValue('conv-123'),
    selectConversation: vi.fn().mockResolvedValue(undefined),
    renameConversation: vi.fn().mockResolvedValue(undefined),
    deleteConversation: vi.fn().mockResolvedValue(undefined),
    addMessage: vi.fn().mockResolvedValue(undefined),
    refetch: vi.fn().mockResolvedValue(undefined),
    clearCurrentConversation: vi.fn()
  }))
}));

// Mock database context
const mockUseDatabaseContext = vi.fn();
vi.mock('@/db/hooks', () => ({
  useDatabaseContext: () => mockUseDatabaseContext()
}));

// Mock InlineUnlock component
vi.mock('@/components/sqlite/InlineUnlock', () => ({
  InlineUnlock: ({ description }: { description: string }) => (
    <div data-testid="inline-unlock">Unlock {description}</div>
  )
}));

// Mock database
vi.mock('@/db', () => ({
  getDatabase: () => ({
    select: vi.fn()
  })
}));

// Mock key manager
const mockGetCurrentKey = vi.fn();
vi.mock('@/db/crypto', () => ({
  getKeyManager: () => ({
    getCurrentKey: mockGetCurrentKey
  })
}));

// Mock file storage
vi.mock('@/storage/opfs', () => ({
  getFileStorage: () => ({
    retrieve: vi.fn(),
    measureRetrieve: vi.fn()
  }),
  isFileStorageInitialized: () => true,
  initializeFileStorage: vi.fn(),
  createRetrieveLogger: () => vi.fn()
}));

// Mock llm-runtime
vi.mock('@/lib/llmRuntime', () => ({
  createLLMAdapter: vi.fn(() => ({})),
  getAttachedImage: () => null,
  setAttachedImage: vi.fn()
}));

// Mock assistant-ui components
vi.mock('@assistant-ui/react', () => ({
  AssistantRuntimeProvider: ({ children }: { children: React.ReactNode }) => (
    <div data-testid="assistant-runtime-provider">{children}</div>
  ),
  ThreadPrimitive: {
    Root: ({
      children,
      className
    }: {
      children: React.ReactNode;
      className?: string;
    }) => (
      <div data-testid="thread-root" className={className}>
        {children}
      </div>
    ),
    Viewport: ({
      children,
      className
    }: {
      children: React.ReactNode;
      className?: string;
    }) => (
      <div data-testid="thread-viewport" className={className}>
        {children}
      </div>
    ),
    Empty: ({ children }: { children: React.ReactNode }) => (
      <div data-testid="thread-empty">{children}</div>
    ),
    Messages: ({
      components
    }: {
      components?: {
        UserMessage?: React.ComponentType;
        AssistantMessage?: React.ComponentType;
      };
    }) => {
      const AssistantMsg = components?.AssistantMessage;
      return (
        <div data-testid="thread-messages">
          {AssistantMsg && <AssistantMsg />}
        </div>
      );
    }
  },
  MessagePrimitive: {
    Root: ({
      children,
      className
    }: {
      children: React.ReactNode;
      className?: string;
    }) => <div className={className}>{children}</div>,
    Content: ({
      components
    }: {
      components?: { Text?: React.ComponentType };
    }) => {
      const TextComponent = components?.Text;
      return (
        <span data-testid="message-content">
          {TextComponent ? <TextComponent /> : 'Message content'}
        </span>
      );
    }
  },
  MessagePartPrimitive: {
    Text: () => <span data-testid="message-part-text">Text content</span>,
    InProgress: ({ children }: { children: React.ReactNode }) => (
      <span data-testid="message-part-in-progress">{children}</span>
    )
  },
  ComposerPrimitive: {
    Root: ({
      children,
      className
    }: {
      children: React.ReactNode;
      className?: string;
    }) => (
      <div data-testid="composer" className={className}>
        {children}
      </div>
    ),
    Input: (props: React.InputHTMLAttributes<HTMLInputElement>) => (
      <input data-testid="composer-input" {...props} />
    ),
    Send: ({
      children,
      asChild
    }: {
      children: React.ReactNode;
      asChild?: boolean;
    }) =>
      asChild ? (
        <span data-testid="composer-send">{children}</span>
      ) : (
        <button data-testid="composer-send" type="submit">
          {children}
        </button>
      )
  },
  useLocalRuntime: vi.fn(() => ({}))
}));

function renderChat() {
  return render(
    <MemoryRouter>
      <Chat />
    </MemoryRouter>
  );
}

describe('conversation handlers', () => {
  const mockCreateConversation = vi.fn().mockResolvedValue('conv-123');
  const mockSelectConversation = vi.fn().mockResolvedValue(undefined);

  beforeEach(async () => {
    vi.clearAllMocks();
    mockUseDatabaseContext.mockReturnValue({
      isUnlocked: true,
      isLoading: false,
      currentInstanceId: 'test-instance'
    });
    mockGetCurrentKey.mockReturnValue(new Uint8Array([1, 2, 3, 4]));

    const { useConversations } = await import('@/hooks/ai/useConversations');
    vi.mocked(useConversations).mockReturnValue({
      conversations: [
        {
          id: 'conv-1',
          title: 'Test Conversation',
          createdAt: new Date().toISOString(),
          updatedAt: new Date().toISOString(),
          userId: 'user-1',
          organizationId: 'org-1',
          modelId: 'model-1',
          messageCount: 0
        }
      ],
      loading: false,
      error: null,
      currentConversationId: null,
      currentMessages: [],
      currentSessionKey: null,
      messagesLoading: false,
      createConversation: mockCreateConversation,
      selectConversation: mockSelectConversation,
      renameConversation: vi.fn().mockResolvedValue(undefined),
      deleteConversation: vi.fn().mockResolvedValue(undefined),
      addMessage: vi.fn().mockResolvedValue(undefined),
      refetch: vi.fn().mockResolvedValue(undefined),
      clearCurrentConversation: vi.fn()
    });
  });

  it('calls selectConversation when conversation is clicked', async () => {
    renderChat();

    const conversationButton = screen.getByText('Test Conversation');
    await act(async () => {
      fireEvent.click(conversationButton);
    });

    expect(mockSelectConversation).toHaveBeenCalledWith('conv-1');
  });

  it('calls createConversation when new conversation is confirmed', async () => {
    renderChat();

    const newButton = screen.getByTitle('New Conversation');
    await act(async () => {
      fireEvent.click(newButton);
    });

    await waitFor(() => {
      expect(screen.getByTestId('new-conversation-dialog')).toBeInTheDocument();
    });

    const createButton = screen.getByTestId('new-conversation-dialog-create');
    await act(async () => {
      fireEvent.click(createButton);
    });

    await waitFor(() => {
      expect(mockCreateConversation).toHaveBeenCalled();
    });
  });
});

describe('database loading state', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('shows loading message when database is loading', () => {
    mockUseDatabaseContext.mockReturnValue({
      isUnlocked: false,
      isLoading: true,
      currentInstanceId: null
    });

    renderChat();

    expect(screen.getByText('Loading database...')).toBeInTheDocument();
  });
});
