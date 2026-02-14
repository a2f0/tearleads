import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { useEffect } from 'react';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { ChatWindow } from './ChatWindow';

const mockMountCallback = vi.fn();
const mockCreateConversation = vi.fn();
const mockSelectConversation = vi.fn();
const mockRenameConversation = vi.fn();
const mockDeleteConversation = vi.fn();

vi.mock('@/hooks/useLLM', () => ({
  useLLM: vi.fn(() => ({
    loadedModel: null,
    modelType: null,
    generate: vi.fn()
  }))
}));

vi.mock('@/hooks/useConversations', () => ({
  useConversations: () => ({
    conversations: [],
    loading: false,
    error: null,
    currentConversationId: null,
    selectConversation: mockSelectConversation,
    createConversation: mockCreateConversation,
    renameConversation: mockRenameConversation,
    deleteConversation: mockDeleteConversation
  })
}));

vi.mock('@tearleads/window-manager', async (importOriginal) => {
  const actual =
    await importOriginal<typeof import('@tearleads/window-manager')>();

  return {
    ...actual,
  DesktopFloatingWindow: ({
    children,
    title,
    onClose
  }: {
    children: React.ReactNode;
    title: string;
    onClose: () => void;
  }) => (
    <div data-testid="floating-window">
      <div data-testid="window-title">{title}</div>
      <button type="button" onClick={onClose} data-testid="close-window">
        Close
      </button>
      {children}
    </div>
  )
  };
});

vi.mock('@/pages/chat/ChatInterface', () => ({
  ChatInterface: (_props: { generate: () => void }) => {
    useEffect(() => {
      mockMountCallback();
    }, []);
    return <div data-testid="chat-interface">Chat Interface</div>;
  }
}));

vi.mock('@/pages/chat/ConversationsSidebar', () => ({
  ConversationsSidebar: ({
    onNewConversation,
    onConversationSelect
  }: {
    onNewConversation: () => Promise<void>;
    onConversationSelect: (id: string | null) => Promise<void>;
  }) => (
    <div data-testid="conversations-sidebar">
      <button
        type="button"
        onClick={() => void onNewConversation()}
        data-testid="sidebar-new-conversation"
      >
        New
      </button>
      <button
        type="button"
        onClick={() => void onConversationSelect('conv-123')}
        data-testid="select-conversation"
      >
        Select
      </button>
    </div>
  )
}));

vi.mock('@/pages/chat/NoModelLoadedContent', () => ({
  NoModelLoadedContent: ({ onOpenModels }: { onOpenModels?: () => void }) => (
    <div data-testid="no-model-content">
      <button type="button" onClick={onOpenModels} data-testid="open-models">
        Open Models
      </button>
    </div>
  )
}));

vi.mock('@/pages/models/ModelsContent', () => ({
  ModelsContent: () => <div data-testid="models-content">Models Content</div>
}));

