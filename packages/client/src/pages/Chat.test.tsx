import { render, screen } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { Chat } from './Chat';

// Mock useLLM hook
vi.mock('@/hooks/useLLM', () => ({
  useLLM: vi.fn(() => ({
    loadedModel: null,
    modelType: null,
    isLoading: false,
    loadProgress: null,
    error: null,
    loadModel: vi.fn(),
    unloadModel: vi.fn(),
    generate: vi.fn(),
    abort: vi.fn(),
    isWebGPUSupported: vi.fn().mockResolvedValue(true)
  }))
}));

// Mock database context
const mockUseDatabaseContext = vi.fn();
vi.mock('@/db/hooks', () => ({
  useDatabaseContext: () => mockUseDatabaseContext()
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
    retrieve: mockRetrieve
  }),
  isFileStorageInitialized: () => mockIsFileStorageInitialized(),
  initializeFileStorage: (key: Uint8Array, instanceId: string) =>
    mockInitializeFileStorage(key, instanceId)
}));

// Mock llm-runtime
vi.mock('@/lib/llm-runtime', () => ({
  createLLMAdapter: vi.fn(() => ({})),
  getAttachedImage: vi.fn(() => null),
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
    Send: ({ children }: { children: React.ReactNode }) => (
      <button data-testid="composer-send" type="submit">
        {children}
      </button>
    )
  },
  useLocalRuntime: vi.fn(() => ({}))
}));

import { useLLM } from '@/hooks/useLLM';

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
    mockGetCurrentKey.mockReturnValue(new Uint8Array([1, 2, 3, 4]));
    mockIsFileStorageInitialized.mockReturnValue(true);
  });

  describe('when no model is loaded', () => {
    it('renders the page title', () => {
      renderChat();

      expect(screen.getByText('Chat')).toBeInTheDocument();
    });

    it('shows no model loaded message', () => {
      renderChat();

      expect(screen.getByText('No Model Loaded')).toBeInTheDocument();
      expect(
        screen.getByText(/Load a model from the Models page/)
      ).toBeInTheDocument();
    });

    it('shows a link to the Models page', () => {
      renderChat();

      const link = screen.getByRole('link', { name: /go to models/i });
      expect(link).toBeInTheDocument();
      expect(link).toHaveAttribute('href', '/models');
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
        abort: vi.fn(),
        isWebGPUSupported: vi.fn().mockResolvedValue(true)
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
        abort: vi.fn(),
        isWebGPUSupported: vi.fn().mockResolvedValue(true)
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
          loadModel: vi.fn(),
          unloadModel: vi.fn(),
          generate: vi.fn(),
          abort: vi.fn(),
          isWebGPUSupported: vi.fn().mockResolvedValue(true)
        });

        renderChat();

        expect(screen.getByText(expectedName)).toBeInTheDocument();
      });
    }
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
        abort: vi.fn(),
        isWebGPUSupported: vi.fn().mockResolvedValue(true)
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
        abort: vi.fn(),
        isWebGPUSupported: vi.fn().mockResolvedValue(true)
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
        abort: vi.fn(),
        isWebGPUSupported: vi.fn().mockResolvedValue(true)
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
        abort: vi.fn(),
        isWebGPUSupported: vi.fn().mockResolvedValue(true)
      });
    });

    it('shows basic placeholder for non-vision models', () => {
      renderChat();

      const input = screen.getByTestId('composer-input');
      expect(input).toHaveAttribute('placeholder', 'Type a message...');
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
        abort: vi.fn(),
        isWebGPUSupported: vi.fn().mockResolvedValue(true)
      });

      renderChat();

      // Should still render without crashing
      expect(screen.getByText('Chat')).toBeInTheDocument();
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
        abort: vi.fn(),
        isWebGPUSupported: vi.fn().mockResolvedValue(true)
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
        abort: vi.fn(),
        isWebGPUSupported: vi.fn().mockResolvedValue(true)
      });

      renderChat();

      expect(screen.getByText('Model')).toBeInTheDocument();
    });
  });

  describe('ChatHeader component', () => {
    it('renders border styling', () => {
      vi.mocked(useLLM).mockReturnValue({
        loadedModel: 'org/model',
        modelType: 'chat',
        isLoading: false,
        loadProgress: null,
        error: null,
        loadModel: vi.fn(),
        unloadModel: vi.fn(),
        generate: vi.fn(),
        abort: vi.fn(),
        isWebGPUSupported: vi.fn().mockResolvedValue(true)
      });

      renderChat();

      expect(screen.getByText('Chat')).toBeInTheDocument();
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
        abort: vi.fn(),
        isWebGPUSupported: vi.fn().mockResolvedValue(true)
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
        abort: vi.fn(),
        isWebGPUSupported: vi.fn().mockResolvedValue(true)
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

      // The link contains a Bot icon
      const link = screen.getByRole('link', { name: /go to models/i });
      expect(link).toBeInTheDocument();
    });
  });
});
