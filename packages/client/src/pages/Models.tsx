import {
  Bot,
  Check,
  ChevronDown,
  ChevronUp,
  Download,
  Eye,
  Loader2,
  Play,
  RefreshCw,
  Square
} from 'lucide-react';
import { useCallback, useEffect, useState } from 'react';
import { Button } from '@/components/ui/button';
import { useLLM } from '@/hooks/useLLM';
import type { ModelInfo } from '@/lib/models';
import { RECOMMENDED_MODELS } from '@/lib/models';

interface WebGPUInfo {
  adapterName: string;
  vendor: string;
  architecture: string;
  maxBufferSize: number;
  maxStorageBufferBindingSize: number;
  maxComputeWorkgroupStorageSize: number;
  maxComputeInvocationsPerWorkgroup: number;
}

function formatBytes(bytes: number): string {
  if (bytes >= 1024 * 1024 * 1024) {
    return `${(bytes / (1024 * 1024 * 1024)).toFixed(2)} GB`;
  }
  if (bytes >= 1024 * 1024) {
    return `${(bytes / (1024 * 1024)).toFixed(0)} MB`;
  }
  return `${(bytes / 1024).toFixed(0)} KB`;
}

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

  const TRANSFORMERS_CACHE_NAME = 'transformers-cache';

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
    modelIds.map(async (id) => [id, await isModelCached(id)] as const)
  );
  return Object.fromEntries(results);
}

function WebGPUInfoPanel({ info }: { info: WebGPUInfo }) {
  const [expanded, setExpanded] = useState(false);

  return (
    <div className="rounded-lg border bg-card p-4">
      <button
        type="button"
        onClick={() => setExpanded(!expanded)}
        className="flex w-full items-center justify-between text-left"
      >
        <div>
          <h3 className="font-medium text-sm">WebGPU Device</h3>
          <p className="text-muted-foreground text-xs">
            {info.adapterName} ({info.vendor})
          </p>
        </div>
        {expanded ? (
          <ChevronUp className="h-4 w-4 text-muted-foreground" />
        ) : (
          <ChevronDown className="h-4 w-4 text-muted-foreground" />
        )}
      </button>

      {expanded && (
        <div className="mt-3 space-y-2 border-t pt-3">
          <div className="grid grid-cols-2 gap-2 text-xs">
            <div>
              <span className="text-muted-foreground">Architecture:</span>
              <span className="ml-2 font-mono">{info.architecture}</span>
            </div>
            <div>
              <span className="text-muted-foreground">Max Buffer:</span>
              <span className="ml-2 font-mono">
                {formatBytes(info.maxBufferSize)}
              </span>
            </div>
            <div>
              <span className="text-muted-foreground">Max Storage Buffer:</span>
              <span className="ml-2 font-mono">
                {formatBytes(info.maxStorageBufferBindingSize)}
              </span>
            </div>
            <div>
              <span className="text-muted-foreground">Workgroup Storage:</span>
              <span className="ml-2 font-mono">
                {formatBytes(info.maxComputeWorkgroupStorageSize)}
              </span>
            </div>
          </div>
          <p className="text-muted-foreground text-xs">
            Note: Browser ArrayBuffer limit (~2.15GB) may restrict model loading
            regardless of GPU memory.
          </p>
        </div>
      )}
    </div>
  );
}

type ModelStatus = 'not_downloaded' | 'cached' | 'downloading' | 'loaded';

interface ModelCardProps {
  model: ModelInfo;
  status: ModelStatus;
  loadProgress: { text: string; progress: number } | null;
  disabled: boolean;
  onLoad: () => void;
  onUnload: () => void;
}

