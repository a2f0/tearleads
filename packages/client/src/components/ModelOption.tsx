import { isOpenRouterModelId } from '@rapid/shared';
import { Bot, Check, Eye } from 'lucide-react';
import type { ModelInfo } from '@/lib/models';

interface ModelOptionProps {
  model: ModelInfo;
  isLoaded: boolean;
  onSelect: () => void;
}

export function ModelOption({ model, isLoaded, onSelect }: ModelOptionProps) {
  const isRemote = isOpenRouterModelId(model.id);
  return (
    <button
      type="button"
      role="menuitem"
      onClick={onSelect}
      className={`flex w-full items-center gap-3 rounded-md px-2 py-2 text-left transition-colors hover:bg-accent ${
        isLoaded ? 'bg-success/5' : ''
      }`}
    >
      <div
        className={`flex h-8 w-8 shrink-0 items-center justify-center rounded-md ${
          isLoaded
            ? 'bg-success/10 text-success'
            : model.isVision
              ? 'bg-chart-4/10 text-chart-4'
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
            <span className="rounded-full bg-chart-4/10 px-1.5 py-0.5 font-medium text-chart-4 text-xs">
              Vision
            </span>
          )}
          {isRemote && (
            <span className="rounded-full bg-info/10 px-1.5 py-0.5 font-medium text-info text-xs">
              Remote
            </span>
          )}
        </div>
        <p className="truncate text-muted-foreground text-xs">{model.size}</p>
      </div>
      {isLoaded && <Check className="h-4 w-4 shrink-0 text-success" />}
    </button>
  );
}
