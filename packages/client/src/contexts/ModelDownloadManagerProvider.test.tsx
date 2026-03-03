import { act, renderHook, waitFor } from '@testing-library/react';
import type { ReactNode } from 'react';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import {
  ModelDownloadManagerProvider,
  useModelDownloadManager
} from './ModelDownloadManagerProvider';

const mockUseLLM = vi.fn();

vi.mock('@/hooks/ai', () => ({
  useLLM: () => mockUseLLM()
}));

interface Deferred {
  promise: Promise<void>;
  resolve: () => void;
}

function createDeferred(): Deferred {
  let resolve = () => {};
  const promise = new Promise<void>((res) => {
    resolve = res;
  });
  return { promise, resolve };
}

function wrapper({ children }: { children: ReactNode }) {
  return (
    <ModelDownloadManagerProvider>{children}</ModelDownloadManagerProvider>
  );
}

function createUseLLMMock(loadModel: (modelId: string) => Promise<void>) {
  return {
    loadedModel: null,
    modelType: null,
    isLoading: false,
    loadProgress: null,
    error: null,
    isClassifying: false,
    loadModel,
    unloadModel: vi.fn(),
    generate: vi.fn(),
    classify: vi.fn(),
    abort: vi.fn(),
    isWebGPUSupported: vi.fn(),
    previouslyLoadedModel: null
  };
}

describe('ModelDownloadManagerProvider', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    localStorage.clear();
  });

  it('queues local model downloads and runs them sequentially', async () => {
    const deferredByModel = new Map<string, Deferred>();

    const loadModel = vi.fn((modelId: string) => {
      const existing = deferredByModel.get(modelId);
      if (existing) {
        return existing.promise;
      }

      const deferred = createDeferred();
      deferredByModel.set(modelId, deferred);
      return deferred.promise;
    });

    mockUseLLM.mockReturnValue(createUseLLMMock(loadModel));

    const { result } = renderHook(() => useModelDownloadManager(), { wrapper });

    let firstPromise: Promise<void> | undefined;
    let secondPromise: Promise<void> | undefined;
    await act(async () => {
      firstPromise = result.current.downloadModel('onnx/model-a');
      secondPromise = result.current.downloadModel('onnx/model-b');
      await Promise.resolve();
    });

    await waitFor(() => {
      expect(loadModel).toHaveBeenCalledTimes(1);
    });
    expect(loadModel).toHaveBeenNthCalledWith(1, 'onnx/model-a');
    expect(result.current.downloadingModelId).toBe('onnx/model-a');
    expect(result.current.queuedModelIds).toEqual(['onnx/model-b']);

    const firstDeferred = deferredByModel.get('onnx/model-a');
    if (!firstDeferred) {
      throw new Error('Expected deferred promise for first model');
    }
    await act(async () => {
      firstDeferred.resolve();
      await Promise.resolve();
    });

    await waitFor(() => {
      expect(loadModel).toHaveBeenCalledTimes(2);
    });
    expect(loadModel).toHaveBeenNthCalledWith(2, 'onnx/model-b');

    const secondDeferred = deferredByModel.get('onnx/model-b');
    if (!secondDeferred) {
      throw new Error('Expected deferred promise for second model');
    }
    await act(async () => {
      secondDeferred.resolve();
      await Promise.resolve();
    });

    if (!firstPromise || !secondPromise) {
      throw new Error('Expected download promises to be created');
    }
    await Promise.all([firstPromise, secondPromise]);

    await waitFor(() => {
      expect(result.current.downloadingModelId).toBeNull();
    });
    expect(result.current.queuedModelIds).toEqual([]);
  });

  it('deduplicates duplicate queued downloads for the same model', async () => {
    const deferred = createDeferred();
    const loadModel = vi.fn(() => deferred.promise);

    mockUseLLM.mockReturnValue(createUseLLMMock(loadModel));

    const { result } = renderHook(() => useModelDownloadManager(), { wrapper });

    let firstPromise: Promise<void> | undefined;
    let secondPromise: Promise<void> | undefined;
    await act(async () => {
      firstPromise = result.current.downloadModel('onnx/model-a');
      secondPromise = result.current.downloadModel('onnx/model-a');
      await Promise.resolve();
    });

    await waitFor(() => {
      expect(loadModel).toHaveBeenCalledTimes(1);
    });
    expect(result.current.queuedModelIds).toEqual([]);

    await act(async () => {
      deferred.resolve();
      await Promise.resolve();
    });

    if (!firstPromise || !secondPromise) {
      throw new Error('Expected both promises to be created');
    }
    await Promise.all([firstPromise, secondPromise]);
  });

  it('resumes persisted queue entries on mount', async () => {
    localStorage.setItem(
      'tearleads:model-download:queue',
      JSON.stringify(['onnx/model-resume'])
    );

    const deferred = createDeferred();
    const loadModel = vi.fn(() => deferred.promise);
    mockUseLLM.mockReturnValue(createUseLLMMock(loadModel));

    renderHook(() => useModelDownloadManager(), { wrapper });

    await waitFor(() => {
      expect(loadModel).toHaveBeenCalledWith('onnx/model-resume');
    });
  });
});
