import { isOpenRouterModelId } from '@rapid/shared';
import { Bot, Check, Eye } from 'lucide-react';
import type { ModelInfo } from '@/lib/models';

interface ModelOptionProps {
  model: ModelInfo;
  isLoaded: boolean;
  onSelect: () => void;
  layout?: 'list' | 'table';
}

export function ModelOption({
  model,
  isLoaded,
  onSelect,
  layout = 'list'
}: ModelOptionProps) {
  const isRemote = isOpenRouterModelId(model.id);
  const isTable = layout === 'table';
  return (
    <button
      type="button"
      role="menuitem"
      onClick={onSelect}
      className={`flex w-full items-center rounded-md text-left transition-colors hover:bg-accent ${
        isLoaded ? 'bg-success/5' : ''
      } ${isTable ? 'px-2 py-1' : 'gap-3 px-2 py-2'}`}
    >
      {!isTable && (
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
      )}
      <div
        className={
          isTable
            ? 'grid min-w-0 flex-1 grid-cols-[minmax(0,1fr)_auto] items-center gap-3'
            : 'min-w-0 flex-1'
        }
      >
        <div className="flex min-w-0 items-center gap-2">
          <span
            className={`truncate font-medium ${
              isTable ? 'text-xs' : 'text-sm'
            }`}
          >
            {model.name}
          </span>
          {model.isVision && (
            <span
              className={`shrink-0 rounded-full bg-chart-4/10 px-1.5 py-0.5 font-medium text-chart-4 ${
                isTable ? 'text-[10px]' : 'text-xs'
              }`}
            >
              Vision
            </span>
          )}
          {isRemote && (
            <span
              className={`shrink-0 rounded-full bg-info/10 px-1.5 py-0.5 font-medium text-info ${
                isTable ? 'text-[10px]' : 'text-xs'
              }`}
            >
              Remote
            </span>
          )}
        </div>
        {isTable ? (
          <span className="whitespace-nowrap text-[10px] text-muted-foreground">
            {model.size}
          </span>
        ) : (
          <p className="truncate text-muted-foreground text-xs">{model.size}</p>
        )}
      </div>
      {isLoaded && <Check className="h-4 w-4 shrink-0 text-success" />}
    </button>
  );
}
