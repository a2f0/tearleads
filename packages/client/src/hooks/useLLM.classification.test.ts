import { act, renderHook } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { ClassificationResult } from './llm';

// Mock the worker
const mockPostMessage = vi.fn();
let mockOnMessage: ((event: MessageEvent) => void) | null = null;

vi.mock('../workers/llmWorker.ts', () => ({}));

// Mock Worker constructor
class MockWorker {
  onmessage: ((event: MessageEvent) => void) | null = null;
  onerror: ((event: ErrorEvent) => void) | null = null;

  constructor() {
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
vi.mock('./app/useAppLifecycle', () => ({
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

describe('useLLM classification', () => {
  beforeEach(async () => {
    vi.clearAllMocks();
    mockOnMessage = null;
    vi.stubGlobal('Worker', MockWorker);
    localStorage.removeItem('auth_token');
    // Mock WebGPU
    vi.stubGlobal('navigator', {
      gpu: {
        requestAdapter: vi.fn().mockResolvedValue({})
      }
    });
    const { getLastLoadedModel } = await import('./app/useAppLifecycle');
    vi.mocked(getLastLoadedModel).mockReturnValue(null);
  });

  afterEach(() => {
    vi.resetModules();
    vi.unstubAllGlobals();
  });

  it('sends classify request to worker after loading CLIP model', async () => {
    const { useLLM } = await import('./llm');
    const { result } = renderHook(() => useLLM());

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

    expect(result.current.loadedModel).toBe('Xenova/clip-vit-base-patch32');
    expect(result.current.modelType).toBe('clip');

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
    const { useLLM } = await import('./llm');
    const { result } = renderHook(() => useLLM());

    await expect(
      result.current.classify('data:image/png;base64,...', ['passport'])
    ).rejects.toThrow('No model loaded');
  });

  it('throws error when classifying with non-CLIP model', async () => {
    const { useLLM } = await import('./llm');
    const { result } = renderHook(() => useLLM());

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

    await expect(
      result.current.classify('data:image/png;base64,...', ['passport'])
    ).rejects.toThrow('Loaded model is not a CLIP model');
  });

  it('handles classification errors correctly', async () => {
    const { useLLM } = await import('./llm');
    const { result } = renderHook(() => useLLM());

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

    let classifyPromise: Promise<ClassificationResult> | undefined;
    await act(async () => {
      classifyPromise = result.current.classify('data:image/png;base64,...', [
        'passport'
      ]);
      await Promise.resolve();
    });

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
    const { useLLM } = await import('./llm');
    const { result } = renderHook(() => useLLM());

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

    let firstPromise: Promise<ClassificationResult> | undefined;
    await act(async () => {
      firstPromise = result.current.classify('data:image/png;base64,...', [
        'passport'
      ]);
      await Promise.resolve();
    });

    await act(async () => {
      await expect(
        result.current.classify('data:image/png;base64,...', ['license'])
      ).rejects.toThrow('A classification is already in progress');
    });

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
