/// <reference types="@webgpu/types" />
import { useCallback, useMemo, useSyncExternalStore } from 'react';
import { toast } from 'sonner';
import { getCurrentInstanceId, getDatabase } from '@/db';
import { logEvent as logAnalyticsEvent } from '@/db/analytics';
import { getWebGPUErrorInfo } from '@/lib/utils';
import {
  clearLastLoadedModel,
  getLastLoadedModel,
  saveLastLoadedModel
} from './useAppLifecycle';

// Types for worker messages
interface ChatMessage {
  role: 'system' | 'user' | 'assistant';
  content: string;
}

type WorkerRequest =
  | { type: 'load'; modelId: string }
  | { type: 'generate'; messages: ChatMessage[]; image?: string }
  | { type: 'classify'; image: string; candidateLabels: string[] }
  | { type: 'unload' }
  | { type: 'abort' };

type ModelType = 'chat' | 'vision' | 'paligemma' | 'clip';

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
  | {
      type: 'classification';
      labels: string[];
      scores: number[];
      durationMs: number;
    }
  | { type: 'error'; message: string }
  | { type: 'unloaded' };

export interface LoadProgress {
  text: string;
  progress: number;
}

export interface ClassificationResult {
  labels: string[];
  scores: number[];
}

export interface LLMState {
  loadedModel: string | null;
  modelType: ModelType | null;
  isLoading: boolean;
  loadProgress: LoadProgress | null;
  error: string | null;
  isClassifying: boolean;
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
  classify: (
    image: string,
    candidateLabels: string[]
  ) => Promise<ClassificationResult>;
  abort: () => void;
  isWebGPUSupported: () => Promise<boolean>;
  /** Model ID that was loaded before page reload (if any) */
  previouslyLoadedModel: string | null;
}

// Mutable store for LLM state - only modified internally
const store: LLMState = {
  loadedModel: null,
  modelType: null,
  isLoading: false,
  loadProgress: null,
  error: null,
  isClassifying: false
};

// Immutable snapshot for React - recreated on each state change
// This ensures useSyncExternalStore can properly detect changes via Object.is comparison
let snapshot: LLMState = { ...store };

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
  // Create a new immutable snapshot before notifying listeners
  // This ensures React can detect changes via reference comparison
  snapshot = { ...store };
  for (const listener of listeners) {
    listener();
  }
}

function getSnapshot(): LLMState {
  return snapshot;
}

/**
 * Reset LLM UI state when switching instances.
 * The model stays loaded in WebGPU/worker memory for quick switching back.
 * Only the UI-facing state is reset.
 */
export function resetLLMUIState(): void {
  // Keep model loaded in worker for quick switching back
  // store.loadedModel and store.modelType are preserved

  // Reset UI-facing state
  store.isLoading = false;
  store.loadProgress = null;
  store.error = null;
  store.isClassifying = false;

  // Abort any in-progress loading
  loadingModelId = null;

  // Reject any in-progress generation
  if (currentGenerateReject) {
    currentGenerateReject(new Error('Instance switched'));
  }
  currentTokenCallback = null;
  currentGenerateResolve = null;
  currentGenerateReject = null;

  // Reject any in-progress classification
  if (currentClassifyReject) {
    currentClassifyReject(new Error('Instance switched'));
  }
  currentClassifyResolve = null;
  currentClassifyReject = null;

  // Reject any pending load
  if (loadReject) {
    loadReject(new Error('Instance switched'));
  }
  loadResolve = null;
  loadReject = null;

  emitChange();
}

// Track current loading operation to handle cancellation
let loadingModelId: string | null = null;

// Singleton worker
let worker: Worker | null = null;

// Callbacks for generation streaming
let currentTokenCallback: GenerateCallback | null = null;
let currentGenerateResolve: (() => void) | null = null;
let currentGenerateReject: ((error: Error) => void) | null = null;

// Callbacks for classification
let currentClassifyResolve: ((result: ClassificationResult) => void) | null =
  null;
let currentClassifyReject: ((error: Error) => void) | null = null;

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

          // Persist model ID for recovery after page reload (instance-scoped)
          saveLastLoadedModel(
            response.modelId,
            getCurrentInstanceId() ?? undefined
          );

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

        case 'classification': {
          store.isClassifying = false;
          emitChange();

          // Log analytics for classification
          logLLMAnalytics('llm_classify_image', response.durationMs, true);

          if (currentClassifyResolve) {
            currentClassifyResolve({
              labels: response.labels,
              scores: response.scores
            });
            currentClassifyResolve = null;
            currentClassifyReject = null;
          }
          break;
        }

        case 'error': {
          store.error = response.message;
          store.isLoading = false;
          store.isClassifying = false;
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

          if (currentClassifyReject) {
            currentClassifyReject(new Error(response.message));
            currentClassifyResolve = null;
            currentClassifyReject = null;
          }
          break;
        }

        case 'unloaded': {
          store.loadedModel = null;
          store.modelType = null;
          store.error = null;
          store.loadProgress = null;
          emitChange();

          // Clear persisted model (instance-scoped)
          clearLastLoadedModel(getCurrentInstanceId() ?? undefined);
          break;
        }
      }
    };

    worker.onerror = (error) => {
      const errorMessage = `Worker error: ${error.message}`;
      store.error = errorMessage;
      store.isLoading = false;
      store.isClassifying = false;
      store.loadProgress = null;
      loadingModelId = null;
      emitChange();

      // Show toast for worker errors
      toast.error('Model worker crashed. Please reload the model.', {
        duration: 5000
      });

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

      if (currentClassifyReject) {
        currentClassifyReject(new Error(errorMessage));
        currentClassifyResolve = null;
        currentClassifyReject = null;
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
    const errorInfo = getWebGPUErrorInfo();
    store.error = `${errorInfo.message} ${errorInfo.requirement}`;
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

async function classifyInternal(
  image: string,
  candidateLabels: string[]
): Promise<ClassificationResult> {
  if (store.isClassifying) {
    throw new Error('A classification is already in progress');
  }

  if (!store.loadedModel) {
    throw new Error('No model loaded');
  }

  if (store.modelType !== 'clip') {
    throw new Error('Loaded model is not a CLIP model');
  }

  store.isClassifying = true;
  store.error = null;
  emitChange();

  return new Promise<ClassificationResult>((resolve, reject) => {
    currentClassifyResolve = resolve;
    currentClassifyReject = reject;
    sendRequest({ type: 'classify', image, candidateLabels });
  });
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

  const classify = useCallback(
    async (
      image: string,
      candidateLabels: string[]
    ): Promise<ClassificationResult> => {
      return classifyInternal(image, candidateLabels);
    },
    []
  );

  const abort = useCallback(() => {
    abortInternal();
  }, []);

  const isWebGPUSupported = useCallback(async () => {
    return checkWebGPUSupport();
  }, []);

  // Check for previously loaded model (from before page reload, instance-scoped)
  const previouslyLoadedModel = useMemo(() => {
    // Only return if no model is currently loaded
    if (state.loadedModel) return null;
    const instanceId = getCurrentInstanceId();
    return getLastLoadedModel(instanceId ?? undefined);
  }, [state.loadedModel]);

  return useMemo(
    () => ({
      ...state,
      loadModel,
      unloadModel,
      generate,
      classify,
      abort,
      isWebGPUSupported,
      previouslyLoadedModel
    }),
    [
      state,
      loadModel,
      unloadModel,
      generate,
      classify,
      abort,
      isWebGPUSupported,
      previouslyLoadedModel
    ]
  );
}

// Re-export ChatMessage type for consumers
export type { ChatMessage };
