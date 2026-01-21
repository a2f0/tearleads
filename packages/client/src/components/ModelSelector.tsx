import { isOpenRouterModelId } from '@rapid/shared';
import { Bot, ChevronDown, Loader2 } from 'lucide-react';
import { useCallback, useEffect, useRef, useState } from 'react';
import { useLLM } from '@/hooks/useLLM';
import { CHAT_MODELS } from '@/lib/models';
import { ModelOption } from './ModelOption';

interface ModelSelectorProps {
  modelDisplayName: string | undefined;
  variant?: 'default' | 'compact';
}

export function ModelSelector({
  modelDisplayName,
  variant = 'default'
}: ModelSelectorProps) {
  const { loadedModel, isLoading, loadProgress, loadModel } = useLLM();
  const [isOpen, setIsOpen] = useState(false);
  const dropdownRef = useRef<HTMLDivElement>(null);
  const isCompact = variant === 'compact';
  const iconSizeClass = isCompact ? 'h-3.5 w-3.5' : 'h-4 w-4';
  const chevronSizeClass = isCompact ? 'h-2.5 w-2.5' : 'h-3 w-3';
  const sectionHeaderClasses = `px-2 font-medium text-muted-foreground uppercase tracking-wider ${
    isCompact ? 'text-[10px]' : 'text-[11px]'
  }`;
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
        className={`flex items-center gap-2 rounded-full font-medium transition-colors ${
          modelDisplayName
            ? 'bg-success/10 text-success hover:bg-success/20'
            : 'bg-muted text-muted-foreground hover:bg-accent'
        } ${isLoading ? 'cursor-wait' : 'cursor-pointer'} ${
          isCompact ? 'px-2.5 py-0.5 text-xs' : 'px-3 py-1 text-sm'
        }`}
      >
        {isLoading ? (
          <Loader2 className={`animate-spin ${iconSizeClass}`} />
        ) : (
          <Bot className={iconSizeClass} />
        )}
        {isLoading && loadProgress
          ? `Loading ${Math.round(loadProgress.progress * 100)}%`
          : (modelDisplayName ?? 'Select Model')}
        <ChevronDown
          className={`transition-transform ${chevronSizeClass} ${
            isOpen ? 'rotate-180' : ''
          }`}
        />
      </button>

      {isOpen && (
        <div
          role="menu"
          aria-orientation="vertical"
          aria-labelledby="model-selector-trigger"
          className={`absolute top-full right-0 z-50 rounded-lg border bg-background shadow-lg ${
            isCompact ? 'mt-1.5 min-w-56' : 'mt-2 min-w-64'
          }`}
        >
          <div className={isCompact ? 'p-1.5' : 'p-2'}>
            <p
              className={`mb-2 px-2 font-medium text-muted-foreground uppercase tracking-wider ${
                isCompact ? 'text-[10px]' : 'text-xs'
              }`}
            >
              Available Models
            </p>
            <div className="space-y-1">
              <p className={sectionHeaderClasses}>Local Models</p>
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
                <p className={sectionHeaderClasses}>OpenRouter Models</p>
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
