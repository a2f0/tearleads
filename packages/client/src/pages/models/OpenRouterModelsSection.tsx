import { OPENROUTER_MODELS } from '@/lib/models';
import { ModelCard } from './ModelCard';

interface OpenRouterModelsSectionProps {
  loadedModel: string | null;
  loadingModelId: string | null;
  onLoad: (modelId: string) => void;
  onUnload: () => void;
}

export function OpenRouterModelsSection({
  loadedModel,
  loadingModelId,
  onLoad,
  onUnload
}: OpenRouterModelsSectionProps) {
  return (
    <>
      <div className="space-y-4">
        <h2 className="font-semibold text-lg">OpenRouter Models</h2>
        <p className="text-muted-foreground">
          Run chat completions on the server using OpenRouter.
        </p>
      </div>
      <div className="grid gap-4 lg:grid-cols-2">
        {OPENROUTER_MODELS.map((model) => (
          <ModelCard
            key={model.id}
            model={model}
            status={loadedModel === model.id ? 'loaded' : 'not_downloaded'}
            loadProgress={null}
            disabled={loadingModelId !== null}
            onLoad={() => onLoad(model.id)}
            onUnload={onUnload}
            onDelete={() => {}}
          />
        ))}
      </div>
    </>
  );
}
