import { useTranslation } from 'react-i18next';
import type { ClassicTag } from '../../lib/types';

interface TagSidebarDeletedTagsProps {
  deletedTags: ClassicTag[];
  onRestoreTag?: ((tagId: string) => void) | undefined;
}

export function TagSidebarDeletedTags({
  deletedTags,
  onRestoreTag
}: TagSidebarDeletedTagsProps) {
  const { t } = useTranslation('classic');

  if (deletedTags.length === 0) {
    return null;
  }

  return (
    <ul
      className="m-0 mb-2 list-none space-y-1 p-0"
      aria-label={t('deletedTags')}
    >
      <li className="px-2 py-0.5 text-muted-foreground text-xs uppercase tracking-wide">
        {t('deletedTags')} ({deletedTags.length})
      </li>
      {deletedTags.map((tag) => (
        <li key={tag.id} className="border bg-card px-2 py-0.5">
          <div className="flex items-center gap-2">
            <span className="w-4 shrink-0 select-none text-center text-muted-foreground text-xs">
              🗑️
            </span>
            <span className="min-w-0 flex-1 truncate text-muted-foreground text-sm">
              {tag.name}
            </span>
            <button
              type="button"
              className="rounded border border-border px-1.5 py-0.5 text-xs"
              onClick={() => onRestoreTag?.(tag.id)}
              aria-label={`${t('restoreTag')} ${tag.name}`}
              disabled={onRestoreTag === undefined}
            >
              {t('restore')}
            </button>
          </div>
        </li>
      ))}
    </ul>
  );
}
