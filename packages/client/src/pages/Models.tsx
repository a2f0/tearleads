import { deleteModelInCache, hasModelInCache } from '@mlc-ai/web-llm';
import {
  Bot,
  Check,
  Download,
  Eye,
  Loader2,
  Play,
  Square,
  Trash2
} from 'lucide-react';
import { useCallback, useEffect, useState } from 'react';
import { Button } from '@/components/ui/button';
import { useLLM } from '@/hooks/useLLM';

interface ModelInfo {
  id: string;
  name: string;
  size: string;
  description: string;
  isVision?: boolean;
}

// Curated list of recommended models
const RECOMMENDED_MODELS: ModelInfo[] = [
  {
    id: 'Phi-3.5-vision-instruct-q4f16_1-MLC',
    name: 'Phi 3.5 Vision',
    size: '~2.5GB',
    description: 'Vision model for image understanding',
    isVision: true
  },
  {
    id: 'Llama-3.2-1B-Instruct-q4f16_1-MLC',
    name: 'Llama 3.2 1B Instruct',
    size: '~700MB',
    description: 'Small and fast, good for basic tasks'
  },
  {
    id: 'Llama-3.2-3B-Instruct-q4f16_1-MLC',
    name: 'Llama 3.2 3B Instruct',
    size: '~1.8GB',
    description: 'Good balance of speed and capability'
  },
  {
    id: 'gemma-2-2b-it-q4f16_1-MLC',
    name: 'Gemma 2 2B',
    size: '~1.4GB',
    description: "Google's efficient open model"
  },
  {
    id: 'Phi-3.5-mini-instruct-q4f16_1-MLC',
    name: 'Phi 3.5 Mini',
    size: '~2GB',
    description: "Microsoft's efficient reasoning model"
  },
  {
    id: 'Qwen2.5-1.5B-Instruct-q4f16_1-MLC',
    name: 'Qwen 2.5 1.5B Instruct',
    size: '~1GB',
    description: "Alibaba's multilingual model"
  },
  {
    id: 'SmolLM2-1.7B-Instruct-q4f16_1-MLC',
    name: 'SmolLM2 1.7B Instruct',
    size: '~1GB',
    description: "HuggingFace's efficient small model"
  }
];

type ModelStatus = 'not_downloaded' | 'downloading' | 'ready' | 'loaded';

interface ModelCardProps {
  model: ModelInfo;
  status: ModelStatus;
  loadProgress: { text: string; progress: number } | null;
  disabled: boolean;
  onLoad: () => void;
  onUnload: () => void;
  onDelete: () => void;
}

function ModelCard({
  model,
  status,
  loadProgress,
  disabled,
  onLoad,
  onUnload,
  onDelete
}: ModelCardProps) {
  const isLoaded = status === 'loaded';
  const isDownloading = status === 'downloading';

  return (
    <div className="rounded-lg border bg-card p-4">
      <div className="flex items-start justify-between">
        <div className="flex items-center gap-3">
          <div
            className={`flex h-10 w-10 items-center justify-center rounded-lg ${(() => {
              if (isLoaded) return 'bg-green-500/10 text-green-500';
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
          {status === 'ready' && !isLoaded && (
            <span className="rounded-full bg-muted px-2 py-1 text-muted-foreground text-xs">
              Ready
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
        ) : (
          <Button
            variant="default"
            size="sm"
            onClick={onLoad}
            disabled={disabled}
          >
            {status === 'ready' ? (
              <>
                <Play className="mr-2 h-4 w-4" />
                Load
              </>
            ) : (
              <>
                <Download className="mr-2 h-4 w-4" />
                Download
              </>
            )}
          </Button>
        )}
        {status === 'ready' && !isLoaded && !isDownloading && (
          <Button
            variant="ghost"
            size="sm"
            onClick={onDelete}
            disabled={disabled}
          >
            <Trash2 className="h-4 w-4" />
          </Button>
        )}
      </div>
    </div>
  );
}

export function Models() {
  const {
    loadedModel,
    isLoading,
    loadProgress,
    error,
    loadModel,
    unloadModel,
    isWebGPUSupported
  } = useLLM();

  const [webGPUSupported, setWebGPUSupported] = useState<boolean | null>(null);
  const [loadingModelId, setLoadingModelId] = useState<string | null>(null);
  const [cachedModels, setCachedModels] = useState<Set<string>>(new Set());
  const [isCheckingCache, setIsCheckingCache] = useState(true);

  // Check WebGPU support on mount
  useEffect(() => {
    isWebGPUSupported().then(setWebGPUSupported);
  }, [isWebGPUSupported]);

  // Check for cached models using web-llm's official API on mount
  useEffect(() => {
    async function checkCachedModels() {
      try {
        const cacheCheckPromises = RECOMMENDED_MODELS.map(async (model) => {
          const isCached = await hasModelInCache(model.id);
          return isCached ? model.id : null;
        });
        const cachedIds = (await Promise.all(cacheCheckPromises)).filter(
          (id): id is string => id !== null
        );
        setCachedModels(new Set(cachedIds));
      } catch (err) {
        console.error('Failed to check cached models:', err);
      } finally {
        setIsCheckingCache(false);
      }
    }

    checkCachedModels();
  }, []);

  const handleLoad = useCallback(
    async (modelId: string) => {
      setLoadingModelId(modelId);
      try {
        await loadModel(modelId);
        // After successful load, mark as cached
        setCachedModels((prev) => new Set(prev).add(modelId));
      } finally {
        setLoadingModelId(null);
      }
    },
    [loadModel]
  );

  const handleUnload = useCallback(async () => {
    await unloadModel();
  }, [unloadModel]);

  const handleDelete = useCallback(async (modelId: string) => {
    try {
      await deleteModelInCache(modelId);
      setCachedModels((prev) => {
        const next = new Set(prev);
        next.delete(modelId);
        return next;
      });
    } catch (err) {
      console.error('Failed to delete cached model:', err);
    }
  }, []);

  const getModelStatus = (modelId: string): ModelStatus => {
    if (loadedModel === modelId) return 'loaded';
    if (loadingModelId === modelId && isLoading) return 'downloading';
    if (cachedModels.has(modelId)) return 'ready';
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
            Please use Chrome 113+, Edge 113+, or another WebGPU-enabled
            browser.
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

      <p className="text-muted-foreground text-sm">
        Download and run LLMs locally in your browser using WebGPU. Models are
        cached for future use.
      </p>

      {isCheckingCache ? (
        <div className="flex items-center justify-center py-8">
          <Loader2 className="h-6 w-6 animate-spin text-muted-foreground" />
          <span className="ml-2 text-muted-foreground text-sm">
            Checking cached models...
          </span>
        </div>
      ) : (
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
              onDelete={() => handleDelete(model.id)}
            />
          ))}
        </div>
      )}
    </div>
  );
}
