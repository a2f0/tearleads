import { isOpenRouterModelId } from '@tearleads/shared';
import { Bot, ChevronDown, Loader2 } from 'lucide-react';
import { useCallback, useEffect, useRef, useState } from 'react';
import { useLLM } from '@/hooks/ai';
import { CHAT_MODELS } from '@/lib/models';
import { ModelOption } from './ModelOption';

interface ModelSelectorProps {
  modelDisplayName: string | undefined;
  variant?: 'default' | 'compact';
}

type SelectorLayout = {
  isCompact: boolean;
  iconSizeClass: string;
  chevronSizeClass: string;
  sectionHeaderClasses: string;
  triggerPaddingClasses: string;
  menuSpacingClasses: string;
  menuMinWidthClasses: string;
  itemLayout: 'list' | 'table';
};

function getSelectorLayout(isCompact: boolean): SelectorLayout {
  return {
    isCompact,
    iconSizeClass: isCompact ? 'h-3.5 w-3.5' : 'h-4 w-4',
    chevronSizeClass: isCompact ? 'h-2.5 w-2.5' : 'h-3 w-3',
    sectionHeaderClasses: `px-2 font-medium text-muted-foreground uppercase tracking-wider ${
      isCompact ? 'text-[10px]' : 'text-[11px]'
    }`,
    triggerPaddingClasses: isCompact
      ? 'px-2.5 py-0.5 text-xs'
      : 'px-3 py-1 text-sm',
    menuSpacingClasses: isCompact ? 'p-1' : 'p-2',
    menuMinWidthClasses: isCompact ? 'mt-1.5 min-w-72' : 'mt-2 min-w-64',
    itemLayout: isCompact ? 'table' : 'list'
  };
}

function getTriggerStateClasses(modelDisplayName?: string) {
  return modelDisplayName
    ? 'bg-success/10 text-success hover:bg-success/20'
    : 'bg-muted text-muted-foreground hover:bg-accent';
}

function getTriggerLabel(
  isLoading: boolean,
  loadProgress: ReturnType<typeof useLLM>['loadProgress'],
  modelDisplayName?: string
) {
  if (isLoading && loadProgress) {
    return `Loading ${Math.round(loadProgress.progress * 100)}%`;
  }
  return modelDisplayName ?? 'Select Model';
}

function renderModelOptions(
  models: typeof CHAT_MODELS,
  loadedModel: string | null,
  layout: 'list' | 'table',
  onSelect: (modelId: string) => void
) {
  return models.map((model) => (
    <ModelOption
      key={model.id}
      model={model}
      isLoaded={loadedModel === model.id}
      layout={layout}
      onSelect={() => onSelect(model.id)}
    />
  ));
}

function renderModelDropdown(
  isOpen: boolean,
  layout: SelectorLayout,
  localModels: typeof CHAT_MODELS,
  openRouterModels: typeof CHAT_MODELS,
  loadedModel: string | null,
  onSelectModel: (modelId: string) => void
) {
  if (!isOpen) {
    return null;
  }

  return (
    <div
      role="menu"
      aria-orientation="vertical"
      aria-labelledby="model-selector-trigger"
      className={`absolute top-full right-0 z-50 rounded-lg border bg-background shadow-lg ${layout.menuMinWidthClasses}`}
    >
      <div className={layout.menuSpacingClasses}>
        <div className={layout.isCompact ? 'space-y-0.5' : 'space-y-1'}>
          <p className={layout.sectionHeaderClasses}>Local Models</p>
          {renderModelOptions(
            localModels,
            loadedModel,
            layout.itemLayout,
            onSelectModel
          )}
        </div>
        {openRouterModels.length > 0 ? (
          <div
            className={`mt-2 ${layout.isCompact ? 'space-y-0.5' : 'space-y-1'}`}
          >
            <p className={layout.sectionHeaderClasses}>OpenRouter Models</p>
            {renderModelOptions(
              openRouterModels,
              loadedModel,
              layout.itemLayout,
              onSelectModel
            )}
          </div>
        ) : null}
      </div>
    </div>
  );
}

export function ModelSelector({
  modelDisplayName,
  variant = 'default'
}: ModelSelectorProps) {
  const { loadedModel, isLoading, loadProgress, loadModel } = useLLM();
  const [isOpen, setIsOpen] = useState(false);
  const dropdownRef = useRef<HTMLDivElement>(null);
  const layout = getSelectorLayout(variant === 'compact');
  const localModels = CHAT_MODELS.filter(
    (model) => !isOpenRouterModelId(model.id)
  );
  const openRouterModels = CHAT_MODELS.filter((model) =>
    isOpenRouterModelId(model.id)
  );

  const handleToggle = useCallback(() => {
    setIsOpen((prev) => (isLoading ? prev : !prev));
  }, [isLoading]);

  const handleSelectModel = useCallback(
    async (modelId: string) => {
      setIsOpen(false);
      if (loadedModel === modelId) {
        return;
      }
      await loadModel(modelId);
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
        className={`flex items-center gap-2 rounded-full font-medium transition-colors ${getTriggerStateClasses(
          modelDisplayName
        )} ${isLoading ? 'cursor-wait' : 'cursor-pointer'} ${
          layout.triggerPaddingClasses
        }`}
      >
        {isLoading ? (
          <Loader2 className={`animate-spin ${layout.iconSizeClass}`} />
        ) : (
          <Bot className={layout.iconSizeClass} />
        )}
        {getTriggerLabel(isLoading, loadProgress, modelDisplayName)}
        <ChevronDown
          className={`transition-transform ${layout.chevronSizeClass} ${
            isOpen ? 'rotate-180' : ''
          }`}
        />
      </button>

      {renderModelDropdown(
        isOpen,
        layout,
        localModels,
        openRouterModels,
        loadedModel,
        handleSelectModel
      )}
    </div>
  );
}
