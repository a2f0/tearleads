/// <reference types="@webgpu/types" />
import {
  type InitProgressReport,
  type MLCEngineInterface,
  prebuiltAppConfig,
  WebWorkerMLCEngine
} from '@mlc-ai/web-llm';
import { useCallback, useSyncExternalStore } from 'react';

export interface LoadProgress {
  text: string;
  progress: number;
}

export interface LLMState {
  engine: MLCEngineInterface | null;
  loadedModel: string | null;
  isLoading: boolean;
  loadProgress: LoadProgress | null;
  error: string | null;
}

export interface UseLLMReturn extends LLMState {
  loadModel: (modelId: string) => Promise<void>;
  unloadModel: () => Promise<void>;
  isWebGPUSupported: () => Promise<boolean>;
}

// Shared store for LLM state - enables reactive updates across all hook consumers
const store: LLMState = {
  engine: null,
  loadedModel: null,
  isLoading: false,
  loadProgress: null,
  error: null
};

// Pub-sub mechanism for useSyncExternalStore
const listeners = new Set<() => void>();

function subscribe(callback: () => void): () => void {
  listeners.add(callback);
  return () => listeners.delete(callback);
}

function emitChange(): void {
  for (const listener of listeners) {
    listener();
  }
}

function getSnapshot(): LLMState {
  return store;
}

// Track current loading operation to handle cancellation
let loadingModelId: string | null = null;

// Singleton worker engine
let workerEngine: WebWorkerMLCEngine | null = null;

function getWorkerEngine(): WebWorkerMLCEngine {
  if (!workerEngine) {
    const worker = new Worker(
      new URL('../workers/llm-worker.ts', import.meta.url),
      { type: 'module' }
    );
    try {
      workerEngine = new WebWorkerMLCEngine(worker, {
        appConfig: {
          ...prebuiltAppConfig,
          useIndexedDBCache: true
        }
      });
    } catch (e) {
      // Terminate the worker if engine creation fails to prevent leaks.
      worker.terminate();
      throw e;
    }
  }
  return workerEngine;
}

async function checkWebGPUSupport(): Promise<boolean> {
  if (typeof navigator === 'undefined') return false;
  if (!('gpu' in navigator)) return false;

  try {
    const adapter = await navigator.gpu.requestAdapter();
    return adapter !== null;
  } catch {
    return false;
  }
}

async function unloadModelInternal(): Promise<void> {
  if (store.engine) {
    try {
      await store.engine.unload();
    } catch (err) {
      console.error('Error unloading model:', err);
    }
    store.engine = null;
    store.loadedModel = null;
  }
  store.error = null;
  store.loadProgress = null;
  emitChange();
}

async function loadModelInternal(modelId: string): Promise<void> {
  // Don't reload if already loaded
  if (store.loadedModel === modelId && store.engine) {
    return;
  }

  // Check WebGPU support
  const supported = await checkWebGPUSupport();
  if (!supported) {
    store.error =
      'WebGPU is not supported in this browser. Please use Chrome 113+ or Edge 113+.';
    emitChange();
    return;
  }

  store.isLoading = true;
  store.error = null;
  loadingModelId = modelId;
  emitChange();

  try {
    // Unload previous model if any
    await unloadModelInternal();

    // Set initial progress AFTER unload (unloadModelInternal clears loadProgress)
    store.loadProgress = { text: 'Initializing...', progress: 0 };
    emitChange();

    const engine = getWorkerEngine();

    engine.setInitProgressCallback((progress: InitProgressReport) => {
      // Only update if this is still the model we're loading
      if (loadingModelId === modelId) {
        store.loadProgress = {
          text: progress.text,
          progress: progress.progress
        };
        emitChange();
      }
    });

    await engine.reload(modelId);

    // Verify we're still loading this model (not cancelled)
    if (loadingModelId === modelId) {
      store.engine = engine;
      store.loadedModel = modelId;
      store.loadProgress = null;
      store.isLoading = false;
      loadingModelId = null;
      emitChange();
    } else {
      // User started loading a different model, unload this one
      await engine.unload();
    }
  } catch (err) {
    if (loadingModelId === modelId) {
      const message = err instanceof Error ? err.message : String(err);
      store.error = `Failed to load model: ${message}`;
      store.loadProgress = null;
      store.isLoading = false;
      loadingModelId = null;
      emitChange();
    }
  }
}

export function useLLM(): UseLLMReturn {
  const state = useSyncExternalStore(subscribe, getSnapshot, getSnapshot);

  const loadModel = useCallback(async (modelId: string) => {
    await loadModelInternal(modelId);
  }, []);

  const unloadModel = useCallback(async () => {
    await unloadModelInternal();
  }, []);

  const isWebGPUSupported = useCallback(async () => {
    return checkWebGPUSupport();
  }, []);

  return {
    ...state,
    loadModel,
    unloadModel,
    isWebGPUSupported
  };
}
