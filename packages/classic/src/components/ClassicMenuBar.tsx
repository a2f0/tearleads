import {
  ENTRY_SORT_OPTIONS,
  type EntrySortOrder,
  isEntrySortOrder,
  isTagSortOrder,
  TAG_SORT_OPTIONS,
  type TagSortOrder
} from '../lib/sorting';

interface ClassicMenuBarProps {
  tagSortOrder: TagSortOrder;
  entrySortOrder: EntrySortOrder;
  onTagSortOrderChange: (nextSortOrder: TagSortOrder) => void;
  onEntrySortOrderChange: (nextSortOrder: EntrySortOrder) => void;
}

export function ClassicMenuBar({
  tagSortOrder,
  entrySortOrder,
  onTagSortOrderChange,
  onEntrySortOrderChange
}: ClassicMenuBarProps) {
  return (
    <div className="flex items-center gap-3 border-zinc-200 border-b bg-zinc-50 px-3 py-2">
      <label className="flex items-center gap-2 text-xs text-zinc-600 uppercase tracking-wide">
        Tags
        <select
          value={tagSortOrder}
          onChange={(event) => {
            const nextSortOrder = event.currentTarget.value;
            if (!isTagSortOrder(nextSortOrder)) {
              return;
            }
            onTagSortOrderChange(nextSortOrder);
          }}
          className="rounded border border-zinc-300 bg-white px-2 py-1 text-sm text-zinc-900"
          aria-label="Sort tags"
        >
          {TAG_SORT_OPTIONS.map((option) => (
            <option key={option.value} value={option.value}>
              {option.label}
            </option>
          ))}
        </select>
      </label>
      <label className="flex items-center gap-2 text-xs text-zinc-600 uppercase tracking-wide">
        Entries
        <select
          value={entrySortOrder}
          onChange={(event) => {
            const nextSortOrder = event.currentTarget.value;
            if (!isEntrySortOrder(nextSortOrder)) {
              return;
            }
            onEntrySortOrderChange(nextSortOrder);
          }}
          className="rounded border border-zinc-300 bg-white px-2 py-1 text-sm text-zinc-900"
          aria-label="Sort entries"
        >
          {ENTRY_SORT_OPTIONS.map((option) => (
            <option key={option.value} value={option.value}>
              {option.label}
            </option>
          ))}
        </select>
      </label>
    </div>
  );
}
