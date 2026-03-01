import type { VfsPermissionLevel, VfsShareType } from '@tearleads/shared';
import { Calendar, Loader2, X } from 'lucide-react';
import { useCallback, useEffect, useState } from 'react';
import { useVfsExplorerContext } from '../../context';
import { useShareTargetSearch } from '../../hooks';
import { cn } from '../../lib';
import { SharePermissionSelect } from './SharePermissionSelect';
import { SHARE_TYPE_ICONS, SHARE_TYPE_LABELS } from './types';

interface ShareFormProps {
  onShareCreated: () => void;
  onCancel: () => void;
  onTargetSelected: (shareType: VfsShareType, targetId: string | null, targetName: string) => void;
  createShare: (request: {
    shareType: VfsShareType;
    targetId: string;
    permissionLevel: VfsPermissionLevel;
    expiresAt: string | null;
  }) => Promise<unknown>;
}

export function ShareForm({
  onShareCreated,
  onCancel,
  onTargetSelected,
  createShare
}: ShareFormProps) {
  const {
    ui: { Button, Input }
  } = useVfsExplorerContext();
  const {
    results: searchResults,
    loading: searchLoading,
    search,
    clear: clearSearch
  } = useShareTargetSearch();

  const [shareType, setShareType] = useState<VfsShareType>('user');
  const [permissionLevel, setPermissionLevel] =
    useState<VfsPermissionLevel>('view');
  const [searchQuery, setSearchQuery] = useState('');
  const [selectedTargetId, setSelectedTargetId] = useState<string | null>(null);
  const [selectedTargetName, setSelectedTargetName] = useState('');
  const [expiresAt, setExpiresAt] = useState('');
  const [isAdding, setIsAdding] = useState(false);

  useEffect(() => {
    if (searchQuery.trim()) {
      const timeoutId = setTimeout(() => {
        search(searchQuery, shareType);
      }, 300);
      return () => clearTimeout(timeoutId);
    }
    clearSearch();
    return undefined;
  }, [searchQuery, shareType, search, clearSearch]);

  const handleSelectTarget = useCallback(
    (id: string, name: string) => {
      setSelectedTargetId(id);
      setSelectedTargetName(name);
      setSearchQuery('');
      clearSearch();
      onTargetSelected(shareType, id, name);
    },
    [clearSearch, onTargetSelected, shareType]
  );

  const handleClearTarget = useCallback(() => {
    setSelectedTargetId(null);
    setSelectedTargetName('');
    onTargetSelected(shareType, null, '');
  }, [onTargetSelected, shareType]);

  const handleShareTypeChange = useCallback(
    (type: VfsShareType) => {
      setShareType(type);
      setSelectedTargetId(null);
      setSelectedTargetName('');
      setSearchQuery('');
      clearSearch();
      onTargetSelected(type, null, '');
    },
    [clearSearch, onTargetSelected]
  );

  const handleAddShare = useCallback(async () => {
    if (!selectedTargetId) return;
    setIsAdding(true);
    try {
      await createShare({
        shareType,
        targetId: selectedTargetId,
        permissionLevel,
        expiresAt: expiresAt || null
      });
      onShareCreated();
    } finally {
      setIsAdding(false);
    }
  }, [
    selectedTargetId,
    shareType,
    permissionLevel,
    expiresAt,
    createShare,
    onShareCreated
  ]);

  return (
    <div
      className="space-y-3 border-b p-3 [border-color:var(--soft-border)]"
      data-testid="share-form"
    >
      {/* Share type selector */}
      <div className="flex gap-1">
        {(['user', 'group', 'organization'] as VfsShareType[]).map((type) => {
          const TypeIcon = SHARE_TYPE_ICONS[type];
          return (
            <button
              key={type}
              type="button"
              className={cn(
                'flex flex-1 items-center justify-center gap-1 rounded px-2 py-1 text-xs transition-colors',
                shareType === type
                  ? 'bg-accent text-accent-foreground'
                  : 'hover:bg-accent/50'
              )}
              onClick={() => handleShareTypeChange(type)}
              data-testid={`share-type-${type}`}
            >
              <TypeIcon className="h-3 w-3" />
              <span>{SHARE_TYPE_LABELS[type]}</span>
            </button>
          );
        })}
      </div>

      {/* Target search */}
      {selectedTargetId ? (
        <div className="flex items-center gap-2 rounded border bg-muted/50 px-2 py-1">
          {(() => {
            const SelectedIcon = SHARE_TYPE_ICONS[shareType];
            return (
              <SelectedIcon className="h-4 w-4 text-muted-foreground" />
            );
          })()}
          <span className="flex-1 truncate text-sm">{selectedTargetName}</span>
          <button
            type="button"
            className="text-muted-foreground hover:text-foreground"
            onClick={handleClearTarget}
          >
            <X className="h-3 w-3" />
          </button>
        </div>
      ) : (
        <div className="relative">
          <Input
            type="text"
            placeholder={`Search ${SHARE_TYPE_LABELS[shareType].toLowerCase()}s...`}
            value={searchQuery}
            onChange={(e) => setSearchQuery(e.target.value)}
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
                    onClick={() => handleSelectTarget(result.id, result.name)}
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
      )}

      {/* Permission selector */}
      <div>
        <span className="mb-1 block text-muted-foreground text-xs">
          Permission
        </span>
        <SharePermissionSelect
          value={permissionLevel}
          onChange={setPermissionLevel}
        />
      </div>

      {/* Expiration */}
      {/* biome-ignore lint/a11y/noLabelWithoutControl: Input is a custom component */}
      <label className="block">
        <span className="mb-1 flex items-center gap-1 text-muted-foreground text-xs">
          <Calendar className="h-3 w-3" />
          Expires (optional)
        </span>
        <Input
          type="datetime-local"
          value={expiresAt}
          onChange={(e) => setExpiresAt(e.target.value)}
          className="text-base"
        />
      </label>

      {/* Actions */}
      <div className="flex gap-2">
        <Button size="sm" variant="ghost" onClick={onCancel}>
          Cancel
        </Button>
        <Button
          className="flex-1"
          size="sm"
          disabled={!selectedTargetId || isAdding}
          onClick={handleAddShare}
          data-testid="share-form-submit"
        >
          {isAdding && <Loader2 className="mr-2 h-4 w-4 animate-spin" />}
          Share
        </Button>
      </div>
    </div>
  );
}
