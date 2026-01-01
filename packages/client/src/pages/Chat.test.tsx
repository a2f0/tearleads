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

    it('renders the chat interface', () => {
      renderChat();

      expect(screen.getByTestId('thread-root')).toBeInTheDocument();
    });

    it('shows the loaded model name', () => {
      renderChat();

      expect(screen.getByText('Phi 3 Mini')).toBeInTheDocument();
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
        modelId: 'onnx-community/Phi-3-mini-4k-instruct',
        expectedName: 'Phi 3 Mini'
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

    it('renders the message content with custom text component', () => {
      renderChat();

      expect(screen.getByTestId('message-content')).toBeInTheDocument();
    });

    it('renders the text part primitive', () => {
      renderChat();

      expect(screen.getByTestId('message-part-text')).toBeInTheDocument();
    });

    it('renders the in-progress indicator container', () => {
      renderChat();

      expect(
        screen.getByTestId('message-part-in-progress')
      ).toBeInTheDocument();
    });

    it('renders the animated spinner inside in-progress indicator', () => {
      renderChat();

      const inProgressContainer = screen.getByTestId(
        'message-part-in-progress'
      );
      const spinner = inProgressContainer.querySelector('.animate-spin');
      expect(spinner).toBeInTheDocument();
    });
  });
});
