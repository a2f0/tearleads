import { isOpenRouterModelId } from '@rapid/shared';
import { Bot, ChevronDown, Loader2 } from 'lucide-react';
import { useCallback, useEffect, useRef, useState } from 'react';
import { useLLM } from '@/hooks/useLLM';
import { CHAT_MODELS } from '@/lib/models';
import { ModelOption } from './ModelOption';

interface ModelSelectorProps {
  modelDisplayName: string | undefined;
}

export function ModelSelector({ modelDisplayName }: ModelSelectorProps) {
  const { loadedModel, isLoading, loadProgress, loadModel } = useLLM();
  const [isOpen, setIsOpen] = useState(false);
  const dropdownRef = useRef<HTMLDivElement>(null);
  const localModels = CHAT_MODELS.filter(
    (model) => !isOpenRouterModelId(model.id)
  );
  const openRouterModels = CHAT_MODELS.filter((model) =>
    isOpenRouterModelId(model.id)
  );

  const handleToggle = useCallback(() => {
    if (!isLoading) {
      setIsOpen((prev) => !prev);
    }
  }, [isLoading]);

  const handleSelectModel = useCallback(
    async (modelId: string) => {
      setIsOpen(false);
      if (loadedModel !== modelId) {
        await loadModel(modelId);
      }
    },
    [loadedModel, loadModel]
  );

  useEffect(() => {
    const handleClickOutside = (event: MouseEvent) => {
      const target = event.target;
      if (
        dropdownRef.current &&
        target instanceof Node &&
        !dropdownRef.current.contains(target)
      ) {
        setIsOpen(false);
      }
    };

    const handleEscape = (event: KeyboardEvent) => {
      if (event.key === 'Escape') {
        setIsOpen(false);
      }
    };

    if (isOpen) {
      document.addEventListener('mousedown', handleClickOutside);
      document.addEventListener('keydown', handleEscape);
    }

    return () => {
      document.removeEventListener('mousedown', handleClickOutside);
      document.removeEventListener('keydown', handleEscape);
    };
  }, [isOpen]);

  return (
    <div className="relative" ref={dropdownRef}>
      <button
        id="model-selector-trigger"
        type="button"
        onClick={handleToggle}
        disabled={isLoading}
        aria-haspopup="true"
        aria-expanded={isOpen}
        className={`flex items-center gap-2 rounded-full px-3 py-1 font-medium text-sm transition-colors ${
          modelDisplayName
            ? 'bg-success/10 text-success hover:bg-success/20'
            : 'bg-muted text-muted-foreground hover:bg-accent'
        } ${isLoading ? 'cursor-wait' : 'cursor-pointer'}`}
      >
        {isLoading ? (
          <Loader2 className="h-4 w-4 animate-spin" />
        ) : (
          <Bot className="h-4 w-4" />
        )}
        {isLoading && loadProgress
          ? `Loading ${Math.round(loadProgress.progress * 100)}%`
          : (modelDisplayName ?? 'Select Model')}
        <ChevronDown
          className={`h-3 w-3 transition-transform ${isOpen ? 'rotate-180' : ''}`}
        />
      </button>

      {isOpen && (
        <div
          role="menu"
          aria-orientation="vertical"
          aria-labelledby="model-selector-trigger"
          className="absolute top-full right-0 z-50 mt-2 min-w-64 rounded-lg border bg-background shadow-lg"
        >
          <div className="p-2">
            <p className="mb-2 px-2 font-medium text-muted-foreground text-xs uppercase tracking-wider">
              Available Models
            </p>
            <div className="space-y-1">
              <p className="px-2 font-medium text-[11px] text-muted-foreground uppercase tracking-wider">
                Local Models
              </p>
              {localModels.map((model) => (
                <ModelOption
                  key={model.id}
                  model={model}
                  isLoaded={loadedModel === model.id}
                  onSelect={() => handleSelectModel(model.id)}
                />
              ))}
            </div>
            {openRouterModels.length > 0 && (
              <div className="mt-2 space-y-1">
                <p className="px-2 font-medium text-[11px] text-muted-foreground uppercase tracking-wider">
                  OpenRouter Models
                </p>
                {openRouterModels.map((model) => (
                  <ModelOption
                    key={model.id}
                    model={model}
                    isLoaded={loadedModel === model.id}
                    onSelect={() => handleSelectModel(model.id)}
                  />
                ))}
              </div>
            )}
          </div>
        </div>
      )}
    </div>
  );
}
