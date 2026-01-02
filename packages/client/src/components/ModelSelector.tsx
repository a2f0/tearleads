import { Bot, Check, ChevronDown, Eye, Loader2 } from 'lucide-react';
import { useCallback, useEffect, useRef, useState } from 'react';
import { useLLM } from '@/hooks/useLLM';
import type { ModelInfo } from '@/lib/models';
import { RECOMMENDED_MODELS } from '@/lib/models';

interface ModelSelectorProps {
  modelDisplayName: string | undefined;
}

export function ModelSelector({ modelDisplayName }: ModelSelectorProps) {
  const { loadedModel, isLoading, loadProgress, loadModel } = useLLM();
  const [isOpen, setIsOpen] = useState(false);
  const dropdownRef = useRef<HTMLDivElement>(null);

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
      if (
        dropdownRef.current &&
        !dropdownRef.current.contains(event.target as Node)
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
            ? 'bg-green-500/10 text-green-500 hover:bg-green-500/20'
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
            {RECOMMENDED_MODELS.map((model) => (
              <ModelOption
                key={model.id}
                model={model}
                isLoaded={loadedModel === model.id}
                onSelect={() => handleSelectModel(model.id)}
              />
            ))}
          </div>
        </div>
      )}
    </div>
  );
}

interface ModelOptionProps {
  model: ModelInfo;
  isLoaded: boolean;
  onSelect: () => void;
}

function ModelOption({ model, isLoaded, onSelect }: ModelOptionProps) {
  return (
    <button
      type="button"
      role="menuitem"
      onClick={onSelect}
      className={`flex w-full items-center gap-3 rounded-md px-2 py-2 text-left transition-colors hover:bg-accent ${
        isLoaded ? 'bg-green-500/5' : ''
      }`}
    >
      <div
        className={`flex h-8 w-8 shrink-0 items-center justify-center rounded-md ${
          isLoaded
            ? 'bg-green-500/10 text-green-500'
            : model.isVision
              ? 'bg-purple-500/10 text-purple-500'
              : 'bg-muted text-muted-foreground'
        }`}
      >
        {model.isVision ? (
          <Eye className="h-4 w-4" />
        ) : (
          <Bot className="h-4 w-4" />
        )}
      </div>
      <div className="min-w-0 flex-1">
        <div className="flex items-center gap-2">
          <span className="font-medium text-sm">{model.name}</span>
          {model.isVision && (
            <span className="rounded-full bg-purple-500/10 px-1.5 py-0.5 font-medium text-purple-500 text-xs">
              Vision
            </span>
          )}
        </div>
        <p className="truncate text-muted-foreground text-xs">{model.size}</p>
      </div>
      {isLoaded && <Check className="h-4 w-4 shrink-0 text-green-500" />}
    </button>
  );
}
