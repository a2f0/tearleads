import { isOpenRouterModelId } from '@rapid/shared';
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
import { Button } from '@/components/ui/button';
import type { ModelInfo } from '@/lib/models';

export type ModelStatus =
  | 'not_downloaded'
  | 'cached'
  | 'downloading'
  | 'loaded';

interface ModelCardProps {
  model: ModelInfo;
  status: ModelStatus;
  loadProgress: { text: string; progress: number } | null;
  disabled: boolean;
  onLoad: () => void;
  onUnload: () => void;
  onDelete: () => void;
}

export function ModelCard({
  model,
  status,
  loadProgress,
  disabled,
  onLoad,
  onUnload,
  onDelete
}: ModelCardProps) {
  const isRemote = isOpenRouterModelId(model.id);
  const isLoaded = status === 'loaded';
  const isDownloading = !isRemote && status === 'downloading';
  const isCached = !isRemote && status === 'cached';

  return (
    <div className="rounded-lg border bg-card p-4">
      <div className="flex items-start justify-between">
        <div className="flex items-center gap-3">
          <div
            className={`flex h-10 w-10 items-center justify-center rounded-lg ${(() => {
              if (isLoaded) return 'bg-success/10 text-success';
              if (isCached) return 'bg-info/10 text-info';
              if (model.isVision) return 'bg-chart-4/10 text-chart-4';
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
                <span className="rounded-full bg-chart-4/10 px-2 py-0.5 font-medium text-chart-4 text-xs">
                  Vision
                </span>
              )}
              {isRemote && (
                <span className="rounded-full bg-info/10 px-2 py-0.5 font-medium text-info text-xs">
                  Remote
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
            <span className="flex items-center gap-1 rounded-full bg-success/10 px-2 py-1 font-medium text-success text-xs">
              <Check className="h-3 w-3" />
              Loaded
            </span>
          )}
          {isCached && (
            <span className="flex items-center gap-1 rounded-full bg-info/10 px-2 py-1 font-medium text-info text-xs">
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
            {isRemote ? 'Disconnect' : 'Unload'}
          </Button>
        ) : isDownloading ? (
          <Button variant="outline" size="sm" disabled>
            <Loader2 className="mr-2 h-4 w-4 animate-spin" />
            Loading...
          </Button>
        ) : isCached ? (
          <>
            <Button
              variant="default"
              size="default"
              onClick={onLoad}
              disabled={disabled}
            >
              <Play className="mr-2 h-4 w-4" />
              Load
            </Button>
            <Button
              variant="outline"
              size="icon"
              onClick={onDelete}
              disabled={disabled}
              title="Delete from cache"
            >
              <Trash2 className="h-4 w-4" />
            </Button>
          </>
        ) : isRemote ? (
          <Button
            variant="default"
            size="sm"
            onClick={onLoad}
            disabled={disabled}
          >
            <Play className="mr-2 h-4 w-4" />
            Use
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
