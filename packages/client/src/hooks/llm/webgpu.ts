/**
 * WebGPU support utilities.
 */

/// <reference types="@webgpu/types" />

import { getWebGPUErrorInfo } from '@/lib/utils';
import {
  emitChange,
  sendRequest,
  setLoadCallbacks,
  setLoadingModelId,
  store
} from './store';

export async function checkWebGPUSupport(): Promise<boolean> {
  if (typeof navigator === 'undefined') return false;
  if (!('gpu' in navigator)) return false;

  try {
    const adapter = await navigator.gpu.requestAdapter();
    return adapter !== null;
  } catch {
    return false;
  }
}

export async function loadLocalModel(modelId: string): Promise<void> {
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
  setLoadingModelId(modelId);
  emitChange();

  return new Promise<void>((resolve, reject) => {
    setLoadCallbacks(resolve, reject);
    sendRequest({ type: 'load', modelId });
  });
}
