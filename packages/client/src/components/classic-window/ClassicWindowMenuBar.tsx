import {
  ENTRY_SORT_OPTIONS,
  type EntrySortOrder,
  TAG_SORT_OPTIONS,
  type TagSortOrder
} from '@tearleads/classic';
import classicPackageJson from '@tearleads/classic/package.json';
import { useTranslation } from 'react-i18next';
import {
  DropdownMenu,
  DropdownMenuItem,
  DropdownMenuSeparator
} from '@/components/ui/dropdown-menu';
import { AboutMenuItem } from '@/components/window-menu/AboutMenuItem';
import { WindowOptionsMenuItem } from '@/components/window-menu/WindowOptionsMenuItem';
import { WindowMenuBar } from '@tearleads/window-manager';

interface ClassicWindowMenuBarProps {
  onClose: () => void;
  tagSortOrder: TagSortOrder;
  entrySortOrder: EntrySortOrder;
  onTagSortOrderChange: (nextSortOrder: TagSortOrder) => void;
  onEntrySortOrderChange: (nextSortOrder: EntrySortOrder) => void;
}

const NOOP = () => {};

export function ClassicWindowMenuBar({
  onClose,
  tagSortOrder,
  entrySortOrder,
  onTagSortOrderChange,
  onEntrySortOrderChange
}: ClassicWindowMenuBarProps) {
  const { t } = useTranslation('classic');
  return (
    <WindowMenuBar>
      <DropdownMenu trigger={t('file')}>
        <DropdownMenuItem onClick={NOOP}>{t('newEntry')}</DropdownMenuItem>
        <DropdownMenuSeparator />
        <DropdownMenuItem onClick={onClose}>{t('close')}</DropdownMenuItem>
      </DropdownMenu>
      <DropdownMenu trigger={t('edit')}>
        <DropdownMenuItem onClick={NOOP} disabled>
          {t('undo')}
        </DropdownMenuItem>
        <DropdownMenuItem onClick={NOOP} disabled>
          {t('redo')}
        </DropdownMenuItem>
      </DropdownMenu>
      <DropdownMenu trigger={t('tags')}>
        <DropdownMenuItem onClick={NOOP}>{t('newTag')}</DropdownMenuItem>
        <DropdownMenuSeparator />
        {TAG_SORT_OPTIONS.map((option) => (
          <DropdownMenuItem
            key={option.value}
            checked={tagSortOrder === option.value}
            onClick={() => onTagSortOrderChange(option.value)}
          >
            {t('sortBy')} {option.label}
          </DropdownMenuItem>
        ))}
      </DropdownMenu>
      <DropdownMenu trigger={t('entries')}>
        <DropdownMenuItem onClick={NOOP}>{t('newEntry')}</DropdownMenuItem>
        <DropdownMenuSeparator />
        {ENTRY_SORT_OPTIONS.map((option) => (
          <DropdownMenuItem
            key={option.value}
            checked={entrySortOrder === option.value}
            onClick={() => onEntrySortOrderChange(option.value)}
          >
            {t('sortBy')} {option.label}
          </DropdownMenuItem>
        ))}
      </DropdownMenu>
      <DropdownMenu trigger={t('view')}>
        <WindowOptionsMenuItem />
      </DropdownMenu>
      <DropdownMenu trigger={t('help')}>
        <AboutMenuItem
          appName={t('classic')}
          version={classicPackageJson.version}
          closeLabel={t('close')}
        />
      </DropdownMenu>
    </div>
  );
}
