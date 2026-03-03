import { Bot } from 'lucide-react';
import { BackLink } from '@/components/ui/back-link';
import { OPENROUTER_MODELS } from '@/lib/models';
import { getWebGPUErrorInfo } from '@/lib/utils';
import type { ModelStatus } from './ModelCard';
import { ModelsTableView } from './ModelsTableView';
import { OpenRouterModelsSection } from './OpenRouterModelsSection';

interface UnsupportedWebGpuViewProps {
  isTableView: boolean;
  showBackLink: boolean;
  loadedModel: string | null;
  loadingModelId: string | null;
  loadProgress: { text: string; progress: number } | null;
  getModelStatus: (modelId: string) => ModelStatus;
  onLoad: (modelId: string) => Promise<void>;
  onUnload: () => Promise<void>;
  onDelete: (modelId: string) => Promise<void>;
}

export function UnsupportedWebGpuView({
  isTableView,
  showBackLink,
  loadedModel,
  loadingModelId,
  loadProgress,
  getModelStatus,
  onLoad,
  onUnload,
  onDelete
}: UnsupportedWebGpuViewProps) {
  const errorInfo = getWebGPUErrorInfo();

  return (
    <div className={isTableView ? 'space-y-4' : 'space-y-6'}>
      <div className="space-y-2">
        {showBackLink ? (
          <BackLink defaultTo="/" defaultLabel="Back to Home" />
        ) : null}
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
      {isTableView ? (
        <ModelsTableView
          recommendedModels={[]}
          openRouterModels={OPENROUTER_MODELS}
          loadedModel={loadedModel}
          loadingModelId={loadingModelId}
          loadProgress={loadProgress}
          getModelStatus={getModelStatus}
          onLoad={onLoad}
          onUnload={onUnload}
          onDelete={onDelete}
        />
      ) : (
        <OpenRouterModelsSection
          loadedModel={loadedModel}
          loadingModelId={loadingModelId}
          onLoad={onLoad}
          onUnload={onUnload}
        />
      )}
    </div>
  );
}
