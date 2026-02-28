import { useTranslation } from 'react-i18next';
import {
  ALL_ENTRIES_TAG_ID,
  ALL_ENTRIES_TAG_NAME,
  UNTAGGED_TAG_ID,
  UNTAGGED_TAG_NAME
} from '../../lib/constants';

interface TagSidebarVirtualTagsProps {
  activeTagId: string | null;
  totalNoteCount: number;
  untaggedCount: number;
  onSelectTag: (tagId: string) => void;
}

export function TagSidebarVirtualTags({
  activeTagId,
  totalNoteCount,
  untaggedCount,
  onSelectTag
}: TagSidebarVirtualTagsProps) {
  const { t } = useTranslation('classic');

  return (
    <ul className="m-0 mb-2 list-none space-y-1 p-0" aria-label={t('virtualTags')}>
      <li
        className={`border px-2 py-0.5 ${activeTagId === null ? 'bg-accent' : 'bg-background'}`}
      >
        <div className="flex items-center gap-2">
          <span
            aria-hidden="true"
            className="w-4 shrink-0 select-none text-center text-muted-foreground text-xs"
          >
            📁
          </span>
          <button
            type="button"
            className="min-w-0 flex-1 rounded px-1.5 py-0.5 text-left text-sm"
            onClick={() => onSelectTag(ALL_ENTRIES_TAG_ID)}
            aria-pressed={activeTagId === null}
            aria-label={`Select ${ALL_ENTRIES_TAG_NAME}`}
          >
            <span className="text-foreground">
              {t('allItems')} ({totalNoteCount})
            </span>
          </button>
        </div>
      </li>
      <li
        className={`border px-2 py-0.5 ${activeTagId === UNTAGGED_TAG_ID ? 'bg-accent' : 'bg-background'}`}
      >
        <div className="flex items-center gap-2">
          <span
            aria-hidden="true"
            className="w-4 shrink-0 select-none text-center text-muted-foreground text-xs"
          >
            📁
          </span>
          <button
            type="button"
            className="min-w-0 flex-1 rounded px-1.5 py-0.5 text-left text-sm"
            onClick={() => onSelectTag(UNTAGGED_TAG_ID)}
            aria-pressed={activeTagId === UNTAGGED_TAG_ID}
            aria-label={`Select ${UNTAGGED_TAG_NAME}`}
          >
            <span className="text-foreground">
              {UNTAGGED_TAG_NAME} ({untaggedCount})
            </span>
          </button>
        </div>
      </li>
    </ul>
  );
}
