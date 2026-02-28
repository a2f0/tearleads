import type { VfsPermissionLevel, VfsShareType } from '@tearleads/shared';
import { useResizableSidebar } from '@tearleads/window-manager';
import {
  Building2,
  Calendar,
  Loader2,
  type LucideIcon,
  Plus,
  Trash2,
  User,
  Users,
  X
} from 'lucide-react';
import { useCallback, useEffect, useState } from 'react';
import { useVfsExplorerContext } from '../context';
import { useShareTargetSearch, useVfsShares } from '../hooks';
import { cn, type DisplayItem } from '../lib';
import { SharePolicyPreviewPanel } from './SharePolicyPreviewPanel';

interface SharingPanelProps {
  item: DisplayItem;
  width: number;
  onWidthChange: (width: number) => void;
  onClose: () => void;
}

const SHARE_TYPE_ICONS: Record<VfsShareType, LucideIcon> = {
  user: User,
  group: Users,
  organization: Building2
};

const SHARE_TYPE_LABELS: Record<VfsShareType, string> = {
  user: 'User',
  group: 'Group',
  organization: 'Organization'
};

const PERMISSION_LABELS: Record<VfsPermissionLevel, string> = {
  view: 'View',
  edit: 'Edit',
  download: 'Download'
};

const PERMISSION_COLORS: Record<VfsPermissionLevel, string> = {
  view: 'bg-blue-100 text-blue-800 dark:bg-blue-900 dark:text-blue-200',
  edit: 'bg-amber-100 text-amber-800 dark:bg-amber-900 dark:text-amber-200',
  download: 'bg-green-100 text-green-800 dark:bg-green-900 dark:text-green-200'
};

