import {
  DropdownMenu,
  DropdownMenuItem,
  WindowOptionsMenuItem
} from '@tearleads/ui';
import { WindowControlBar, WindowMenuBar } from '@tearleads/window-manager';
import type { ReactNode } from 'react';
import { useTypedTranslation } from '@/i18n';

interface AdminWindowMenuBarProps {
  onClose: () => void;
  controls?: ReactNode;
}

export function AdminWindowMenuBar({
  onClose,
  controls
}: AdminWindowMenuBarProps) {
  const { t } = useTypedTranslation('admin');
  return (
    <div className="shrink-0">
      <WindowMenuBar>
        <DropdownMenu trigger={t('file')}>
          <DropdownMenuItem onClick={onClose}>{t('close')}</DropdownMenuItem>
        </DropdownMenu>
        <DropdownMenu trigger={t('view')}>
          <WindowOptionsMenuItem />
        </DropdownMenu>
      </WindowMenuBar>
      <WindowControlBar>
        <div data-testid="admin-window-controls">{controls}</div>
      </WindowControlBar>
    </div>
  );
}