function ModelCard({
  model,
  status,
  loadProgress,
  disabled,
  onLoad,
  onUnload
}: ModelCardProps) {
  const isLoaded = status === 'loaded';
  const isDownloading = status === 'downloading';
  const isCached = status === 'cached';

  return (
    <div className="rounded-lg border bg-card p-4">
      <div className="flex items-start justify-between">
        <div className="flex items-center gap-3">
          <div
            className={`flex h-10 w-10 items-center justify-center rounded-lg ${(() => {
              if (isLoaded) return 'bg-green-500/10 text-green-500';
              if (isCached) return 'bg-blue-500/10 text-blue-500';
              if (model.isVision) return 'bg-purple-500/10 text-purple-500';
              return 'bg-muted text-muted-foreground';
            })()}`}
          >
            {model.isVision ? (
              <Eye className="h-5 w-5" />
            ) : (
              <Bot className="h-5 w-5" />
            )}
          </div>
          <div>
            <div className="flex items-center gap-2">
              <h3 className="font-medium">{model.name}</h3>
              {model.isVision && (
                <span className="rounded-full bg-purple-500/10 px-2 py-0.5 font-medium text-purple-500 text-xs">
                  Vision
                </span>
              )}
            </div>
            <p className="text-muted-foreground text-sm">
              {model.size} &bull; {model.description}
            </p>
          </div>
        </div>
        <div className="flex items-center gap-2">
          {isLoaded && (
            <span className="flex items-center gap-1 rounded-full bg-green-500/10 px-2 py-1 font-medium text-green-500 text-xs">
              <Check className="h-3 w-3" />
              Loaded
            </span>
          )}
          {isCached && (
            <span className="flex items-center gap-1 rounded-full bg-blue-500/10 px-2 py-1 font-medium text-blue-500 text-xs">
              <Check className="h-3 w-3" />
              Downloaded
            </span>
          )}
        </div>
      </div>

      {isDownloading && loadProgress && (
        <div className="mt-4 space-y-2">
          <div className="h-2 w-full overflow-hidden rounded-full bg-muted">
            <div
              className="h-full bg-primary transition-all duration-300"
              style={{ width: `${loadProgress.progress * 100}%` }}
            />
          </div>
          <p className="text-muted-foreground text-xs">{loadProgress.text}</p>
        </div>
      )}

      <div className="mt-4 flex gap-2">
        {isLoaded ? (
          <Button
            variant="outline"
            size="sm"
            onClick={onUnload}
            disabled={disabled}
          >
            <Square className="mr-2 h-4 w-4" />
            Unload
          </Button>
        ) : isDownloading ? (
          <Button variant="outline" size="sm" disabled>
            <Loader2 className="mr-2 h-4 w-4 animate-spin" />
            Loading...
          </Button>
        ) : isCached ? (
          <Button
            variant="default"
            size="sm"
            onClick={onLoad}
            disabled={disabled}
          >
            <Play className="mr-2 h-4 w-4" />
            Load
          </Button>
        ) : (
          <Button
            variant="default"
            size="sm"
            onClick={onLoad}
            disabled={disabled}
          >
            <Download className="mr-2 h-4 w-4" />
            Download
          </Button>
        )}
      </div>
    </div>
  );
}

export function Models() {
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

  const getModelStatus = (modelId: string): ModelStatus => {
    if (loadedModel === modelId) return 'loaded';
    if (loadingModelId === modelId) return 'downloading';
    if (cachedModels[modelId]) return 'cached';
    return 'not_downloaded';
  };

  if (webGPUSupported === false) {
    return (
      <div className="space-y-6">
        <h1 className="font-bold text-2xl tracking-tight">Models</h1>
        <div className="rounded-lg border border-destructive bg-destructive/10 p-8 text-center">
          <Bot className="mx-auto h-12 w-12 text-destructive" />
          <h2 className="mt-4 font-semibold text-lg">WebGPU Not Supported</h2>
          <p className="mt-2 text-muted-foreground">
            Your browser does not support WebGPU, which is required for local
            LLM inference.
          </p>
          <p className="mt-2 text-muted-foreground text-sm">
            Supported browsers: Chrome 113+, Edge 113+, Firefox 141+, Safari
            26+.
          </p>
          <p className="mt-1 text-muted-foreground text-sm">
            On mobile: iOS 26+ (Safari) or Android 12+ (Chrome 121+).
          </p>
        </div>
      </div>
    );
  }

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between">
        <h1 className="font-bold text-2xl tracking-tight">Models</h1>
        {webGPUSupported === null && (
          <span className="text-muted-foreground text-sm">
            Checking WebGPU support...
          </span>
        )}
      </div>

      {error && (
        <div className="rounded-lg border border-destructive bg-destructive/10 p-4 text-destructive">
          {error}
        </div>
      )}

      {previouslyLoadedModel && !loadedModel && !loadingModelId && (
        <div className="rounded-lg border border-blue-500/30 bg-blue-500/5 p-4">
          <div className="flex items-center justify-between gap-4">
            <div className="flex items-center gap-3">
              <RefreshCw className="h-5 w-5 text-blue-500" />
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
              <RefreshCw className="mr-2 h-4 w-4" />
              Reload Model
            </Button>
          </div>
        </div>
      )}

      <p className="text-muted-foreground text-sm">
        Download and run LLMs locally in your browser using WebGPU. Models are
        cached for future use.
      </p>

      {webGPUInfo && <WebGPUInfoPanel info={webGPUInfo} />}

      <div className="space-y-3">
        {RECOMMENDED_MODELS.map((model) => (
          <ModelCard
            key={model.id}
            model={model}
            status={getModelStatus(model.id)}
            loadProgress={loadingModelId === model.id ? loadProgress : null}
            disabled={loadingModelId !== null}
            onLoad={() => handleLoad(model.id)}
            onUnload={handleUnload}
          />
        ))}
      </div>
    </div>
  );
}
