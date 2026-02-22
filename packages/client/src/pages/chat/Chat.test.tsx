import { render, screen } from '@testing-library/react';
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
vi.mock('@/db', () => ({
  getDatabase: () => ({
    select: vi.fn()
  })
}));

// Mock key manager
vi.mock('@/db/crypto', () => ({
  getKeyManager: () => ({
    getCurrentKey: vi.fn()
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

import { useLLM } from '@/hooks/llm';

function renderChat() {
  return render(
    <MemoryRouter>
      <Chat />
    </MemoryRouter>
  );
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
  });

  describe('when no model is loaded', () => {
    it('renders the page title', () => {
      renderChat();

      expect(screen.getByText('AI')).toBeInTheDocument();
    });

    it('shows no model loaded message', () => {
      renderChat();

      expect(screen.getByText('No Model Loaded')).toBeInTheDocument();
      expect(
        screen.getByText(/Load a model from the Models page/)
      ).toBeInTheDocument();
    });

    it('shows a button to navigate to the Models page', () => {
      renderChat();

      const button = screen.getByRole('button', { name: /go to models/i });
      expect(button).toBeInTheDocument();
    });
  });

  describe('when a model is loaded', () => {
    beforeEach(() => {
      vi.mocked(useLLM).mockReturnValue({
        loadedModel: 'onnx-community/Phi-3.5-mini-instruct-onnx-web',
        modelType: 'chat',
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

    it('renders the chat interface', () => {
      renderChat();

      expect(screen.getByTestId('thread-root')).toBeInTheDocument();
    });

    it('shows the loaded model name', () => {
      renderChat();

      expect(screen.getByText('Phi 3.5 Mini')).toBeInTheDocument();
    });

    it('does not show the no model loaded message', () => {
      renderChat();

      expect(screen.queryByText('No Model Loaded')).not.toBeInTheDocument();
    });

    it('renders the composer input', () => {
      renderChat();

      expect(screen.getByTestId('composer-input')).toBeInTheDocument();
    });

    it('stretches the chat interface to fill the window', () => {
      renderChat();

      const container = screen.getByTestId('chat-interface-container');

      expect(container).toHaveClass('h-full flex flex-col');
    });
  });

  describe('when a vision model is loaded', () => {
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

    it('shows the vision model name', () => {
      renderChat();

      expect(screen.getByText('SmolVLM 256M Instruct')).toBeInTheDocument();
    });

    it('renders chat interface with thread empty state', () => {
      renderChat();

      expect(screen.getByTestId('thread-empty')).toBeInTheDocument();
    });

    it('renders the composer for vision models', () => {
      renderChat();

      expect(screen.getByTestId('composer')).toBeInTheDocument();
    });
  });

  describe('when a paligemma model is loaded', () => {
    beforeEach(() => {
      vi.mocked(useLLM).mockReturnValue({
        loadedModel: 'google/paligemma-model',
        modelType: 'paligemma',
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

    it('renders the chat interface', () => {
      renderChat();

      expect(screen.getByTestId('thread-root')).toBeInTheDocument();
    });

    it('shows the model name', () => {
      renderChat();

      expect(screen.getByText('Paligemma Model')).toBeInTheDocument();
    });
  });

  describe('CustomText loading spinner', () => {
    beforeEach(() => {
      vi.mocked(useLLM).mockReturnValue({
        loadedModel: 'onnx-community/Phi-3.5-mini-instruct-onnx-web',
        modelType: 'chat',
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
      renderChat();
    });

    it('renders the message content with custom text component', () => {
      expect(screen.getByTestId('message-content')).toBeInTheDocument();
    });

    it('renders the text part primitive', () => {
      expect(screen.getByTestId('message-part-text')).toBeInTheDocument();
    });

    it('renders the in-progress indicator container', () => {
      expect(
        screen.getByTestId('message-part-in-progress')
      ).toBeInTheDocument();
    });

    it('renders the animated spinner inside in-progress indicator', () => {
      const inProgressContainer = screen.getByTestId(
        'message-part-in-progress'
      );
      const spinner = inProgressContainer.querySelector('.animate-spin');
      expect(spinner).toBeInTheDocument();
    });
  });

  describe('non-vision model composer', () => {
    beforeEach(() => {
      vi.mocked(useLLM).mockReturnValue({
        loadedModel: 'onnx-community/Phi-3-mini-4k-instruct',
        modelType: 'chat',
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

    it('shows basic placeholder for non-vision models', () => {
      renderChat();

      const input = screen.getByTestId('composer-input');
      expect(input).toHaveAttribute('placeholder', 'Type a message...');
    });
  });

  describe('database loading state', () => {
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
});
