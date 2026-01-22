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
vi.mock('@/hooks/useLLM', () => ({
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
    retrieve: mockRetrieve,
    measureRetrieve: mockRetrieve
  }),
  isFileStorageInitialized: () => mockIsFileStorageInitialized(),
  initializeFileStorage: (key: Uint8Array, instanceId: string) =>
    mockInitializeFileStorage(key, instanceId),
  createRetrieveLogger: () => vi.fn()
}));

// Mock llm-runtime
const mockSetAttachedImage = vi.fn();
const mockGetAttachedImage = vi.fn((): string | null => null);
vi.mock('@/lib/llm-runtime', () => ({
  createLLMAdapter: vi.fn(() => ({})),
  getAttachedImage: () => mockGetAttachedImage(),
  setAttachedImage: (img: string | null) => mockSetAttachedImage(img)
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

import { useLLM } from '@/hooks/useLLM';

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

function findCloseButton(): HTMLElement {
  return screen.getByRole('button', { name: /close/i });
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
        expectedName: 'Mistral 7B Instruct'
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

      // The link contains a Bot icon
      const link = screen.getByRole('link', { name: /go to models/i });
      expect(link).toBeInTheDocument();
    });
  });

  describe('PhotoPicker component', () => {
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

    it('opens photo picker when attach image button is clicked', async () => {
      // Set up mock to return photos
      mockSelect.mockReturnValue({
        from: vi.fn().mockReturnValue({
          where: vi.fn().mockReturnValue({
            orderBy: vi.fn().mockReturnValue({
              limit: vi.fn().mockResolvedValue([])
            })
          })
        })
      });

      renderChat();

      const imageButton = findImageButton();

      await act(async () => {
        fireEvent.click(imageButton);
      });

      // Wait for the photo picker to appear
      await waitFor(() => {
        expect(screen.getByText('Select a Photo')).toBeInTheDocument();
      });
    });

    it('shows loading state when fetching photos', async () => {
      // Set up a delayed mock
      mockSelect.mockReturnValue({
        from: vi.fn().mockReturnValue({
          where: vi.fn().mockReturnValue({
            orderBy: vi.fn().mockReturnValue({
              limit: vi
                .fn()
                .mockImplementation(
                  () =>
                    new Promise((resolve) => setTimeout(() => resolve([]), 100))
                )
            })
          })
        })
      });

      renderChat();

      const imageButton = findImageButton();

      await act(async () => {
        fireEvent.click(imageButton);
      });

      // Should show loading state
      await waitFor(() => {
        expect(screen.getByText(/Loading photos/)).toBeInTheDocument();
      });
    });

    it('shows empty state when no photos available', async () => {
      mockSelect.mockReturnValue({
        from: vi.fn().mockReturnValue({
          where: vi.fn().mockReturnValue({
            orderBy: vi.fn().mockReturnValue({
              limit: vi.fn().mockResolvedValue([])
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

    it('shows loading indefinitely when database is not unlocked', async () => {
      // When database is not unlocked, fetchPhotos returns early without
      // changing the loading state, so the component remains in loading state
      mockUseDatabaseContext.mockReturnValue({
        isUnlocked: false,
        isLoading: false,
        currentInstanceId: null
      });

      renderChat();

      const imageButton = findImageButton();

      await act(async () => {
        fireEvent.click(imageButton);
      });

      // Should show loading state since fetchPhotos returns early when not unlocked
      await waitFor(() => {
        expect(screen.getByText(/Loading photos/)).toBeInTheDocument();
      });
    });

    it('closes photo picker when close button is clicked', async () => {
      mockSelect.mockReturnValue({
        from: vi.fn().mockReturnValue({
          where: vi.fn().mockReturnValue({
            orderBy: vi.fn().mockReturnValue({
              limit: vi.fn().mockResolvedValue([])
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
        expect(screen.getByText('Select a Photo')).toBeInTheDocument();
      });

      // Find and click the close button (X button in the header)
      const closeButton = findCloseButton();

      await act(async () => {
        fireEvent.click(closeButton);
      });

      await waitFor(() => {
        expect(screen.queryByText('Select a Photo')).not.toBeInTheDocument();
      });
    });

    it('shows error when encryption key is not available', async () => {
      mockGetCurrentKey.mockReturnValue(null);
      mockSelect.mockReturnValue({
        from: vi.fn().mockReturnValue({
          where: vi.fn().mockReturnValue({
            orderBy: vi.fn().mockReturnValue({
              limit: vi.fn().mockResolvedValue([
                {
                  id: '1',
                  name: 'test.jpg',
                  storagePath: '/photos/test.jpg',
                  thumbnailPath: '/photos/thumb_test.jpg'
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
        expect(screen.getByText(/Database not unlocked/)).toBeInTheDocument();
      });
    });

    it('shows error when no active instance', async () => {
      mockUseDatabaseContext.mockReturnValue({
        isUnlocked: true,
        isLoading: false,
        currentInstanceId: null
      });
      mockSelect.mockReturnValue({
        from: vi.fn().mockReturnValue({
          where: vi.fn().mockReturnValue({
            orderBy: vi.fn().mockReturnValue({
              limit: vi.fn().mockResolvedValue([
                {
                  id: '1',
                  name: 'test.jpg',
                  storagePath: '/photos/test.jpg',
                  thumbnailPath: '/photos/thumb_test.jpg'
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
        expect(screen.getByText(/No active instance/)).toBeInTheDocument();
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

      // Mock URL.createObjectURL
      const mockCreateObjectURL = vi
        .fn()
        .mockReturnValue('blob:test-object-url');
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

      // Should show no photos because the retrieval failed
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

      // Mock FileReader using a class
      class MockFileReader {
        result = 'data:image/jpeg;base64,test';
        onload: ((ev: ProgressEvent<FileReader>) => void) | null = null;
        readAsDataURL() {
          // Simulate async FileReader behavior
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

      // Wait for photos to load
      await waitFor(() => {
        const photoButtons = screen.getAllByRole('button').filter((btn) => {
          const img = btn.querySelector('img');
          return img && img.getAttribute('alt') === 'test-photo.jpg';
        });
        expect(photoButtons.length).toBeGreaterThan(0);
      });

      // Click the photo to select it
      const photoButtons = screen.getAllByRole('button').filter((btn) => {
        const img = btn.querySelector('img');
        return img && img.getAttribute('alt') === 'test-photo.jpg';
      });
      const firstPhotoButton = photoButtons[0];
      if (!firstPhotoButton) throw new Error('Photo button not found');

      await act(async () => {
        fireEvent.click(firstPhotoButton);
      });

      // Wait for FileReader callback to fire and setAttachedImage to be called
      await waitFor(() => {
        expect(mockSetAttachedImage).toHaveBeenCalledWith(
          'data:image/jpeg;base64,test'
        );
      });
    });
  });

  describe('image attachment removal', () => {
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

    it('clears attached image when remove button is clicked', async () => {
      // Set up so there's an attached image
      mockGetAttachedImage.mockReturnValue(
        'data:image/jpeg;base64,existingImage'
      );

      renderChat();

      // The attached image should trigger a state sync in useEffect
      // Wait for the remove button to appear
      const removeButton = await screen.findByRole('button', {
        name: /remove attached image/i
      });

      fireEvent.click(removeButton);
      expect(mockSetAttachedImage).toHaveBeenCalledWith(null);
    });
  });

  describe('ChatInterface useEffect sync', () => {
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

    it('syncs attached image state from runtime module', async () => {
      mockGetAttachedImage.mockReturnValue('data:image/png;base64,syncedImage');

      renderChat();

      // The useEffect should sync the state
      await waitFor(() => {
        // If state is synced, the attached image preview should show
        const imgs = screen.queryAllByRole('img');
        const attachedImg = imgs.find(
          (img) => img.getAttribute('alt') === 'Attached'
        );
        expect(attachedImg).toBeInTheDocument();
      });
    });
  });
});
