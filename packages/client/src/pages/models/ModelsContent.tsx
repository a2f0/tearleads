import { Bot, RefreshCw } from 'lucide-react';
import { useCallback, useEffect, useState } from 'react';
import { BackLink } from '@/components/ui/back-link';
import { Button } from '@/components/ui/button';
import { useLLM } from '@/hooks/useLLM';
import { RECOMMENDED_MODELS } from '@/lib/models';
import { getWebGPUErrorInfo } from '@/lib/utils';
import { ModelCard, type ModelStatus } from './ModelCard';
import { type WebGPUInfo, WebGPUInfoPanel } from './WebGPUInfoPanel';

const TRANSFORMERS_CACHE_NAME = 'transformers-cache';

async function getWebGPUInfo(): Promise<WebGPUInfo | null> {
  if (!('gpu' in navigator)) return null;

  try {
    const adapter = await navigator.gpu.requestAdapter();
    if (!adapter) return null;

    const info = adapter.info;
    const limits = adapter.limits;

    return {
      adapterName: info.device || 'Unknown',
      vendor: info.vendor || 'Unknown',
      architecture: info.architecture || 'Unknown',
      maxBufferSize: limits.maxBufferSize,
      maxStorageBufferBindingSize: limits.maxStorageBufferBindingSize,
      maxComputeWorkgroupStorageSize: limits.maxComputeWorkgroupStorageSize,
      maxComputeInvocationsPerWorkgroup:
        limits.maxComputeInvocationsPerWorkgroup
    };
  } catch {
    return null;
  }
}

/**
 * Check if a model has been cached in browser storage.
 * Transformers.js caches model files under URLs containing the model ID.
 */
async function isModelCached(modelId: string): Promise<boolean> {
  if (!('caches' in window)) return false;

  try {
    if (!(await window.caches.has(TRANSFORMERS_CACHE_NAME))) {
      return false;
    }

    const cache = await window.caches.open(TRANSFORMERS_CACHE_NAME);
    const keys = await cache.keys();

    // Check if any cached URL contains the model ID
    // Transformers.js caches files under huggingface.co URLs
    return keys.some((request) => request.url.includes(modelId));
  } catch (error) {
    console.error('Failed to check model cache:', error);
    return false;
  }
}

/**
 * Check cache status for all recommended models.
 */
async function getModelCacheStatus(
  modelIds: string[]
): Promise<Record<string, boolean>> {
  const results = await Promise.all(
    modelIds.map(
      async (id): Promise<[string, boolean]> => [id, await isModelCached(id)]
    )
  );
  return Object.fromEntries(results);
}

/**
 * Delete a model from the browser cache.
 * Removes all cached files associated with the given model ID.
 */
async function deleteModelFromCache(modelId: string): Promise<boolean> {
  if (!('caches' in window)) return false;

  try {
    if (!(await window.caches.has(TRANSFORMERS_CACHE_NAME))) {
      return false;
    }

    const cache = await window.caches.open(TRANSFORMERS_CACHE_NAME);
    const keys = await cache.keys();

    // Delete all cached entries that contain the model ID
    const deletePromises = keys
      .filter((request) => request.url.includes(modelId))
      .map((request) => cache.delete(request));

    await Promise.all(deletePromises);
    return deletePromises.length > 0;
  } catch (error) {
    console.error('Failed to delete model from cache:', error);
    return false;
  }
}

interface ModelsContentProps {
  showBackLink?: boolean;
}

