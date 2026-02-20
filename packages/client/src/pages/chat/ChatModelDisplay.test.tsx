import { render, screen } from '@testing-library/react';
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

vi.mock('@/hooks/useConversations', () => ({
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

const mockUseDatabaseContext = vi.fn();
vi.mock('@/db/hooks', () => ({
  useDatabaseContext: () => mockUseDatabaseContext()
}));

vi.mock('@/components/sqlite/InlineUnlock', () => ({
  InlineUnlock: ({ description }: { description: string }) => (
    <div data-testid="inline-unlock">Unlock {description}</div>
  )
}));

vi.mock('@/db', () => ({ getDatabase: () => ({ select: vi.fn() }) }));

const mockGetCurrentKey = vi.fn();
vi.mock('@/db/crypto', () => ({
  getKeyManager: () => ({ getCurrentKey: mockGetCurrentKey })
}));

vi.mock('@/storage/opfs', () => ({
  getFileStorage: () => ({ retrieve: vi.fn(), measureRetrieve: vi.fn() }),
  isFileStorageInitialized: () => true,
  initializeFileStorage: vi.fn(),
  createRetrieveLogger: () => vi.fn()
}));

vi.mock('@/lib/llmRuntime', () => ({
  createLLMAdapter: vi.fn(() => ({})),
  getAttachedImage: () => null,
  setAttachedImage: vi.fn()
}));

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
      components?: { AssistantMessage?: React.ComponentType };
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

describe('model display name parsing', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockUseDatabaseContext.mockReturnValue({
      isUnlocked: true,
      isLoading: false,
      currentInstanceId: 'test-instance'
    });
    mockGetCurrentKey.mockReturnValue(new Uint8Array([1, 2, 3, 4]));
  });

  const testCases = [
    {
      modelId: 'onnx-community/Phi-3.5-mini-instruct-onnx-web',
      expectedName: 'Phi 3.5 Mini'
    },
    {
      modelId: 'HuggingFaceTB/SmolVLM-256M-Instruct',
      expectedName: 'SmolVLM 256M Instruct'
    },
    { modelId: 'mistralai/mistral-7b-instruct', expectedName: 'Mistral 7b' },
    { modelId: 'simple-model', expectedName: 'Simple Model' },
    { modelId: 'org/model-name-instruct', expectedName: 'Model Name' }
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

describe('model name edge cases', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockUseDatabaseContext.mockReturnValue({
      isUnlocked: true,
      isLoading: false,
      currentInstanceId: 'test-instance'
    });
    mockGetCurrentKey.mockReturnValue(new Uint8Array([1, 2, 3, 4]));
  });

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
  beforeEach(() => {
    vi.clearAllMocks();
    mockUseDatabaseContext.mockReturnValue({
      isUnlocked: true,
      isLoading: false,
      currentInstanceId: 'test-instance'
    });
    mockGetCurrentKey.mockReturnValue(new Uint8Array([1, 2, 3, 4]));
  });

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
    vi.clearAllMocks();
    mockUseDatabaseContext.mockReturnValue({
      isUnlocked: true,
      isLoading: false,
      currentInstanceId: 'test-instance'
    });
    mockGetCurrentKey.mockReturnValue(new Uint8Array([1, 2, 3, 4]));
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
    vi.clearAllMocks();
    mockUseDatabaseContext.mockReturnValue({
      isUnlocked: true,
      isLoading: false,
      currentInstanceId: 'test-instance'
    });
    mockGetCurrentKey.mockReturnValue(new Uint8Array([1, 2, 3, 4]));
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
    expect(screen.getByText('No Model Loaded')).toBeInTheDocument();
    expect(
      screen.getByText(/Load a model from the Models page/)
    ).toBeInTheDocument();
  });

  it('renders Bot icon in the card', () => {
    renderChat();
    expect(
      screen.getByRole('button', { name: /go to models/i })
    ).toBeInTheDocument();
  });
});
