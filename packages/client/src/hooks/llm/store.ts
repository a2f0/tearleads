/**
 * LLM state store with pub-sub mechanism for React integration.
 */

import { getCurrentInstanceId } from '@/db';
import { clearLastLoadedModel, saveLastLoadedModel } from '../useAppLifecycle';
import { logLLMAnalytics } from './analytics';
import type {
  ClassificationResult,
  GenerateCallback,
  LLMState,
  WorkerRequest,
  WorkerResponse
} from './types';

// Mutable store for LLM state - only modified internally
export const store: LLMState = {
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

// Track current loading operation to handle cancellation
export let loadingModelId: string | null = null;

// Singleton worker
let worker: Worker | null = null;

// Callbacks for generation streaming
export let currentTokenCallback: GenerateCallback | null = null;
export let currentGenerateResolve: (() => void) | null = null;
export let currentGenerateReject: ((error: Error) => void) | null = null;

// Callbacks for classification
export let currentClassifyResolve:
  | ((result: ClassificationResult) => void)
  | null = null;
export let currentClassifyReject: ((error: Error) => void) | null = null;

// Promise for load operation
export let loadResolve: (() => void) | null = null;
export let loadReject: ((error: Error) => void) | null = null;

export function setLoadingModelId(id: string | null): void {
  loadingModelId = id;
}

export function setCurrentTokenCallback(cb: GenerateCallback | null): void {
  currentTokenCallback = cb;
}

export function setCurrentGenerateCallbacks(
  resolve: (() => void) | null,
  reject: ((error: Error) => void) | null
): void {
  currentGenerateResolve = resolve;
  currentGenerateReject = reject;
}

export function setCurrentClassifyCallbacks(
  resolve: ((result: ClassificationResult) => void) | null,
  reject: ((error: Error) => void) | null
): void {
  currentClassifyResolve = resolve;
  currentClassifyReject = reject;
}

export function setLoadCallbacks(
  resolve: (() => void) | null,
  reject: ((error: Error) => void) | null
): void {
  loadResolve = resolve;
  loadReject = reject;
}

export function subscribe(callback: () => void): () => void {
  listeners.add(callback);
  return () => listeners.delete(callback);
}

export function emitChange(): void {
  // Create a new immutable snapshot before notifying listeners
  // This ensures React can detect changes via reference comparison
  snapshot = { ...store };
  for (const listener of listeners) {
    listener();
  }
}

export function getSnapshot(): LLMState {
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

import { toast } from 'sonner';

export function getWorker(): Worker {
  if (!worker) {
    worker = new Worker(
      new URL('../../workers/llmWorker.ts', import.meta.url),
      {
        type: 'module'
      }
    );

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

export function sendRequest(request: WorkerRequest): void {
  getWorker().postMessage(request);
}
