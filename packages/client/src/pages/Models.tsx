import { Bot, Check, Download, Eye, Loader2, Square } from 'lucide-react';
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

// Two recommended models: one chat, one vision
const RECOMMENDED_MODELS: ModelInfo[] = [
  {
    id: 'onnx-community/Phi-3-mini-4k-instruct',
    name: 'Phi-3 Mini',
    size: '~2GB',
    description: 'Fast chat model for general tasks'
  },
  {
    id: 'onnx-community/Phi-3.5-vision-instruct',
    name: 'Phi-3.5 Vision',
    size: '~2.8GB',
    description: 'Vision model for image understanding',
    isVision: true
  }
];

type ModelStatus = 'not_downloaded' | 'downloading' | 'loaded';

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
    isWebGPUSupported
  } = useLLM();

  const [webGPUSupported, setWebGPUSupported] = useState<boolean | null>(null);
  const [loadingModelId, setLoadingModelId] = useState<string | null>(null);

  // Check WebGPU support on mount
  useEffect(() => {
    isWebGPUSupported().then(setWebGPUSupported);
  }, [isWebGPUSupported]);

  const handleLoad = useCallback(
    async (modelId: string) => {
      setLoadingModelId(modelId);
      try {
        await loadModel(modelId);
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
