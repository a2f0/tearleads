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

// Hoisted mock for useLLM - enables vi.mocked() usage in tests
const mockUseLLM = vi.hoisted(() =>
  vi.fn(() => ({
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
);

// Mock @/hooks/llm for direct imports in tests
vi.mock('@/hooks/llm', () => ({
  useLLM: mockUseLLM
}));

// Mock useConversations and useLLM hooks for ClientAIProvider
vi.mock('@/hooks/ai', () => ({
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
  })),
  useLLM: mockUseLLM
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
const mockSelect = vi.fn();
vi.mock('@/db', () => ({
  getDatabase: () => ({
    select: mockSelect
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
const mockRetrieve = vi.fn();
const mockIsFileStorageInitialized = vi.fn();
const mockInitializeFileStorage = vi.fn();
vi.mock('@/storage/opfs', () => ({
  getFileStorage: () => ({
    retrieve: mockRetrieve,
    measureRetrieve: mockRetrieve
  }),
  isFileStorageInitialized: () => mockIsFileStorageInitialized(),
  initializeFileStorage: (key: Uint8Array, instanceId: string) =>
    mockInitializeFileStorage(key, instanceId),
  createRetrieveLogger: () => vi.fn()
}));

// Mock llm-runtime
const mockSetAttachedImage = vi.fn();
const mockGetAttachedImage = vi.fn((): string | null => null);
vi.mock('@/lib/llmRuntime', () => ({
  createLLMAdapter: vi.fn(() => ({})),
  getAttachedImage: () => mockGetAttachedImage(),
  setAttachedImage: (img: string | null) => mockSetAttachedImage(img)
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

import { useLLM } from '@/hooks/llm';

function renderChat() {
  return render(
    <MemoryRouter>
      <Chat />
    </MemoryRouter>
  );
}

function findImageButton(): HTMLElement {
  return screen.getByRole('button', { name: /attach image/i });
}

function findCloseButton(): HTMLElement {
  return screen.getByRole('button', { name: /close/i });
}

describe('Chat', () => {

  beforeEach(() => {
    vi.clearAllMocks();

    // Default mocks for database context
    mockUseDatabaseContext.mockReturnValue({
      isUnlocked: true,
      isLoading: false,
      currentInstanceId: 'test-instance'
    });
    mockGetCurrentKey.mockReturnValue(new Uint8Array([1, 2, 3, 4]));
    mockIsFileStorageInitialized.mockReturnValue(true);
  });

  describe('PhotoPicker component', () => {
    beforeEach(() => {
      vi.mocked(useLLM).mockReturnValue({
        loadedModel: 'HuggingFaceTB/SmolVLM-256M-Instruct',
        modelType: 'vision',
        isLoading: false,
        loadProgress: null,
        error: null,
        loadModel: vi.fn(),
        unloadModel: vi.fn(),
        generate: vi.fn(),
        classify: vi.fn(),
        abort: vi.fn(),
        isWebGPUSupported: vi.fn().mockResolvedValue(true),
        isClassifying: false,
        previouslyLoadedModel: null
      });
    });

    it('opens photo picker when attach image button is clicked', async () => {
      // Set up mock to return photos
      mockSelect.mockReturnValue({
        from: vi.fn().mockReturnValue({
          where: vi.fn().mockReturnValue({
            orderBy: vi.fn().mockReturnValue({
              limit: vi.fn().mockResolvedValue([])
            })
          })
        })
      });

      renderChat();

      const imageButton = findImageButton();

      await act(async () => {
        fireEvent.click(imageButton);
      });

      // Wait for the photo picker to appear
      await waitFor(() => {
        expect(screen.getByText('Select a Photo')).toBeInTheDocument();
      });
    });

    it('shows loading state when fetching photos', async () => {
      // Set up a delayed mock
      mockSelect.mockReturnValue({
        from: vi.fn().mockReturnValue({
          where: vi.fn().mockReturnValue({
            orderBy: vi.fn().mockReturnValue({
              limit: vi
                .fn()
                .mockImplementation(
                  () =>
                    new Promise((resolve) => setTimeout(() => resolve([]), 100))
                )
            })
          })
        })
      });

      renderChat();

      const imageButton = findImageButton();

      await act(async () => {
        fireEvent.click(imageButton);
      });

      // Should show loading state
      await waitFor(() => {
        expect(screen.getByText(/Loading photos/)).toBeInTheDocument();
      });
    });

    it('shows empty state when no photos available', async () => {
      mockSelect.mockReturnValue({
        from: vi.fn().mockReturnValue({
          where: vi.fn().mockReturnValue({
            orderBy: vi.fn().mockReturnValue({
              limit: vi.fn().mockResolvedValue([])
            })
          })
        })
      });

      renderChat();

      const imageButton = findImageButton();

      await act(async () => {
        fireEvent.click(imageButton);
      });

      await waitFor(() => {
        expect(screen.getByText(/No photos found/)).toBeInTheDocument();
      });
    });

    it('shows lock screen when database is not unlocked', async () => {
      // When database is not unlocked, show the lock screen instead of the chat interface
      mockUseDatabaseContext.mockReturnValue({
        isUnlocked: false,
        isLoading: false,
        currentInstanceId: null
      });

      renderChat();

      // Should show the InlineUnlock component since database is locked
      expect(screen.getByTestId('inline-unlock')).toBeInTheDocument();
    });

    it('closes photo picker when close button is clicked', async () => {
      mockSelect.mockReturnValue({
        from: vi.fn().mockReturnValue({
          where: vi.fn().mockReturnValue({
            orderBy: vi.fn().mockReturnValue({
              limit: vi.fn().mockResolvedValue([])
            })
          })
        })
      });

      renderChat();

      const imageButton = findImageButton();

      await act(async () => {
        fireEvent.click(imageButton);
      });

      await waitFor(() => {
        expect(screen.getByText('Select a Photo')).toBeInTheDocument();
      });

      // Find and click the close button (X button in the header)
      const closeButton = findCloseButton();

      await act(async () => {
        fireEvent.click(closeButton);
      });

      await waitFor(() => {
        expect(screen.queryByText('Select a Photo')).not.toBeInTheDocument();
      });
    });

    it('shows error when encryption key is not available', async () => {
      mockGetCurrentKey.mockReturnValue(null);
      mockSelect.mockReturnValue({
        from: vi.fn().mockReturnValue({
          where: vi.fn().mockReturnValue({
            orderBy: vi.fn().mockReturnValue({
              limit: vi.fn().mockResolvedValue([
                {
                  id: '1',
                  name: 'test.jpg',
                  storagePath: '/photos/test.jpg',
                  thumbnailPath: '/photos/thumb_test.jpg'
                }
              ])
            })
          })
        })
      });

      renderChat();

      const imageButton = findImageButton();

      await act(async () => {
        fireEvent.click(imageButton);
      });

      await waitFor(() => {
        expect(screen.getByText(/Database not unlocked/)).toBeInTheDocument();
      });
    });

    it('shows error when no active instance', async () => {
      mockUseDatabaseContext.mockReturnValue({
        isUnlocked: true,
        isLoading: false,
        currentInstanceId: null
      });
      mockSelect.mockReturnValue({
        from: vi.fn().mockReturnValue({
          where: vi.fn().mockReturnValue({
            orderBy: vi.fn().mockReturnValue({
              limit: vi.fn().mockResolvedValue([
                {
                  id: '1',
                  name: 'test.jpg',
                  storagePath: '/photos/test.jpg',
                  thumbnailPath: '/photos/thumb_test.jpg'
                }
              ])
            })
          })
        })
      });

      renderChat();

      const imageButton = findImageButton();

      await act(async () => {
        fireEvent.click(imageButton);
      });

      await waitFor(() => {
        expect(screen.getByText(/No active instance/)).toBeInTheDocument();
      });
    });

  });
});
