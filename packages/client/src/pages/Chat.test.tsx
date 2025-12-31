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
    Messages: () => <div data-testid="thread-messages">Messages</div>
  },
  MessagePrimitive: {
    Root: ({
      children,
      className
    }: {
      children: React.ReactNode;
      className?: string;
    }) => <div className={className}>{children}</div>,
    Content: () => <span>Message content</span>
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
        loadedModel: 'onnx-community/Phi-3.5-vision-instruct',
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

      expect(screen.getByText('Phi 3.5 Vision')).toBeInTheDocument();
    });
  });
});
