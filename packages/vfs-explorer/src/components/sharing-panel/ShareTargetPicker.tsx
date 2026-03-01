import type { ShareTargetSearchResult, VfsShareType } from '@tearleads/shared';
import { Loader2, X } from 'lucide-react';
import type { ComponentType } from 'react';
import type { InputProps } from '../../context';
import { SHARE_TYPE_ICONS, SHARE_TYPE_LABELS } from './types';

interface ShareTargetPickerProps {
  Input: ComponentType<InputProps>;
  shareType: VfsShareType;
  selectedTargetId: string | null;
  selectedTargetName: string;
  searchQuery: string;
  searchResults: ShareTargetSearchResult[];
  searchLoading: boolean;
  onSearchQueryChange: (query: string) => void;
  onSelectTarget: (id: string, name: string) => void;
  onClearTarget: () => void;
}

export function ShareTargetPicker({
  Input,
  shareType,
  selectedTargetId,
  selectedTargetName,
  searchQuery,
  searchResults,
  searchLoading,
  onSearchQueryChange,
  onSelectTarget,
  onClearTarget
}: ShareTargetPickerProps) {
  if (selectedTargetId) {
    const SelectedIcon = SHARE_TYPE_ICONS[shareType];
    return (
      <div className="flex items-center gap-2 rounded border bg-muted/50 px-2 py-1">
        <SelectedIcon className="h-4 w-4 text-muted-foreground" />
        <span className="flex-1 truncate text-sm">{selectedTargetName}</span>
        <button
          type="button"
          className="text-muted-foreground hover:text-foreground"
          onClick={onClearTarget}
        >
          <X className="h-3 w-3" />
        </button>
      </div>
    );
  }

  return (
    <div className="relative">
      <Input
        type="text"
        placeholder={`Search ${SHARE_TYPE_LABELS[shareType].toLowerCase()}s...`}
        value={searchQuery}
        onChange={(e) => onSearchQueryChange(e.target.value)}
        className="text-base"
        data-testid="share-target-search"
      />
      {searchLoading && (
        <Loader2 className="absolute top-1/2 right-2 h-4 w-4 -translate-y-1/2 animate-spin text-muted-foreground" />
      )}
      {searchResults.length > 0 && (
        <div className="absolute top-full right-0 left-0 z-10 mt-1 max-h-40 overflow-y-auto rounded border bg-background shadow-lg">
          {searchResults.map((result) => {
            const ResultIcon = SHARE_TYPE_ICONS[result.type];
            return (
              <button
                key={result.id}
                type="button"
                className="flex w-full items-center gap-2 px-2 py-1.5 text-left hover:bg-accent"
                onClick={() => onSelectTarget(result.id, result.name)}
                data-testid="share-target-result"
              >
                <ResultIcon className="h-4 w-4 text-muted-foreground" />
                <div className="min-w-0 flex-1">
                  <div className="truncate text-sm">{result.name}</div>
                  {result.description && (
                    <div className="truncate text-muted-foreground text-xs">
                      {result.description}
                    </div>
                  )}
                </div>
              </button>
            );
          })}
        </div>
      )}
    </div>
  );
}
