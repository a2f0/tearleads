import {
  DropdownMenu,
  DropdownMenuItem
} from '@client/components/ui/dropdown-menu';
import { WindowOptionsMenuItem } from '@client/components/window-menu/WindowOptionsMenuItem';
import { useTranslation } from 'react-i18next';

interface SyncWindowMenuBarProps {
  onClose: () => void;
}

export function SyncWindowMenuBar({ onClose }: SyncWindowMenuBarProps) {
  const { t } = useTranslation('sync');
  return (
    <div className="flex shrink-0 border-b bg-muted/30 px-1">
      <DropdownMenu trigger={t('file')}>
        <DropdownMenuItem onClick={onClose}>{t('close')}</DropdownMenuItem>
      </DropdownMenu>
      <DropdownMenu trigger={t('view')}>
        <WindowOptionsMenuItem />
      </DropdownMenu>
    </div>
  );
}
