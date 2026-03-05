import type { DecryptedAiConversation } from '@tearleads/shared';
import { renderHook, waitFor } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';

vi.mock('./conversationResumeStorage', () => ({
  readLastConversationId: vi.fn()
}));

import { readLastConversationId } from './conversationResumeStorage';
import { useConversationBootstrap } from './useConversationBootstrap';

interface DeferredPromise<T> {
  promise: Promise<T>;
  resolve: (value: T) => void;
}

interface BootstrapTestInput {
  autoStart: boolean;
  resumeLastConversation: boolean;
  instanceId: string | null;
  loading: boolean;
  messagesLoading: boolean;
  currentConversationId: string | null;
  conversations: DecryptedAiConversation[];
  createConversation: () => Promise<string>;
  selectConversation: (id: string | null) => Promise<void>;
  setInitializationError: (message: string) => void;
}

function createConversation(id: string): DecryptedAiConversation {
  return {
    id,
    title: `Conversation ${id}`,
    modelId: null,
    messageCount: 0,
    createdAt: '2024-01-01T00:00:00.000Z',
    updatedAt: '2024-01-01T00:00:00.000Z'
  };
}

function createDeferredPromise<T>(): DeferredPromise<T> {
  let resolve: (value: T) => void = () => {};
  const promise = new Promise<T>((res) => {
    resolve = res;
  });
  return { promise, resolve };
}

function renderBootstrap(overrides: Partial<BootstrapTestInput> = {}) {
  const createConversationMock = vi
    .fn(async () => 'created-conversation')
    .mockName('createConversation');
  const selectConversationMock = vi
    .fn(async (_id: string | null) => {})
    .mockName('selectConversation');
  const setInitializationErrorMock = vi
    .fn((_message: string) => {})
    .mockName('setInitializationError');

  const initialProps: BootstrapTestInput = {
    autoStart: true,
    resumeLastConversation: false,
    instanceId: 'instance-1',
    loading: false,
    messagesLoading: false,
    currentConversationId: null,
    conversations: [],
    createConversation: createConversationMock,
    selectConversation: selectConversationMock,
    setInitializationError: setInitializationErrorMock,
    ...overrides
  };

  const renderResult = renderHook(
    (props: BootstrapTestInput) => {
      useConversationBootstrap(props);
    },
    { initialProps }
  );

  return {
    ...renderResult,
    createConversationMock,
    selectConversationMock,
    setInitializationErrorMock
  };
}