export function SharingPanel({
  item,
  width,
  onWidthChange,
  onClose
}: SharingPanelProps) {
  // component-complexity: allow
  // Rationale: this feature slice keeps share authoring, target search, and
  // preview wiring together until follow-up decomposition lands.
  const {
    ui: { Button, Input }
  } = useVfsExplorerContext();
  const {
    shares,
    orgShares,
    loading,
    error,
    createShare,
    deleteShare,
    deleteOrgShare
  } = useVfsShares(item.id);
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
  const [selectedTargetName, setSelectedTargetName] = useState<string>('');
  const [expiresAt, setExpiresAt] = useState<string>('');
  const [isAdding, setIsAdding] = useState(false);

  const { resizeHandleProps } = useResizableSidebar({
    width,
    onWidthChange,
    resizeFrom: 'left',
    minWidth: 250,
    maxWidth: 500,
    ariaLabel: 'Resize sharing panel'
  });

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
    },
    [clearSearch]
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
      setSelectedTargetId(null);
      setSelectedTargetName('');
      setExpiresAt('');
    } finally {
      setIsAdding(false);
    }
  }, [selectedTargetId, shareType, permissionLevel, expiresAt, createShare]);

  const handleDeleteShare = useCallback(
    async (shareId: string) => {
      await deleteShare(shareId);
    },
    [deleteShare]
  );

  const handleDeleteOrgShare = useCallback(
    async (shareId: string) => {
      await deleteOrgShare(shareId);
    },
    [deleteOrgShare]
  );

  const handleShareTypeChange = useCallback(
    (type: VfsShareType) => {
      setShareType(type);
      setSelectedTargetId(null);
      setSelectedTargetName('');
      setSearchQuery('');
      clearSearch();
    },
    [clearSearch]
  );

  return (
    <div
      className="relative flex shrink-0 flex-col border-l bg-background [border-color:var(--soft-border)]"
      style={{ width }}
    >
      {/* Resize handle */}
      <div
        className="absolute top-0 bottom-0 left-0 w-1 cursor-col-resize hover:bg-accent"
        {...resizeHandleProps}
      />

      {/* Header */}
      <div className="flex items-center justify-between border-b px-3 py-2 [border-color:var(--soft-border)]">
        <span className="font-medium text-sm">Sharing</span>
        <Button variant="ghost" size="icon" onClick={onClose}>
          <X className="h-4 w-4" />
        </Button>
      </div>

      {/* Item name */}
      <div className="border-b px-3 py-2 [border-color:var(--soft-border)]">
        <p className="truncate text-muted-foreground text-xs">Sharing</p>
        <p className="truncate font-medium text-sm">{item.name}</p>
      </div>

      {/* Add share form */}
      <div className="space-y-3 border-b p-3 [border-color:var(--soft-border)]">
        <div className="font-medium text-muted-foreground text-xs">
          Add Share
        </div>

        {/* Share type selector */}
        <div className="flex gap-1">
          {(['user', 'group', 'organization'] as VfsShareType[]).map((type) => {
            const Icon = SHARE_TYPE_ICONS[type];
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
              >
                <Icon className="h-3 w-3" />
                <span className="hidden sm:inline">
                  {SHARE_TYPE_LABELS[type]}
                </span>
              </button>
            );
          })}
        </div>

        {/* Target search */}
        {selectedTargetId ? (
          <div className="flex items-center gap-2 rounded border bg-muted/50 px-2 py-1">
            {(() => {
              const Icon = SHARE_TYPE_ICONS[shareType];
              return <Icon className="h-4 w-4 text-muted-foreground" />;
            })()}
            <span className="flex-1 truncate text-sm">
              {selectedTargetName}
            </span>
            <button
              type="button"
              className="text-muted-foreground hover:text-foreground"
              onClick={() => {
                setSelectedTargetId(null);
                setSelectedTargetName('');
              }}
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
              className="text-sm"
            />
            {searchLoading && (
              <Loader2 className="absolute top-1/2 right-2 h-4 w-4 -translate-y-1/2 animate-spin text-muted-foreground" />
            )}
            {searchResults.length > 0 && (
              <div className="absolute top-full right-0 left-0 z-10 mt-1 max-h-40 overflow-y-auto rounded border bg-background shadow-lg">
                {searchResults.map((result) => {
                  const Icon = SHARE_TYPE_ICONS[result.type];
                  return (
                    <button
                      key={result.id}
                      type="button"
                      className="flex w-full items-center gap-2 px-2 py-1.5 text-left hover:bg-accent"
                      onClick={() => handleSelectTarget(result.id, result.name)}
                    >
                      <Icon className="h-4 w-4 text-muted-foreground" />
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
        <label className="block">
          <span className="mb-1 block text-muted-foreground text-xs">
            Permission
          </span>
          <select
            className="w-full rounded border bg-background px-2 py-1 text-sm"
            value={permissionLevel}
            onChange={(e) =>
              setPermissionLevel(e.target.value as VfsPermissionLevel)
            }
          >
            <option value="view">View - Can view the item</option>
            <option value="edit">Edit - Can view and edit</option>
            <option value="download">Download - Can view and download</option>
          </select>
        </label>

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
            className="text-sm"
          />
        </label>

        {/* Add button */}
        <Button
          className="w-full"
          size="sm"
          disabled={!selectedTargetId || isAdding}
          onClick={handleAddShare}
        >
          {isAdding ? (
            <Loader2 className="mr-2 h-4 w-4 animate-spin" />
          ) : (
            <Plus className="mr-2 h-4 w-4" />
          )}
          Add Share
        </Button>
      </div>

      <SharePolicyPreviewPanel
        itemId={item.id}
        shareType={shareType}
        selectedTargetId={selectedTargetId}
        selectedTargetName={selectedTargetName}
      />

      {/* Current shares */}
      <div className="flex-1 overflow-y-auto">
        <div className="px-3 py-2">
          <span className="font-medium text-muted-foreground text-xs">
            Current Shares ({shares.length + orgShares.length})
          </span>
        </div>

        {loading && (
          <div className="flex items-center justify-center py-4">
            <Loader2 className="h-4 w-4 animate-spin text-muted-foreground" />
          </div>
        )}

        {error && (
          <div className="px-3 py-2 text-destructive text-xs">{error}</div>
        )}

        {!loading && shares.length === 0 && orgShares.length === 0 && (
          <div className="px-3 py-4 text-center text-muted-foreground text-xs">
            No shares yet
          </div>
        )}

        <div className="space-y-1 px-2 pb-2">
          {shares.map((share) => {
            const Icon = SHARE_TYPE_ICONS[share.shareType];
            return (
              <div
                key={share.id}
                className="flex items-center gap-2 rounded border bg-muted/20 px-2 py-1.5"
              >
                <Icon className="h-4 w-4 shrink-0 text-muted-foreground" />
                <div className="min-w-0 flex-1">
                  <div className="truncate text-sm">{share.targetName}</div>
                  <div className="flex items-center gap-1">
                    <span
                      className={cn(
                        'rounded px-1.5 py-0.5 text-xs',
                        PERMISSION_COLORS[share.permissionLevel]
                      )}
                    >
                      {PERMISSION_LABELS[share.permissionLevel]}
                    </span>
                    {share.expiresAt && (
                      <span className="text-muted-foreground text-xs">
                        Expires {new Date(share.expiresAt).toLocaleDateString()}
                      </span>
                    )}
                  </div>
                </div>
                <button
                  type="button"
                  className="shrink-0 text-muted-foreground hover:text-destructive"
                  onClick={() => handleDeleteShare(share.id)}
                  title="Remove share"
                >
                  <Trash2 className="h-4 w-4" />
                </button>
              </div>
            );
          })}

          {orgShares.map((share) => (
            <div
              key={share.id}
              className="flex items-center gap-2 rounded border bg-muted/20 px-2 py-1.5"
            >
              <Building2 className="h-4 w-4 shrink-0 text-muted-foreground" />
              <div className="min-w-0 flex-1">
                <div className="truncate text-sm">
                  {share.sourceOrgName} → {share.targetOrgName}
                </div>
                <div className="flex items-center gap-1">
                  <span
                    className={cn(
                      'rounded px-1.5 py-0.5 text-xs',
                      PERMISSION_COLORS[share.permissionLevel]
                    )}
                  >
                    {PERMISSION_LABELS[share.permissionLevel]}
                  </span>
                  {share.expiresAt && (
                    <span className="text-muted-foreground text-xs">
                      Expires {new Date(share.expiresAt).toLocaleDateString()}
                    </span>
                  )}
                </div>
              </div>
              <button
                type="button"
                className="shrink-0 text-muted-foreground hover:text-destructive"
                onClick={() => handleDeleteOrgShare(share.id)}
                title="Remove share"
              >
                <Trash2 className="h-4 w-4" />
              </button>
            </div>
          ))}
        </div>
      </div>
    </div>
  );
}
