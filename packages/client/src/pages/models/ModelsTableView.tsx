import { isOpenRouterModelId } from '@rapid/shared';
import { Download, Loader2, Play, Square, Trash2 } from 'lucide-react';
import { Button } from '@/components/ui/button';
import type { ModelInfo } from '@/lib/models';
import type { ModelStatus } from './ModelCard';

interface ModelsTableViewProps {
  recommendedModels: ModelInfo[];
  openRouterModels: ModelInfo[];
  loadedModel: string | null;
  loadingModelId: string | null;
  loadProgress: { text: string; progress: number } | null;
  getModelStatus: (modelId: string) => ModelStatus;
  onLoad: (modelId: string) => void;
  onUnload: () => void;
  onDelete: (modelId: string) => void;
}

function getStatusLabel(status: ModelStatus, isRemote: boolean): string {
  switch (status) {
    case 'loaded':
      return 'Loaded';
    case 'cached':
      return 'Downloaded';
    case 'downloading':
      return 'Downloading';
    case 'not_downloaded':
      return isRemote ? 'Available' : 'Not downloaded';
  }
}

function getStatusStyles(status: ModelStatus): string {
  switch (status) {
    case 'loaded':
      return 'bg-success/10 text-success';
    case 'cached':
      return 'bg-info/10 text-info';
    case 'downloading':
      return 'bg-primary/10 text-primary';
    case 'not_downloaded':
      return 'bg-muted text-muted-foreground';
  }
}

export function ModelsTableView({
  recommendedModels,
  openRouterModels,
  loadedModel,
  loadingModelId,
  loadProgress,
  getModelStatus,
  onLoad,
  onUnload,
  onDelete
}: ModelsTableViewProps) {
  const sections = [
    {
      title: 'Recommended Models',
      description:
        'Download and run LLMs locally in your browser. These models are optimized for WebGPU.',
      models: recommendedModels,
      getStatus: (model: ModelInfo) => getModelStatus(model.id)
    },
    {
      title: 'OpenRouter Models',
      description: 'Run chat completions on the server using OpenRouter.',
      models: openRouterModels,
      getStatus: (model: ModelInfo) =>
        loadedModel === model.id ? 'loaded' : 'not_downloaded'
    }
  ];

  return (
    <div className="space-y-4">
      {sections
        .filter((section) => section.models.length > 0)
        .map((section) => (
          <div key={section.title} className="space-y-2">
            <div className="space-y-1">
              <h2 className="font-semibold text-sm">{section.title}</h2>
              <p className="text-muted-foreground text-xs">
                {section.description}
              </p>
            </div>
            <div className="overflow-x-auto rounded-md border">
              <table
                className="w-full border-collapse text-xs"
                aria-label={`${section.title} table`}
              >
                <thead className="bg-muted/40 text-muted-foreground">
                  <tr>
                    <th className="px-2 py-2 text-left font-medium">Model</th>
                    <th className="px-2 py-2 text-left font-medium">Size</th>
                    <th className="px-2 py-2 text-left font-medium">Status</th>
                    <th className="px-2 py-2 text-right font-medium">
                      Actions
                    </th>
                  </tr>
                </thead>
                <tbody>
                  {section.models.map((model) => {
                    const isRemote = isOpenRouterModelId(model.id);
                    const status = section.getStatus(model);
                    const isLoaded = status === 'loaded';
                    const isCached = !isRemote && status === 'cached';
                    const isDownloading = !isRemote && status === 'downloading';
                    const hasProgress =
                      isDownloading &&
                      loadingModelId === model.id &&
                      loadProgress !== null;
                    const progressValue = loadProgress?.progress ?? 0;
                    const progressText = loadProgress?.text ?? '';
                    const isBusy = loadingModelId !== null;

                    return (
                      <tr
                        key={model.id}
                        className="border-b last:border-b-0 hover:bg-muted/20"
                      >
                        <td className="px-2 py-2 align-top">
                          <div className="flex flex-wrap items-center gap-2">
                            <span className="font-medium">{model.name}</span>
                            {model.isVision && (
                              <span className="rounded-full bg-chart-4/10 px-2 py-0.5 font-medium text-[11px] text-chart-4">
                                Vision
                              </span>
                            )}
                            {isRemote && (
                              <span className="rounded-full bg-info/10 px-2 py-0.5 font-medium text-[11px] text-info">
                                Remote
                              </span>
                            )}
                          </div>
                          <div className="mt-1 text-muted-foreground text-xs">
                            {model.description}
                          </div>
                        </td>
                        <td className="px-2 py-2 align-top text-muted-foreground">
                          {model.size}
                        </td>
                        <td className="px-2 py-2 align-top">
                          <div className="space-y-2">
                            <span
                              className={`inline-flex items-center rounded-full px-2 py-0.5 font-medium text-[11px] ${getStatusStyles(
                                status
                              )}`}
                            >
                              {getStatusLabel(status, isRemote)}
                            </span>
                            {hasProgress && (
                              <div className="space-y-1">
                                <div className="h-1.5 w-28 overflow-hidden rounded-full bg-muted">
                                  <div
                                    className="h-full bg-primary transition-all duration-300"
                                    style={{
                                      width: `${progressValue * 100}%`
                                    }}
                                  />
                                </div>
                                <span className="text-muted-foreground text-xs">
                                  {progressText}
                                </span>
                              </div>
                            )}
                          </div>
                        </td>
                        <td className="px-2 py-2 align-top">
                          <div className="flex items-center justify-end gap-2">
                            {isLoaded ? (
                              <Button
                                variant="outline"
                                size="sm"
                                onClick={onUnload}
                                disabled={isBusy}
                              >
                                <Square className="h-3 w-3" />
                                {isRemote ? 'Disconnect' : 'Unload'}
                              </Button>
                            ) : isDownloading ? (
                              <Button variant="outline" size="sm" disabled>
                                <Loader2 className="h-3 w-3 animate-spin" />
                                Loading...
                              </Button>
                            ) : isCached ? (
                              <>
                                <Button
                                  variant="default"
                                  size="sm"
                                  onClick={() => onLoad(model.id)}
                                  disabled={isBusy}
                                >
                                  <Play className="h-3 w-3" />
                                  Load
                                </Button>
                                <Button
                                  variant="outline"
                                  size="sm"
                                  className="px-2"
                                  onClick={() => onDelete(model.id)}
                                  disabled={isBusy}
                                  aria-label="Delete from cache"
                                >
                                  <Trash2 className="h-3 w-3" />
                                </Button>
                              </>
                            ) : isRemote ? (
                              <Button
                                variant="default"
                                size="sm"
                                onClick={() => onLoad(model.id)}
                                disabled={isBusy}
                              >
                                <Play className="h-3 w-3" />
                                Use
                              </Button>
                            ) : (
                              <Button
                                variant="default"
                                size="sm"
                                onClick={() => onLoad(model.id)}
                                disabled={isBusy}
                              >
                                <Download className="h-3 w-3" />
                                Download
                              </Button>
                            )}
                          </div>
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
          </div>
        ))}
    </div>
  );
}