vi.mock('./ChatWindowMenuBar', () => ({
  ChatWindowMenuBar: ({
    onNewChat,
    onClose
  }: {
    onNewChat: () => void | Promise<void>;
    onClose: () => void;
    modelDisplayName?: string | undefined;
  }) => (
    <div data-testid="menu-bar">
      <button
        type="button"
        onClick={() => void onNewChat()}
        data-testid="new-chat-button"
      >
        New Chat
      </button>
      <button type="button" onClick={onClose} data-testid="menu-close-button">
        Close
      </button>
    </div>
  )
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

describe('ChatWindow', () => {
  const defaultProps = {
    id: 'test-window',
    onClose: vi.fn(),
    onMinimize: vi.fn(),
    onFocus: vi.fn(),
    zIndex: 100
  };

  beforeEach(() => {
    vi.clearAllMocks();
    mockUseDatabaseContext.mockReturnValue({
      isUnlocked: true,
      isLoading: false,
      currentInstanceId: 'test-instance'
    });
  });

  it('renders in FloatingWindow', () => {
    render(<ChatWindow {...defaultProps} />);
    expect(screen.getByTestId('floating-window')).toBeInTheDocument();
  });

  it('shows title as "AI" when no model loaded', () => {
    render(<ChatWindow {...defaultProps} />);
    expect(screen.getByTestId('window-title')).toHaveTextContent('AI');
  });

  it('renders conversations sidebar', () => {
    render(<ChatWindow {...defaultProps} />);
    expect(screen.getByTestId('conversations-sidebar')).toBeInTheDocument();
  });

  it('selects conversation when clicked in sidebar', async () => {
    const user = userEvent.setup();
    render(<ChatWindow {...defaultProps} />);

    await user.click(screen.getByTestId('select-conversation'));

    await waitFor(() => {
      expect(mockSelectConversation).toHaveBeenCalledWith('conv-123');
    });
  });

  it('returns to chat view when back button is clicked', async () => {
    const user = userEvent.setup();
    render(<ChatWindow {...defaultProps} />);

    // First open models
    await user.click(screen.getByTestId('open-models'));
    expect(screen.getByTestId('models-content')).toBeInTheDocument();

    // Then click back button
    await user.click(screen.getByRole('button', { name: /back to ai/i }));

    await waitFor(() => {
      expect(screen.queryByTestId('models-content')).not.toBeInTheDocument();
    });
  });

  it('shows NoModelLoadedContent when no model loaded', () => {
    render(<ChatWindow {...defaultProps} />);
    expect(screen.getByTestId('no-model-content')).toBeInTheDocument();
    expect(screen.queryByTestId('chat-interface')).not.toBeInTheDocument();
  });

  it('opens models inside the window when requested', async () => {
    const user = userEvent.setup();
    render(<ChatWindow {...defaultProps} />);

    await user.click(screen.getByTestId('open-models'));

    expect(screen.getByTestId('models-content')).toBeInTheDocument();
    expect(screen.queryByTestId('no-model-content')).not.toBeInTheDocument();
  });

  it('shows ChatInterface when model is loaded', async () => {
    const { useLLM } = await import('@/hooks/useLLM');
    vi.mocked(useLLM).mockReturnValue({
      loadedModel: 'test-org/Test-Model-instruct',
      modelType: 'chat',
      generate: vi.fn(),
      loadModel: vi.fn(),
      unloadModel: vi.fn(),
      abort: vi.fn(),
      classify: vi.fn(),
      isWebGPUSupported: vi.fn(),
      isLoading: false,
      loadProgress: null,
      error: null,
      isClassifying: false,
      previouslyLoadedModel: null
    });

    render(<ChatWindow {...defaultProps} />);
    expect(screen.getByTestId('chat-interface')).toBeInTheDocument();
    expect(screen.queryByTestId('no-model-content')).not.toBeInTheDocument();
  });

  it('shows model name in title when loaded', async () => {
    const { useLLM } = await import('@/hooks/useLLM');
    vi.mocked(useLLM).mockReturnValue({
      loadedModel: 'test-org/Test-Model-instruct',
      modelType: 'chat',
      generate: vi.fn(),
      loadModel: vi.fn(),
      unloadModel: vi.fn(),
      abort: vi.fn(),
      classify: vi.fn(),
      isWebGPUSupported: vi.fn(),
      isLoading: false,
      loadProgress: null,
      error: null,
      isClassifying: false,
      previouslyLoadedModel: null
    });

    render(<ChatWindow {...defaultProps} />);
    expect(screen.getByTestId('window-title')).toHaveTextContent(
      'AI - Test Model'
    );
  });

  it('calls onClose when close button is clicked', async () => {
    const user = userEvent.setup();
    const onClose = vi.fn();
    render(<ChatWindow {...defaultProps} onClose={onClose} />);

    await user.click(screen.getByTestId('close-window'));
    expect(onClose).toHaveBeenCalled();
  });

  it('renders menu bar', () => {
    render(<ChatWindow {...defaultProps} />);
    expect(screen.getByTestId('menu-bar')).toBeInTheDocument();
  });

  it('creates new conversation when New Chat is clicked', async () => {
    const { useLLM } = await import('@/hooks/useLLM');
    const mockGenerate = vi.fn();
    vi.mocked(useLLM).mockReturnValue({
      loadedModel: 'test-org/Test-Model-instruct',
      modelType: 'chat',
      generate: mockGenerate,
      loadModel: vi.fn(),
      unloadModel: vi.fn(),
      abort: vi.fn(),
      classify: vi.fn(),
      isWebGPUSupported: vi.fn(),
      isLoading: false,
      loadProgress: null,
      error: null,
      isClassifying: false,
      previouslyLoadedModel: null
    });

    const user = userEvent.setup();
    render(<ChatWindow {...defaultProps} />);

    expect(screen.getByTestId('chat-interface')).toBeInTheDocument();

    await user.click(screen.getByTestId('new-chat-button'));

    await waitFor(() => {
      expect(mockCreateConversation).toHaveBeenCalled();
    });
  });

  it('passes initialDimensions to FloatingWindow when provided', () => {
    render(
      <ChatWindow
        {...defaultProps}
        initialDimensions={{ x: 100, y: 200, width: 600, height: 500 }}
      />
    );
    expect(screen.getByTestId('floating-window')).toBeInTheDocument();
  });

  it('handles model name without org prefix', async () => {
    const { useLLM } = await import('@/hooks/useLLM');
    vi.mocked(useLLM).mockReturnValue({
      loadedModel: 'Simple-Model',
      modelType: 'chat',
      generate: vi.fn(),
      loadModel: vi.fn(),
      unloadModel: vi.fn(),
      abort: vi.fn(),
      classify: vi.fn(),
      isWebGPUSupported: vi.fn(),
      isLoading: false,
      loadProgress: null,
      error: null,
      isClassifying: false,
      previouslyLoadedModel: null
    });

    render(<ChatWindow {...defaultProps} />);
    expect(screen.getByTestId('window-title')).toHaveTextContent(
      'AI - Simple Model'
    );
  });

  it('handles model name with empty parts from consecutive dashes', async () => {
    const { useLLM } = await import('@/hooks/useLLM');
    vi.mocked(useLLM).mockReturnValue({
      loadedModel: 'org/Test--Model',
      modelType: 'chat',
      generate: vi.fn(),
      loadModel: vi.fn(),
      unloadModel: vi.fn(),
      abort: vi.fn(),
      classify: vi.fn(),
      isWebGPUSupported: vi.fn(),
      isLoading: false,
      loadProgress: null,
      error: null,
      isClassifying: false,
      previouslyLoadedModel: null
    });

    render(<ChatWindow {...defaultProps} />);
    expect(screen.getByTestId('window-title')).toHaveTextContent(
      'AI - Test Model'
    );
  });
});
