import { VFS_OBJECT_TYPES, type VfsObjectType } from '@tearleads/shared';
import { Loader2, RefreshCcw, X } from 'lucide-react';
import { useVfsExplorerContext } from '../../context';
import { cn } from '../../lib';

interface ShareAccessSummaryFiltersProps {
  search: string;
  onSearchChange: (value: string) => void;
  loading: boolean;
  onRefetch: () => void;
  maxDepth: number | null;
  onMaxDepthChange: (value: number | null) => void;
  selectedObjectTypes: VfsObjectType[];
  onToggleObjectType: (value: VfsObjectType) => void;
  onClearFilters: () => void;
}

const MAX_DEPTH_OPTIONS: Array<{ label: string; value: number | null }> = [
  { label: 'All depths', value: null },
  { label: 'Root only', value: 0 },
  { label: '1 level', value: 1 },
  { label: '2 levels', value: 2 },
  { label: '3 levels', value: 3 },
  { label: '5 levels', value: 5 },
  { label: '10 levels', value: 10 }
];

const OBJECT_TYPE_LABELS: Record<VfsObjectType, string> = {
  file: 'File',
  photo: 'Photo',
  audio: 'Audio',
  video: 'Video',
  contact: 'Contact',
  note: 'Note',
  email: 'Email',
  mlsMessage: 'MLS Message',
  conversation: 'Conversation',
  folder: 'Folder',
  emailFolder: 'Email Folder',
  playlist: 'Playlist',
  album: 'Album',
  contactGroup: 'Contact Group',
  tag: 'Tag'
};

export function ShareAccessSummaryFilters({
  search,
  onSearchChange,
  loading,
  onRefetch,
  maxDepth,
  onMaxDepthChange,
  selectedObjectTypes,
  onToggleObjectType,
  onClearFilters
}: ShareAccessSummaryFiltersProps) {
  const {
    ui: { Button, Input }
  } = useVfsExplorerContext();
  const hasActiveFilters = maxDepth !== null || selectedObjectTypes.length > 0;

  return (
    <>
      <div className="flex items-center gap-2">
        <Input
          type="text"
          placeholder="Search items..."
          value={search}
          onChange={(event) => onSearchChange(event.target.value)}
          className="flex-1 text-base"
        />
        <Button
          size="sm"
          variant="ghost"
          disabled={loading}
          onClick={onRefetch}
        >
          {loading ? (
            <Loader2 className="h-3 w-3 animate-spin" />
          ) : (
            <RefreshCcw className="h-3 w-3" />
          )}
        </Button>
      </div>

      <div className="flex items-center gap-2">
        <label className="flex min-w-0 flex-1 items-center gap-2 text-muted-foreground text-xs">
          Max depth
          <select
            value={maxDepth === null ? 'all' : String(maxDepth)}
            onChange={(event) => {
              const nextValue = event.target.value;
              onMaxDepthChange(
                nextValue === 'all' ? null : Number.parseInt(nextValue, 10)
              );
            }}
            className="h-8 min-w-0 flex-1 rounded border bg-background px-2 text-base"
            data-testid="access-depth-filter"
          >
            {MAX_DEPTH_OPTIONS.map((option) => (
              <option
                key={option.label}
                value={option.value === null ? 'all' : String(option.value)}
              >
                {option.label}
              </option>
            ))}
          </select>
        </label>
        {hasActiveFilters && (
          <Button
            size="sm"
            variant="ghost"
            onClick={onClearFilters}
            data-testid="access-filter-clear"
          >
            <X className="h-3 w-3" />
          </Button>
        )}
      </div>

      <div className="space-y-1">
        <div className="text-muted-foreground text-xs">Object types</div>
        <div className="flex gap-1 overflow-x-auto pb-1">
          {VFS_OBJECT_TYPES.map((objectType) => {
            const selected = selectedObjectTypes.includes(objectType);
            return (
              <button
                key={objectType}
                type="button"
                aria-pressed={selected}
                className={cn(
                  'shrink-0 rounded border px-2 py-1 text-xs',
                  selected
                    ? 'border-primary bg-primary text-primary-foreground'
                    : 'bg-background hover:bg-accent/30'
                )}
                onClick={() => onToggleObjectType(objectType)}
                data-testid={`access-object-type-${objectType}`}
              >
                {OBJECT_TYPE_LABELS[objectType]}
              </button>
            );
          })}
        </div>
      </div>
    </>
  );
}
