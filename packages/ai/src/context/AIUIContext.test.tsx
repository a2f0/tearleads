import { render, screen } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';
import {
  type AIUIComponents,
  AIUIProvider,
  type ConversationsState,
  type ImageAttachmentOps,
  type LLMState,
  useAIUIContext
} from './AIUIContext';

const mockLlmState: LLMState = {
  loadedModel: null,
  modelType: null,
  isLoading: false,
  loadProgress: null,
  error: null,
  generate: vi.fn(),
  abort: vi.fn()
};

const mockConversationsState: ConversationsState = {
  list: [],
  loading: false,
  error: null,
  currentId: null,
  select: vi.fn(),
  create: vi.fn(),
  rename: vi.fn(),
  delete: vi.fn()
};

const mockImageAttachment: ImageAttachmentOps = {
  getAttachedImage: vi.fn(() => null),
  setAttachedImage: vi.fn()
};

const mockUIComponents: AIUIComponents = {
  Button: ({ children }) => <button type="button">{children}</button>,
  Input: (props) => <input {...props} />,
  InlineUnlock: () => <div>InlineUnlock</div>,
  DropdownMenu: ({ children }) => <div>{children}</div>,
  DropdownMenuItem: ({ children }) => <div>{children}</div>,
  DropdownMenuSeparator: () => <hr />,
  WindowOptionsMenuItem: () => <div>WindowOptionsMenuItem</div>,
  ModelSelector: () => <div>ModelSelector</div>
};

function TestConsumer() {
  const { llm, conversations, databaseState } = useAIUIContext();
  return (
    <div>
      <span data-testid="is-unlocked">{String(databaseState.isUnlocked)}</span>
      <span data-testid="loaded-model">{llm.loadedModel ?? 'none'}</span>
      <span data-testid="conversations-count">{conversations.list.length}</span>
    </div>
  );
}

describe('AIUIContext', () => {
  it('provides context values to consumers', () => {
    render(
      <AIUIProvider
        databaseState={{
          isUnlocked: true,
          isLoading: false,
          currentInstanceId: 'test'
        }}
        ui={mockUIComponents}
        t={(key) => key}
        llm={mockLlmState}
        conversations={mockConversationsState}
        imageAttachment={mockImageAttachment}
        logError={vi.fn()}
        logWarn={vi.fn()}
      >
        <TestConsumer />
      </AIUIProvider>
    );

    expect(screen.getByTestId('is-unlocked')).toHaveTextContent('true');
    expect(screen.getByTestId('loaded-model')).toHaveTextContent('none');
    expect(screen.getByTestId('conversations-count')).toHaveTextContent('0');
  });

  it('throws when used outside provider', () => {
    const consoleError = vi
      .spyOn(console, 'error')
      .mockImplementation(() => {});
    expect(() => render(<TestConsumer />)).toThrow(
      'useAIUIContext must be used within an AIUIProvider'
    );
    consoleError.mockRestore();
  });
});
