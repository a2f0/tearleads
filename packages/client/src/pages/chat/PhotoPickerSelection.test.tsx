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

vi.mock('@/hooks/ai/useConversations', () => ({
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

const mockSelect = vi.fn();
vi.mock('@/db', () => ({ getDatabase: () => ({ select: mockSelect }) }));

const mockGetCurrentKey = vi.fn();
vi.mock('@/db/crypto', () => ({
  getKeyManager: () => ({ getCurrentKey: mockGetCurrentKey })
}));

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

const mockSetAttachedImage = vi.fn();
const mockGetAttachedImage = vi.fn((): string | null => null);
vi.mock('@/lib/llmRuntime', () => ({
  createLLMAdapter: vi.fn(() => ({})),
  getAttachedImage: () => mockGetAttachedImage(),
  setAttachedImage: (img: string | null) => mockSetAttachedImage(img)
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

function findImageButton(): HTMLElement {
  return screen.getByRole('button', { name: /attach image/i });
}

describe('PhotoPicker photo display and selection', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockUseDatabaseContext.mockReturnValue({
      isUnlocked: true,
      isLoading: false,
      currentInstanceId: 'test-instance'
    });
    mockGetCurrentKey.mockReturnValue(new Uint8Array([1, 2, 3, 4]));
    mockIsFileStorageInitialized.mockReturnValue(true);
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

  it('displays photos when available', async () => {
    mockRetrieve.mockResolvedValue(new Uint8Array([1, 2, 3, 4]));
    mockSelect.mockReturnValue({
      from: vi.fn().mockReturnValue({
        where: vi.fn().mockReturnValue({
          orderBy: vi.fn().mockReturnValue({
            limit: vi.fn().mockResolvedValue([
              {
                id: '1',
                name: 'test-photo.jpg',
                storagePath: '/photos/test.jpg',
                thumbnailPath: '/photos/thumb_test.jpg'
              }
            ])
          })
        })
      })
    });

    const mockCreateObjectURL = vi.fn().mockReturnValue('blob:test-object-url');
    global.URL.createObjectURL = mockCreateObjectURL;
    global.URL.revokeObjectURL = vi.fn();

    renderChat();

    const imageButton = findImageButton();

    await act(async () => {
      fireEvent.click(imageButton);
    });

    await waitFor(() => {
      const photos = screen.getAllByRole('button').filter((btn) => {
        const img = btn.querySelector('img');
        return img && img.getAttribute('alt') === 'test-photo.jpg';
      });
      expect(photos.length).toBeGreaterThan(0);
    });
  });

  it('handles storage retrieval errors gracefully', async () => {
    mockRetrieve.mockRejectedValue(new Error('Storage error'));
    mockSelect.mockReturnValue({
      from: vi.fn().mockReturnValue({
        where: vi.fn().mockReturnValue({
          orderBy: vi.fn().mockReturnValue({
            limit: vi.fn().mockResolvedValue([
              {
                id: '1',
                name: 'test.jpg',
                storagePath: '/photos/test.jpg',
                thumbnailPath: null
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
      expect(screen.getByText(/No photos found/)).toBeInTheDocument();
    });
  });

  it('initializes file storage if not initialized', async () => {
    mockIsFileStorageInitialized.mockReturnValue(false);
    mockInitializeFileStorage.mockResolvedValue(undefined);
    mockRetrieve.mockResolvedValue(new Uint8Array([1, 2, 3, 4]));
    mockSelect.mockReturnValue({
      from: vi.fn().mockReturnValue({
        where: vi.fn().mockReturnValue({
          orderBy: vi.fn().mockReturnValue({
            limit: vi.fn().mockResolvedValue([
              {
                id: '1',
                name: 'test.jpg',
                storagePath: '/photos/test.jpg',
                thumbnailPath: null
              }
            ])
          })
        })
      })
    });

    global.URL.createObjectURL = vi.fn().mockReturnValue('blob:test-url');
    global.URL.revokeObjectURL = vi.fn();

    renderChat();

    const imageButton = findImageButton();

    await act(async () => {
      fireEvent.click(imageButton);
    });

    await waitFor(() => {
      expect(mockInitializeFileStorage).toHaveBeenCalled();
    });
  });

  it('selects a photo and closes picker', async () => {
    mockRetrieve.mockResolvedValue(new Uint8Array([1, 2, 3, 4]));
    mockSelect.mockReturnValue({
      from: vi.fn().mockReturnValue({
        where: vi.fn().mockReturnValue({
          orderBy: vi.fn().mockReturnValue({
            limit: vi.fn().mockResolvedValue([
              {
                id: '1',
                name: 'test-photo.jpg',
                storagePath: '/photos/test.jpg',
                thumbnailPath: '/photos/thumb_test.jpg'
              }
            ])
          })
        })
      })
    });

    global.URL.createObjectURL = vi.fn().mockReturnValue('blob:test-url');
    global.URL.revokeObjectURL = vi.fn();

    class MockFileReader {
      result = 'data:image/jpeg;base64,test';
      onload: ((ev: ProgressEvent<FileReader>) => void) | null = null;
      readAsDataURL() {
        setTimeout(() => {
          if (this.onload) {
            this.onload({} as ProgressEvent<FileReader>);
          }
        }, 0);
      }
    }
    vi.stubGlobal('FileReader', MockFileReader);

    renderChat();

    const imageButton = findImageButton();

    await act(async () => {
      fireEvent.click(imageButton);
    });

    await waitFor(() => {
      const photoButtons = screen.getAllByRole('button').filter((btn) => {
        const img = btn.querySelector('img');
        return img && img.getAttribute('alt') === 'test-photo.jpg';
      });
      expect(photoButtons.length).toBeGreaterThan(0);
    });

    const photoButtons = screen.getAllByRole('button').filter((btn) => {
      const img = btn.querySelector('img');
      return img && img.getAttribute('alt') === 'test-photo.jpg';
    });
    const firstPhotoButton = photoButtons[0];
    if (!firstPhotoButton) throw new Error('Photo button not found');

    await act(async () => {
      fireEvent.click(firstPhotoButton);
    });

    await waitFor(() => {
      expect(mockSetAttachedImage).toHaveBeenCalledWith(
        'data:image/jpeg;base64,test'
      );
    });
  });
});

describe('image attachment removal', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockUseDatabaseContext.mockReturnValue({
      isUnlocked: true,
      isLoading: false,
      currentInstanceId: 'test-instance'
    });
    mockGetCurrentKey.mockReturnValue(new Uint8Array([1, 2, 3, 4]));
    mockIsFileStorageInitialized.mockReturnValue(true);
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

  it('clears attached image when remove button is clicked', async () => {
    mockGetAttachedImage.mockReturnValue(
      'data:image/jpeg;base64,existingImage'
    );

    renderChat();

    const removeButton = await screen.findByRole('button', {
      name: /remove attached image/i
    });

    fireEvent.click(removeButton);
    expect(mockSetAttachedImage).toHaveBeenCalledWith(null);
  });
});

describe('ChatInterface useEffect sync', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockUseDatabaseContext.mockReturnValue({
      isUnlocked: true,
      isLoading: false,
      currentInstanceId: 'test-instance'
    });
    mockGetCurrentKey.mockReturnValue(new Uint8Array([1, 2, 3, 4]));
    mockIsFileStorageInitialized.mockReturnValue(true);
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

  it('syncs attached image state from runtime module', async () => {
    mockGetAttachedImage.mockReturnValue('data:image/png;base64,syncedImage');

    renderChat();

    await waitFor(() => {
      const imgs = screen.queryAllByRole('img');
      const attachedImg = imgs.find(
        (img) => img.getAttribute('alt') === 'Attached'
      );
      expect(attachedImg).toBeInTheDocument();
    });
  });
});
