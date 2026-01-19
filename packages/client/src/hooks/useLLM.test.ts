import { DEFAULT_OPENROUTER_MODEL_ID } from '@rapid/shared';
import { act, renderHook } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { ClassificationResult } from './useLLM';

// Mock the worker
const mockPostMessage = vi.fn();
let mockOnMessage: ((event: MessageEvent) => void) | null = null;

vi.mock('../workers/llm-worker.ts', () => ({}));

// Mock Worker constructor
class MockWorker {
  onmessage: ((event: MessageEvent) => void) | null = null;
  onerror: ((event: ErrorEvent) => void) | null = null;

  constructor() {
    // Store reference to allow tests to simulate messages
    mockOnMessage = (event: MessageEvent) => {
      if (this.onmessage) {
        this.onmessage(event);
      }
    };
  }

  postMessage = mockPostMessage;
  terminate = vi.fn();
}

// Mock database
vi.mock('@/db', () => ({
  getDatabase: vi.fn().mockReturnValue(null),
  getCurrentInstanceId: vi.fn().mockReturnValue('test-instance-id')
}));

// Mock useAppLifecycle
vi.mock('./useAppLifecycle', () => ({
  saveLastLoadedModel: vi.fn(),
  getLastLoadedModel: vi.fn().mockReturnValue(null),
  clearLastLoadedModel: vi.fn()
}));

// Mock sonner
vi.mock('sonner', () => ({
  toast: {
    error: vi.fn(),
    info: vi.fn(),
    warning: vi.fn()
  }
}));

