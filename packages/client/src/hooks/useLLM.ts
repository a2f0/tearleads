/// <reference types="@webgpu/types" />
import { useCallback, useSyncExternalStore } from 'react';
import { getDatabase } from '@/db';
import { logEvent as logAnalyticsEvent } from '@/db/analytics';

// Types for worker messages
interface ChatMessage {
  role: 'system' | 'user' | 'assistant';
  content: string;
}

type WorkerRequest =
  | { type: 'load'; modelId: string }
  | { type: 'generate'; messages: ChatMessage[]; image?: string }
  | { type: 'unload' }
  | { type: 'abort' };

type ModelType = 'chat' | 'vision' | 'paligemma';

type WorkerResponse =
  | { type: 'progress'; file: string; progress: number; total: number }
  | {
      type: 'loaded';
      modelId: string;
      modelType: ModelType;
      durationMs: number;
    }
  | { type: 'token'; text: string }
  | { type: 'done'; durationMs: number; promptType: 'text' | 'multimodal' }
  | { type: 'error'; message: string }
  | { type: 'unloaded' };

export interface LoadProgress {
  text: string;
  progress: number;
}

export interface LLMState {
  loadedModel: string | null;
  modelType: ModelType | null;
  isLoading: boolean;
  loadProgress: LoadProgress | null;
  error: string | null;
}

export type GenerateCallback = (text: string) => void;

export interface UseLLMReturn extends LLMState {
  loadModel: (modelId: string) => Promise<void>;
  unloadModel: () => Promise<void>;
  generate: (
    messages: ChatMessage[],
    onToken: GenerateCallback,
    image?: string
  ) => Promise<void>;
  abort: () => void;
  isWebGPUSupported: () => Promise<boolean>;
}

// Shared store for LLM state - enables reactive updates across all hook consumers
const store: LLMState = {
  loadedModel: null,
  modelType: null,
  isLoading: false,
  loadProgress: null,
  error: null
};

// Pub-sub mechanism for useSyncExternalStore
const listeners = new Set<() => void>();

/**
 * Log an analytics event for LLM operations.
 * Silently fails if database is not available.
 */
async function logLLMAnalytics(
  eventName: string,
  durationMs: number,
  success: boolean
): Promise<void> {
  try {
    const db = getDatabase();
    if (db) {
      await logAnalyticsEvent(db, eventName, durationMs, success);
    }
  } catch {
    // Silently ignore - analytics should never break main functionality
  }
}

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

// Singleton worker
let worker: Worker | null = null;

// Callbacks for generation streaming
let currentTokenCallback: GenerateCallback | null = null;
let currentGenerateResolve: (() => void) | null = null;
let currentGenerateReject: ((error: Error) => void) | null = null;

// Promise for load operation
let loadResolve: (() => void) | null = null;
let loadReject: ((error: Error) => void) | null = null;