describe('useConversationBootstrap', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.mocked(readLastConversationId).mockReturnValue(null);
  });

  it('returns early when both auto start and resume are disabled', async () => {
    const { createConversationMock, selectConversationMock } = renderBootstrap({
      autoStart: false,
      resumeLastConversation: false
    });

    await waitFor(() => {
      expect(createConversationMock).not.toHaveBeenCalled();
      expect(selectConversationMock).not.toHaveBeenCalled();
    });
  });

  it('marks initialization complete when a current conversation already exists', async () => {
    const { createConversationMock, selectConversationMock } = renderBootstrap({
      currentConversationId: 'existing-conversation'
    });

    await waitFor(() => {
      expect(createConversationMock).not.toHaveBeenCalled();
      expect(selectConversationMock).not.toHaveBeenCalled();
    });
  });

  it('resumes the saved conversation when it exists in the list', async () => {
    vi.mocked(readLastConversationId).mockReturnValue('saved-conversation');

    const { selectConversationMock, createConversationMock } = renderBootstrap({
      autoStart: true,
      resumeLastConversation: true,
      conversations: [
        createConversation('saved-conversation'),
        createConversation('other-conversation')
      ]
    });

    await waitFor(() => {
      expect(selectConversationMock).toHaveBeenCalledWith('saved-conversation');
      expect(createConversationMock).not.toHaveBeenCalled();
    });
  });

  it('falls back to the most recent conversation when saved id is missing', async () => {
    vi.mocked(readLastConversationId).mockReturnValue('missing-conversation');

    const { selectConversationMock, createConversationMock } = renderBootstrap({
      autoStart: true,
      resumeLastConversation: true,
      conversations: [createConversation('recent-conversation')]
    });

    await waitFor(() => {
      expect(selectConversationMock).toHaveBeenCalledWith(
        'recent-conversation'
      );
      expect(createConversationMock).not.toHaveBeenCalled();
    });
  });

  it('creates a conversation when auto start is enabled and no conversations exist', async () => {
    const { createConversationMock, selectConversationMock } = renderBootstrap({
      autoStart: true,
      resumeLastConversation: false,
      conversations: []
    });

    await waitFor(() => {
      expect(createConversationMock).toHaveBeenCalledTimes(1);
      expect(selectConversationMock).not.toHaveBeenCalled();
    });
  });

  it('does not create a conversation when auto start is disabled', async () => {
    const { createConversationMock, selectConversationMock } = renderBootstrap({
      autoStart: false,
      resumeLastConversation: true,
      conversations: []
    });

    await waitFor(() => {
      expect(createConversationMock).not.toHaveBeenCalled();
      expect(selectConversationMock).not.toHaveBeenCalled();
    });
  });

  it('maps Error failures to their message', async () => {
    vi.mocked(readLastConversationId).mockReturnValue('saved-conversation');
    const selectFailure = vi.fn(async () => {
      throw new Error('select failed');
    });
    const setInitializationErrorMock = vi.fn((_message: string) => {});

    renderHook(() => {
      useConversationBootstrap({
        autoStart: true,
        resumeLastConversation: true,
        instanceId: 'instance-1',
        loading: false,
        messagesLoading: false,
        currentConversationId: null,
        conversations: [createConversation('saved-conversation')],
        createConversation: vi.fn(async () => 'unused'),
        selectConversation: selectFailure,
        setInitializationError: setInitializationErrorMock
      });
    });

    await waitFor(() => {
      expect(setInitializationErrorMock).toHaveBeenCalledWith('select failed');
    });
  });

  it('maps non-Error failures to the fallback message', async () => {
    vi.mocked(readLastConversationId).mockReturnValue('saved-conversation');
    const selectFailure = vi.fn(async () => {
      throw 'not-an-error';
    });
    const setInitializationErrorMock = vi.fn((_message: string) => {});

    renderHook(() => {
      useConversationBootstrap({
        autoStart: true,
        resumeLastConversation: true,
        instanceId: 'instance-1',
        loading: false,
        messagesLoading: false,
        currentConversationId: null,
        conversations: [createConversation('saved-conversation')],
        createConversation: vi.fn(async () => 'unused'),
        selectConversation: selectFailure,
        setInitializationError: setInitializationErrorMock
      });
    });

    await waitFor(() => {
      expect(setInitializationErrorMock).toHaveBeenCalledWith(
        'Failed to initialize conversation'
      );
    });
  });

  it('resets bootstrap state when instance changes', async () => {
    const createConversationMock = vi
      .fn(async () => 'created-conversation')
      .mockName('createConversation');
    const selectConversationMock = vi
      .fn(async (_id: string | null) => {})
      .mockName('selectConversation');
    const setInitializationErrorMock = vi
      .fn((_message: string) => {})
      .mockName('setInitializationError');

    const { rerender } = renderHook(
      (props: BootstrapTestInput) => {
        useConversationBootstrap(props);
      },
      {
        initialProps: {
          autoStart: true,
          resumeLastConversation: false,
          instanceId: 'instance-1',
          loading: false,
          messagesLoading: false,
          currentConversationId: 'existing-conversation',
          conversations: [createConversation('existing-conversation')],
          createConversation: createConversationMock,
          selectConversation: selectConversationMock,
          setInitializationError: setInitializationErrorMock
        }
      }
    );

    await waitFor(() => {
      expect(createConversationMock).not.toHaveBeenCalled();
      expect(selectConversationMock).not.toHaveBeenCalled();
    });

    rerender({
      autoStart: true,
      resumeLastConversation: false,
      instanceId: 'instance-2',
      loading: false,
      messagesLoading: false,
      currentConversationId: null,
      conversations: [],
      createConversation: createConversationMock,
      selectConversation: selectConversationMock,
      setInitializationError: setInitializationErrorMock
    });

    await waitFor(() => {
      expect(createConversationMock).toHaveBeenCalledTimes(1);
      expect(setInitializationErrorMock).not.toHaveBeenCalled();
    });
  });

  it('does not start a second bootstrap while one is in progress', async () => {
    const deferred = createDeferredPromise<string>();
    const createConversationMock = vi
      .fn(() => deferred.promise)
      .mockName('createConversation');
    const selectConversationMock = vi
      .fn(async (_id: string | null) => {})
      .mockName('selectConversation');
    const setInitializationErrorMock = vi
      .fn((_message: string) => {})
      .mockName('setInitializationError');

    const initialProps: BootstrapTestInput = {
      autoStart: true,
      resumeLastConversation: false,
      instanceId: 'instance-1',
      loading: false,
      messagesLoading: false,
      currentConversationId: null,
      conversations: [],
      createConversation: createConversationMock,
      selectConversation: selectConversationMock,
      setInitializationError: setInitializationErrorMock
    };

    const { rerender } = renderHook(
      (props: BootstrapTestInput) => {
        useConversationBootstrap(props);
      },
      { initialProps }
    );

    rerender({
      ...initialProps,
      conversations: [...initialProps.conversations]
    });

    await waitFor(() => {
      expect(createConversationMock).toHaveBeenCalledTimes(1);
    });

    deferred.resolve('created-conversation');

    await waitFor(() => {
      expect(setInitializationErrorMock).not.toHaveBeenCalled();
    });
  });
});
