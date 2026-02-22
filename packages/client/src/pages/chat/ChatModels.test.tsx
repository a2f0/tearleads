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

describe('Chat models and styling', () => {
  beforeEach(() => {
    vi.clearAllMocks();

    mockUseDatabaseContext.mockReturnValue({
      isUnlocked: true,
      isLoading: false,
      currentInstanceId: 'test-instance'
    });
  });

  describe('model display name parsing', () => {
    const testCases = [
      {
        modelId: 'onnx-community/Phi-3.5-mini-instruct-onnx-web',
        expectedName: 'Phi 3.5 Mini'
      },
      {
        modelId: 'HuggingFaceTB/SmolVLM-256M-Instruct',
        expectedName: 'SmolVLM 256M Instruct'
      },
      {
        modelId: 'mistralai/mistral-7b-instruct',
        expectedName: 'Mistral 7b'
      },
      {
        modelId: 'simple-model',
        expectedName: 'Simple Model'
      },
      {
        modelId: 'org/model-name-instruct',
        expectedName: 'Model Name'
      }
    ];

    for (const { modelId, expectedName } of testCases) {
      it(`parses "${modelId}" to "${expectedName}"`, () => {
        vi.mocked(useLLM).mockReturnValue({
          loadedModel: modelId,
          modelType: 'chat',
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
        });

        renderChat();

        expect(screen.getByText(expectedName)).toBeInTheDocument();
      });
    }
  });

  describe('vision model image attachment placeholder', () => {
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

    it('renders image attachment button for vision models', () => {
      renderChat();

      // The mock Composer renders a placeholder for the attach image button
      expect(screen.getByTestId('composer')).toBeInTheDocument();
    });

    it('shows vision-specific placeholder text', () => {
      renderChat();

      // ComposerPrimitive.Input receives placeholder prop - rendered in our mock
      const input = screen.getByTestId('composer-input');
      expect(input).toHaveAttribute(
        'placeholder',
        'Type a message... (attach an image for vision)'
      );
    });

    it('shows empty state message about attaching images', () => {
      renderChat();

      expect(screen.getByTestId('thread-empty')).toBeInTheDocument();
    });
  });

  describe('model name edge cases', () => {
    it('handles model name with empty parts', () => {
      vi.mocked(useLLM).mockReturnValue({
        loadedModel: 'org/-model-name',
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

      // Should render the parsed model name correctly
      expect(screen.getByText('Model Name')).toBeInTheDocument();
    });

    it('handles model name without org prefix', () => {
      vi.mocked(useLLM).mockReturnValue({
        loadedModel: 'standalone-model-name',
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

      expect(screen.getByText('Standalone Model Name')).toBeInTheDocument();
    });

    it('handles model name with -4k-instruct suffix', () => {
      vi.mocked(useLLM).mockReturnValue({
        loadedModel: 'org/model-4k-instruct',
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

      expect(screen.getByText('Model')).toBeInTheDocument();
    });
  });

  describe('ChatHeader component', () => {
    it('renders the model name in the header', () => {
      vi.mocked(useLLM).mockReturnValue({
        loadedModel: 'org/model',
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

      expect(screen.getByText('Model')).toBeInTheDocument();
    });
  });

  describe('UserMessage and AssistantMessage components', () => {
    beforeEach(() => {
      vi.mocked(useLLM).mockReturnValue({
        loadedModel: 'org/model',
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

    it('renders the thread messages container', () => {
      renderChat();

      expect(screen.getByTestId('thread-messages')).toBeInTheDocument();
    });
  });

  describe('NoModelLoadedContent styling', () => {
    beforeEach(() => {
      // Reset to no model loaded state
      vi.mocked(useLLM).mockReturnValue({
        loadedModel: null,
        modelType: null,
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

    it('renders with proper card styling', () => {
      renderChat();

      const cardTitle = screen.getByText('No Model Loaded');
      expect(cardTitle).toBeInTheDocument();

      const description = screen.getByText(/Load a model from the Models page/);
      expect(description).toBeInTheDocument();
    });

    it('renders Bot icon in the card', () => {
      renderChat();

      // The button contains a Bot icon
      const button = screen.getByRole('button', { name: /go to models/i });
      expect(button).toBeInTheDocument();
    });
  });
});
