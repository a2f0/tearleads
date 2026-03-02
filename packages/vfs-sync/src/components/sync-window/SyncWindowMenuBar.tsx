import {
  AboutMenuItem,
  DropdownMenu,
  DropdownMenuItem,
  WindowOptionsMenuItem
} from '@tearleads/ui';
import syncPackageJson from '@tearleads/vfs-sync/package.json';
import { WindowMenuBar } from '@tearleads/window-manager';
import { useTranslation } from 'react-i18next';

interface SyncWindowMenuBarProps {
  onClose: () => void;
}

export function SyncWindowMenuBar({ onClose }: SyncWindowMenuBarProps) {
  const { t } = useTranslation('sync');
  return (
    <WindowMenuBar>
      <DropdownMenu trigger={t('file')}>
        <DropdownMenuItem onClick={onClose}>{t('close')}</DropdownMenuItem>
      </DropdownMenu>
      <DropdownMenu trigger={t('view')}>
        <WindowOptionsMenuItem />
      </DropdownMenu>
      <DropdownMenu trigger={t('help')}>
        <AboutMenuItem appName="Sync" version={syncPackageJson.version} />
      </DropdownMenu>
    </WindowMenuBar>
  );
}
