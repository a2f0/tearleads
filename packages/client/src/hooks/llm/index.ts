/**
 * LLM hook for local and cloud-based language model inference.
 */

import {
  getOpenRouterModelOption,
  isOpenRouterModelId
} from '@tearleads/shared';
import { useCallback, useEffect, useMemo, useSyncExternalStore } from 'react';
import { getCurrentInstanceId } from '@/db';
import {
  clearLastLoadedModel,
  getLastLoadedModel,
  saveLastLoadedModel
} from '../useAppLifecycle';
import { logLLMAnalytics } from './analytics';
import { generateWithOpenRouter } from './openRouterClient';
import {
  emitChange,
  getSnapshot,
  sendRequest,
  setCurrentClassifyCallbacks,
  setCurrentGenerateCallbacks,
  setCurrentTokenCallback,
  setLoadingModelId,
  store,
  subscribe
} from './store';
import type {
  ChatMessage,
  ClassificationResult,
  GenerateCallback,
  UseLLMReturn
} from './types';
import { checkWebGPUSupport, loadLocalModel } from './webgpu';

export { resetLLMUIState } from './store';
// Re-export types and utilities
export type {
  ChatMessage,
  ClassificationResult,
  GenerateCallback,
  LLMState,
  LoadProgress,
  UseLLMReturn
} from './types';

async function loadModelInternal(modelId: string): Promise<void> {
  // Don't reload if already loaded
  if (store.loadedModel === modelId) {
    return;
  }

  if (isOpenRouterModelId(modelId)) {
    const start = performance.now();
    const openRouterModel = getOpenRouterModelOption(modelId);
    store.loadedModel = modelId;
    store.modelType = openRouterModel?.isVision ? 'vision' : 'chat';
    store.isLoading = false;
    store.error = null;
    store.loadProgress = null;
    setLoadingModelId(null);
    emitChange();

    saveLastLoadedModel(modelId, getCurrentInstanceId() ?? undefined);
    logLLMAnalytics('llm_model_load', performance.now() - start, true);
    return;
  }

  return loadLocalModel(modelId);
}

async function unloadModelInternal(): Promise<void> {
  if (store.loadedModel && isOpenRouterModelId(store.loadedModel)) {
    store.loadedModel = null;
    store.modelType = null;
    store.error = null;
    store.loadProgress = null;
    setLoadingModelId(null);
    emitChange();
    clearLastLoadedModel(getCurrentInstanceId() ?? undefined);
    return;
  }
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

  if (
    image &&
    store.modelType !== 'vision' &&
    store.modelType !== 'paligemma'
  ) {
    throw new Error('Image attachments require a vision-capable model');
  }

  if (isOpenRouterModelId(store.loadedModel)) {
    return generateWithOpenRouter(store.loadedModel, messages, onToken, image);
  }

  return new Promise<void>((resolve, reject) => {
    setCurrentTokenCallback(onToken);
    setCurrentGenerateCallbacks(resolve, reject);
    const request = image
      ? { type: 'generate' as const, messages, image }
      : { type: 'generate' as const, messages };
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
    setCurrentClassifyCallbacks(resolve, reject);
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

  useEffect(() => {
    if (
      !state.loadedModel &&
      !state.isLoading &&
      previouslyLoadedModel &&
      isOpenRouterModelId(previouslyLoadedModel)
    ) {
      void loadModel(previouslyLoadedModel);
    }
  }, [loadModel, previouslyLoadedModel, state.isLoading, state.loadedModel]);

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