export function ModelsContent({ showBackLink = true }: ModelsContentProps) {
  const {
    loadedModel,
    loadProgress,
    error,
    loadModel,
    unloadModel,
    isWebGPUSupported,
    previouslyLoadedModel
  } = useLLM();

  const [webGPUSupported, setWebGPUSupported] = useState<boolean | null>(null);
  const [webGPUInfo, setWebGPUInfo] = useState<WebGPUInfo | null>(null);
  const [loadingModelId, setLoadingModelId] = useState<string | null>(null);
  const [cachedModels, setCachedModels] = useState<Record<string, boolean>>({});

  // Check WebGPU support and get adapter info on mount
  useEffect(() => {
    isWebGPUSupported().then(setWebGPUSupported);
    getWebGPUInfo().then(setWebGPUInfo);
  }, [isWebGPUSupported]);

  // Check which models are cached in browser storage on mount
  useEffect(() => {
    const modelIds = RECOMMENDED_MODELS.map((m) => m.id);
    getModelCacheStatus(modelIds).then(setCachedModels);
  }, []);

  const handleLoad = useCallback(
    async (modelId: string) => {
      setLoadingModelId(modelId);
      try {
        await loadModel(modelId);
        // Mark the model as cached after successful load
        setCachedModels((prev) => ({ ...prev, [modelId]: true }));
      } finally {
        setLoadingModelId((currentId) =>
          currentId === modelId ? null : currentId
        );
      }
    },
    [loadModel]
  );

  const handleUnload = useCallback(async () => {
    await unloadModel();
  }, [unloadModel]);

  const handleDelete = useCallback(async (modelId: string) => {
    const deleted = await deleteModelFromCache(modelId);
    if (deleted) {
      setCachedModels((prev) => ({ ...prev, [modelId]: false }));
    }
  }, []);

  const getModelStatus = (modelId: string): ModelStatus => {
    if (loadedModel === modelId) return 'loaded';
    if (loadingModelId === modelId) return 'downloading';
    if (cachedModels[modelId]) return 'cached';
    return 'not_downloaded';
  };

  if (webGPUSupported === false) {
    const errorInfo = getWebGPUErrorInfo();
    return (
      <div className="space-y-6">
        <div className="space-y-2">
        {showBackLink && <BackLink defaultTo="/" defaultLabel="Back to Home" />}
          <h1 className="font-bold text-2xl tracking-tight">Models</h1>
        </div>
        <div className="rounded-lg border border-destructive bg-destructive/10 p-8 text-center">
          <Bot className="mx-auto h-12 w-12 text-destructive" />
          <h2 className="mt-4 font-semibold text-lg">{errorInfo.title}</h2>
          <p className="mt-2 text-muted-foreground">{errorInfo.message}</p>
          <p className="mt-2 text-muted-foreground text-sm">
            {errorInfo.requirement}
          </p>
        </div>
      </div>
    );
  }

  return (
    <div className="space-y-6">
      <div className="space-y-2">
        {showBackLink && <BackLink defaultTo="/" defaultLabel="Back to Home" />}
        <div className="flex items-center justify-between">
          <h1 className="font-bold text-2xl tracking-tight">Models</h1>
          {webGPUSupported === null && (
            <span className="text-muted-foreground text-sm">
              Checking WebGPU support...
            </span>
          )}
        </div>
      </div>

      {error && (
        <div className="rounded-lg border border-destructive bg-destructive/10 p-4 text-destructive">
          {error}
        </div>
      )}

      {previouslyLoadedModel && !loadedModel && !loadingModelId && (
        <div className="rounded-lg border border-info/30 bg-info/5 p-4">
          <div className="flex items-center justify-between gap-4">
            <div className="flex items-center gap-3">
              <RefreshCw className="h-5 w-5 text-info" />
              <div>
                <p className="font-medium text-sm">
                  Model was unloaded after app reload
                </p>
                <p className="text-muted-foreground text-xs">
                  Your previously loaded model can be reloaded
                </p>
              </div>
            </div>
            <Button size="sm" onClick={() => handleLoad(previouslyLoadedModel)}>
              Reload Model
            </Button>
          </div>
        </div>
      )}

      <div className="space-y-4">
        <h2 className="font-semibold text-lg">Recommended Models</h2>
        <p className="text-muted-foreground">
          Download and run LLMs locally in your browser. These models are
          optimized for WebGPU.
        </p>
      </div>

      <div className="grid gap-4 lg:grid-cols-2">
        {RECOMMENDED_MODELS.map((model) => (
          <ModelCard
            key={model.id}
            model={model}
            status={getModelStatus(model.id)}
            loadProgress={loadingModelId === model.id ? loadProgress : null}
            disabled={loadingModelId !== null}
            onLoad={() => handleLoad(model.id)}
            onUnload={handleUnload}
            onDelete={() => handleDelete(model.id)}
          />
        ))}
      </div>

      {webGPUInfo && <WebGPUInfoPanel info={webGPUInfo} />}
    </div>
  );
}