function getWorker(): Worker {
  if (!worker) {
    worker = new Worker(new URL('../workers/llm-worker.ts', import.meta.url), {
      type: 'module'
    });

    worker.onmessage = (event: MessageEvent<WorkerResponse>) => {
      const response = event.data;

      switch (response.type) {
        case 'progress': {
          if (loadingModelId) {
            const progressPercent =
              response.total > 0
                ? response.progress / response.total
                : response.progress;
            store.loadProgress = {
              text: `Downloading ${response.file}...`,
              progress: Math.min(1, progressPercent)
            };
            emitChange();
          }
          break;
        }

        case 'loaded': {
          store.loadedModel = response.modelId;
          store.modelType = response.modelType;
          store.isLoading = false;
          store.loadProgress = null;
          loadingModelId = null;
          emitChange();

          // Log analytics for model loading
          logLLMAnalytics('llm_model_load', response.durationMs, true);

          if (loadResolve) {
            loadResolve();
            loadResolve = null;
            loadReject = null;
          }
          break;
        }

        case 'token': {
          if (currentTokenCallback) {
            currentTokenCallback(response.text);
          }
          break;
        }

        case 'done': {
          // Log analytics based on prompt type
          const eventName =
            response.promptType === 'multimodal'
              ? 'llm_prompt_multimodal'
              : 'llm_prompt_text';
          logLLMAnalytics(eventName, response.durationMs, true);

          if (currentGenerateResolve) {
            currentGenerateResolve();
            currentGenerateResolve = null;
            currentGenerateReject = null;
            currentTokenCallback = null;
          }
          break;
        }

        case 'error': {
          store.error = response.message;
          store.isLoading = false;
          store.loadProgress = null;
          loadingModelId = null;
          emitChange();

          if (loadReject) {
            loadReject(new Error(response.message));
            loadResolve = null;
            loadReject = null;
          }

          if (currentGenerateReject) {
            currentGenerateReject(new Error(response.message));
            currentGenerateResolve = null;
            currentGenerateReject = null;
            currentTokenCallback = null;
          }
          break;
        }

        case 'unloaded': {
          store.loadedModel = null;
          store.modelType = null;
          store.error = null;
          store.loadProgress = null;
          emitChange();
          break;
        }
      }
    };

    worker.onerror = (error) => {
      const errorMessage = `Worker error: ${error.message}`;
      store.error = errorMessage;
      store.isLoading = false;
      store.loadProgress = null;
      loadingModelId = null;
      emitChange();

      if (loadReject) {
        loadReject(new Error(errorMessage));
        loadResolve = null;
        loadReject = null;
      }

      if (currentGenerateReject) {
        currentGenerateReject(new Error(errorMessage));
        currentGenerateResolve = null;
        currentGenerateReject = null;
        currentTokenCallback = null;
      }
    };
  }
  return worker;
}

function sendRequest(request: WorkerRequest): void {
  getWorker().postMessage(request);
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

async function loadModelInternal(modelId: string): Promise<void> {
  // Don't reload if already loaded
  if (store.loadedModel === modelId) {
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
  store.loadProgress = { text: 'Initializing...', progress: 0 };
  loadingModelId = modelId;
  emitChange();

  return new Promise<void>((resolve, reject) => {
    loadResolve = resolve;
    loadReject = reject;
    sendRequest({ type: 'load', modelId });
  });
}

async function unloadModelInternal(): Promise<void> {
  sendRequest({ type: 'unload' });
}

async function generateInternal(
  messages: ChatMessage[],
  onToken: GenerateCallback,
  image?: string
): Promise<void> {
  if (!store.loadedModel) {
    throw new Error('No model loaded');
  }

  return new Promise<void>((resolve, reject) => {
    currentTokenCallback = onToken;
    currentGenerateResolve = resolve;
    currentGenerateReject = reject;
    const request: WorkerRequest = image
      ? { type: 'generate', messages, image }
      : { type: 'generate', messages };
    sendRequest(request);
  });
}

function abortInternal(): void {
  sendRequest({ type: 'abort' });
}

export function useLLM(): UseLLMReturn {
  const state = useSyncExternalStore(subscribe, getSnapshot, getSnapshot);

  const loadModel = useCallback(async (modelId: string) => {
    await loadModelInternal(modelId);
  }, []);

  const unloadModel = useCallback(async () => {
    await unloadModelInternal();
  }, []);

  const generate = useCallback(
    async (
      messages: ChatMessage[],
      onToken: GenerateCallback,
      image?: string
    ) => {
      await generateInternal(messages, onToken, image);
    },
    []
  );

  const abort = useCallback(() => {
    abortInternal();
  }, []);

  const isWebGPUSupported = useCallback(async () => {
    return checkWebGPUSupport();
  }, []);

  return {
    ...state,
    loadModel,
    unloadModel,
    generate,
    abort,
    isWebGPUSupported
  };
}

// Re-export ChatMessage type for consumers
export type { ChatMessage };