describe('useLLM', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockOnMessage = null;
    vi.stubGlobal('Worker', MockWorker);
    // Mock WebGPU
    vi.stubGlobal('navigator', {
      gpu: {
        requestAdapter: vi.fn().mockResolvedValue({})
      }
    });
  });

  afterEach(() => {
    // Reset modules to clear module-level state
    vi.resetModules();
  });

  describe('OpenRouter models', () => {
    it('loads OpenRouter models without using the worker', async () => {
      vi.stubEnv('VITE_API_URL', 'http://localhost');
      const { useLLM } = await import('./useLLM');
      const { result } = renderHook(() => useLLM());

      await act(async () => {
        await result.current.loadModel(DEFAULT_OPENROUTER_MODEL_ID);
      });

      expect(result.current.loadedModel).toBe(DEFAULT_OPENROUTER_MODEL_ID);
      expect(result.current.modelType).toBe('chat');
      expect(mockPostMessage).not.toHaveBeenCalled();
      vi.unstubAllEnvs();
    });

    it('generates responses via the OpenRouter API', async () => {
      vi.stubEnv('VITE_API_URL', 'http://localhost');
      const mockFetch = vi.fn().mockResolvedValue(
        new Response(
          JSON.stringify({
            choices: [
              {
                message: {
                  role: 'assistant',
                  content: 'Remote reply'
                }
              }
            ]
          }),
          { status: 200 }
        )
      );
      vi.stubGlobal('fetch', mockFetch);

      const { useLLM } = await import('./useLLM');
      const { result } = renderHook(() => useLLM());

      await act(async () => {
        await result.current.loadModel(DEFAULT_OPENROUTER_MODEL_ID);
      });

      const onToken = vi.fn();
      await act(async () => {
        await result.current.generate(
          [{ role: 'user', content: 'Hello' }],
          onToken
        );
      });

      expect(onToken).toHaveBeenCalledWith('Remote reply');
      expect(mockFetch).toHaveBeenCalledWith(
        'http://localhost/chat/completions',
        expect.objectContaining({
          method: 'POST',
          headers: {
            'Content-Type': 'application/json'
          }
        })
      );
      vi.unstubAllGlobals();
      vi.unstubAllEnvs();
    });
  });

  describe('snapshot immutability', () => {
    it('updates state correctly during model loading', async () => {
      // Import fresh module
      const { useLLM } = await import('./useLLM');
      const { result } = renderHook(() => useLLM());

      // Capture initial state values
      const initialLoadedModel = result.current.loadedModel;
      const initialIsLoading = result.current.isLoading;
      expect(initialIsLoading).toBe(false);
      expect(initialLoadedModel).toBeNull();

      // Start loading a model
      await act(async () => {
        result.current.loadModel('test-model');
        // Allow the async operations to start
        await Promise.resolve();
      });

      // After state change, state should be updated
      expect(result.current.isLoading).toBe(true);
      expect(result.current.isLoading).not.toBe(initialIsLoading);

      // Simulate worker 'loaded' response
      await act(async () => {
        mockOnMessage?.({
          data: {
            type: 'loaded',
            modelId: 'test-model',
            modelType: 'chat',
            durationMs: 100
          }
        } as MessageEvent);
      });

      // State should be updated again
      expect(result.current.isLoading).toBe(false);
      expect(result.current.loadedModel).toBe('test-model');
    });

    it('maintains stable state when no changes occur', async () => {
      // Import fresh module
      const { useLLM } = await import('./useLLM');
      const { result, rerender } = renderHook(() => useLLM());

      // Capture initial state
      const initialLoadedModel = result.current.loadedModel;
      const initialIsLoading = result.current.isLoading;
      const initialError = result.current.error;

      // Re-render without any state changes
      rerender();

      // State values should remain the same
      expect(result.current.loadedModel).toBe(initialLoadedModel);
      expect(result.current.isLoading).toBe(initialIsLoading);
      expect(result.current.error).toBe(initialError);
    });
  });

  describe('state updates during model loading', () => {
    it('handles state transitions correctly when loading a new model', async () => {
      // Import fresh module
      const { useLLM } = await import('./useLLM');
      const { result } = renderHook(() => useLLM());

      // Capture initial state
      expect(result.current.isLoading).toBe(false);
      expect(result.current.loadedModel).toBeNull();

      // Start loading
      await act(async () => {
        result.current.loadModel('test-model');
        await Promise.resolve();
      });

      expect(result.current.isLoading).toBe(true);

      // Simulate 'unloaded' message (happens when loading a new model replaces existing one)
      await act(async () => {
        mockOnMessage?.({
          data: { type: 'unloaded' }
        } as MessageEvent);
      });

      expect(result.current.loadedModel).toBeNull();
      // isLoading should still be true (set by loadModelInternal, not by worker)
      expect(result.current.isLoading).toBe(true);

      // Simulate 'loaded' message
      await act(async () => {
        mockOnMessage?.({
          data: {
            type: 'loaded',
            modelId: 'test-model',
            modelType: 'chat',
            durationMs: 100
          }
        } as MessageEvent);
      });

      expect(result.current.isLoading).toBe(false);
      expect(result.current.loadedModel).toBe('test-model');
    });
  });

  describe('loadProgress updates', () => {
    it('creates new snapshots for progress updates', async () => {
      // Import fresh module
      const { useLLM } = await import('./useLLM');
      const { result } = renderHook(() => useLLM());

      // Start loading
      await act(async () => {
        result.current.loadModel('test-model');
        await Promise.resolve();
      });

      const beforeProgressValue = result.current.loadProgress;

      // Simulate progress update
      await act(async () => {
        mockOnMessage?.({
          data: {
            type: 'progress',
            file: 'model.bin',
            progress: 50,
            total: 100
          }
        } as MessageEvent);
      });

      // loadProgress should be updated
      expect(result.current.loadProgress).not.toBe(beforeProgressValue);
      expect(result.current.loadProgress).toEqual({
        text: 'Downloading model.bin...',
        progress: 0.5
      });
    });
  });

  describe('error handling', () => {
    it('creates new snapshot on error', async () => {
      // Import fresh module
      const { useLLM } = await import('./useLLM');
      const { result } = renderHook(() => useLLM());

      // Start loading - we'll handle the rejection when it occurs
      let loadPromise: Promise<void> | undefined;
      await act(async () => {
        loadPromise = result.current.loadModel('test-model');
        await Promise.resolve();
      });

      const beforeErrorValue = result.current.error;
      expect(beforeErrorValue).toBeNull();

      // Simulate error - this will reject the loadPromise
      // We need to handle both the act and the rejection together
      await act(async () => {
        mockOnMessage?.({
          data: {
            type: 'error',
            message: 'Test error'
          }
        } as MessageEvent);

        // Handle the rejection inside act to avoid unhandled rejection
        try {
          await loadPromise;
        } catch {
          // Expected rejection
        }
      });

      // Error state should be updated
      expect(result.current.error).toBe('Test error');
      expect(result.current.isLoading).toBe(false);
    });
  });

  describe('classification', () => {
    it('sends classify request to worker after loading CLIP model', async () => {
      // Import fresh module
      const { useLLM } = await import('./useLLM');
      const { result } = renderHook(() => useLLM());

      // Load CLIP model first
      await act(async () => {
        result.current.loadModel('Xenova/clip-vit-base-patch32');
        await Promise.resolve();
      });

      // Simulate model loaded
      await act(async () => {
        mockOnMessage?.({
          data: {
            type: 'loaded',
            modelId: 'Xenova/clip-vit-base-patch32',
            modelType: 'clip',
            durationMs: 100
          }
        } as MessageEvent);
      });

      expect(result.current.loadedModel).toBe('Xenova/clip-vit-base-patch32');
      expect(result.current.modelType).toBe('clip');

      // Call classify
      let classifyPromise: Promise<ClassificationResult> | undefined;
      await act(async () => {
        classifyPromise = result.current.classify('data:image/png;base64,...', [
          'passport',
          'license'
        ]);
        await Promise.resolve();
      });

      expect(result.current.isClassifying).toBe(true);
      expect(mockPostMessage).toHaveBeenCalledWith({
        type: 'classify',
        image: 'data:image/png;base64,...',
        candidateLabels: ['passport', 'license']
      });

      // Simulate classification response
      await act(async () => {
        mockOnMessage?.({
          data: {
            type: 'classification',
            labels: ['passport', 'license'],
            scores: [0.8, 0.2],
            durationMs: 50
          }
        } as MessageEvent);
      });

      expect(result.current.isClassifying).toBe(false);

      const classificationResult = await classifyPromise;
      expect(classificationResult?.labels).toEqual(['passport', 'license']);
      expect(classificationResult?.scores[0]).toBeGreaterThan(
        classificationResult?.scores[1] ?? 0
      );
    });

    it('throws error when classifying without a loaded model', async () => {
      // Import fresh module
      const { useLLM } = await import('./useLLM');
      const { result } = renderHook(() => useLLM());

      // Try to classify without loading a model
      await expect(
        result.current.classify('data:image/png;base64,...', ['passport'])
      ).rejects.toThrow('No model loaded');
    });

    it('throws error when classifying with non-CLIP model', async () => {
      // Import fresh module
      const { useLLM } = await import('./useLLM');
      const { result } = renderHook(() => useLLM());

      // Load a chat model
      await act(async () => {
        result.current.loadModel('test-chat-model');
        await Promise.resolve();
      });

      await act(async () => {
        mockOnMessage?.({
          data: {
            type: 'loaded',
            modelId: 'test-chat-model',
            modelType: 'chat',
            durationMs: 100
          }
        } as MessageEvent);
      });

      // Try to classify with wrong model type
      await expect(
        result.current.classify('data:image/png;base64,...', ['passport'])
      ).rejects.toThrow('Loaded model is not a CLIP model');
    });

    it('handles classification errors correctly', async () => {
      // Import fresh module
      const { useLLM } = await import('./useLLM');
      const { result } = renderHook(() => useLLM());

      // Load CLIP model
      await act(async () => {
        result.current.loadModel('Xenova/clip-vit-base-patch32');
        await Promise.resolve();
      });

      await act(async () => {
        mockOnMessage?.({
          data: {
            type: 'loaded',
            modelId: 'Xenova/clip-vit-base-patch32',
            modelType: 'clip',
            durationMs: 100
          }
        } as MessageEvent);
      });

      // Start classification
      let classifyPromise: Promise<ClassificationResult> | undefined;
      await act(async () => {
        classifyPromise = result.current.classify('data:image/png;base64,...', [
          'passport'
        ]);
        await Promise.resolve();
      });

      // Simulate error
      await act(async () => {
        mockOnMessage?.({
          data: {
            type: 'error',
            message: 'Classification failed: Invalid image'
          }
        } as MessageEvent);

        try {
          await classifyPromise;
        } catch {
          // Expected rejection
        }
      });

      expect(result.current.isClassifying).toBe(false);
      expect(result.current.error).toBe('Classification failed: Invalid image');
    });

    it('prevents concurrent classification requests', async () => {
      const { useLLM } = await import('./useLLM');
      const { result } = renderHook(() => useLLM());

      // Load CLIP model first
      await act(async () => {
        result.current.loadModel('Xenova/clip-vit-base-patch32');
        await Promise.resolve();
      });

      await act(async () => {
        mockOnMessage?.({
          data: {
            type: 'loaded',
            modelId: 'Xenova/clip-vit-base-patch32',
            modelType: 'clip',
            durationMs: 100
          }
        } as MessageEvent);
      });

      // Start first classification (don't await yet)
      let firstPromise: Promise<ClassificationResult> | undefined;
      await act(async () => {
        firstPromise = result.current.classify('data:image/png;base64,...', [
          'passport'
        ]);
        await Promise.resolve();
      });

      // Try to start second classification while first is in progress
      await act(async () => {
        await expect(
          result.current.classify('data:image/png;base64,...', ['license'])
        ).rejects.toThrow('A classification is already in progress');
      });

      // Complete first classification
      await act(async () => {
        mockOnMessage?.({
          data: {
            type: 'classification',
            labels: ['passport'],
            scores: [1.0],
            durationMs: 50
          }
        } as MessageEvent);
        await firstPromise;
      });
    });
  });

  describe('resetLLMUIState', () => {
    it('clears UI state but preserves loadedModel and modelType', async () => {
      const { useLLM, resetLLMUIState } = await import('./useLLM');
      const { result } = renderHook(() => useLLM());

      // Load a model first
      await act(async () => {
        result.current.loadModel('test-model');
        await Promise.resolve();
      });

      // Simulate model loaded
      await act(async () => {
        mockOnMessage?.({
          data: {
            type: 'loaded',
            modelId: 'test-model',
            modelType: 'chat',
            durationMs: 100
          }
        } as MessageEvent);
      });

      expect(result.current.loadedModel).toBe('test-model');
      expect(result.current.modelType).toBe('chat');

      // Reset UI state
      await act(async () => {
        resetLLMUIState();
      });

      // loadedModel and modelType should be preserved
      expect(result.current.loadedModel).toBe('test-model');
      expect(result.current.modelType).toBe('chat');

      // UI state should be cleared
      expect(result.current.isLoading).toBe(false);
      expect(result.current.loadProgress).toBeNull();
      expect(result.current.error).toBeNull();
      expect(result.current.isClassifying).toBe(false);
    });

    it('rejects in-progress generation when reset', async () => {
      const { useLLM, resetLLMUIState } = await import('./useLLM');
      const { result } = renderHook(() => useLLM());

      // Load a model first
      await act(async () => {
        result.current.loadModel('test-model');
        await Promise.resolve();
      });

      await act(async () => {
        mockOnMessage?.({
          data: {
            type: 'loaded',
            modelId: 'test-model',
            modelType: 'chat',
            durationMs: 100
          }
        } as MessageEvent);
      });

      // Start a generation
      let generatePromise: Promise<void> | undefined;
      await act(async () => {
        generatePromise = result.current.generate(
          [{ role: 'user', content: 'Hello' }],
          () => {
            // Empty token callback
          }
        );
        await Promise.resolve();
      });

      // Reset while generation is in progress - handle rejection inside act
      await act(async () => {
        resetLLMUIState();
        // Handle the rejection immediately to avoid unhandled rejection
        try {
          await generatePromise;
        } catch {
          // Expected rejection
        }
      });

      // The generation should have been rejected
      await expect(generatePromise).rejects.toThrow('Instance switched');
    });

    it('rejects pending load when reset', async () => {
      const { useLLM, resetLLMUIState } = await import('./useLLM');
      const { result } = renderHook(() => useLLM());

      // Start loading a model
      let loadPromise: Promise<void> | undefined;
      await act(async () => {
        loadPromise = result.current.loadModel('test-model');
        await Promise.resolve();
      });

      expect(result.current.isLoading).toBe(true);

      // Reset while loading - handle rejection inside act
      await act(async () => {
        resetLLMUIState();
        // Handle the rejection immediately to avoid unhandled rejection
        try {
          await loadPromise;
        } catch {
          // Expected rejection
        }
      });

      // The load should have been rejected
      await expect(loadPromise).rejects.toThrow('Instance switched');
      expect(result.current.isLoading).toBe(false);
    });
  });
});
