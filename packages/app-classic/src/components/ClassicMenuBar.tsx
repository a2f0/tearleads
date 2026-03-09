import { useTranslation } from 'react-i18next';
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
  const { t } = useTranslation('classic');
  return (
    <div className="flex items-center gap-3 border-border border-b bg-card px-3 py-2">
      <label className="flex items-center gap-2 text-muted-foreground text-xs uppercase tracking-wide">
        {t('tags')}
        <select
          value={tagSortOrder}
          onChange={(event) => {
            const nextSortOrder = event.currentTarget.value;
            if (!isTagSortOrder(nextSortOrder)) {
              return;
            }
            onTagSortOrderChange(nextSortOrder);
          }}
          className="rounded border border-border bg-background px-2 py-1 text-foreground text-sm"
          aria-label={t('sortTags')}
        >
          {TAG_SORT_OPTIONS.map((option) => (
            <option key={option.value} value={option.value}>
              {option.label}
            </option>
          ))}
        </select>
      </label>
      <label className="flex items-center gap-2 text-muted-foreground text-xs uppercase tracking-wide">
        {t('entries')}
        <select
          value={entrySortOrder}
          onChange={(event) => {
            const nextSortOrder = event.currentTarget.value;
            if (!isEntrySortOrder(nextSortOrder)) {
              return;
            }
            onEntrySortOrderChange(nextSortOrder);
          }}
          className="rounded border border-border bg-background px-2 py-1 text-foreground text-sm"
          aria-label={t('sortEntries')}
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
