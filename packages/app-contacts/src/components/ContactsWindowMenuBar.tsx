import contactsPackageJson from '@tearleads/app-contacts/package.json';
import {
  AboutMenuItem,
  DropdownMenu,
  DropdownMenuItem,
  DropdownMenuSeparator,
  WindowOptionsMenuItem
} from '@tearleads/ui';
import { WindowMenuBar } from '@tearleads/window-manager';
import { List, Table2, Upload } from 'lucide-react';
import { useContactsContext } from '../context';

export type ViewMode = 'list' | 'table';

interface ContactsWindowMenuBarProps {
  viewMode: ViewMode;
  onViewModeChange: (mode: ViewMode) => void;
  onNewContact: () => void;
  onImportCsv: () => void;
  onClose: () => void;
  isNewContactDisabled?: boolean;
  isImportDisabled?: boolean;
}

export function ContactsWindowMenuBar({
  viewMode,
  onViewModeChange,
  onNewContact,
  onImportCsv,
  onClose,
  isNewContactDisabled = false,
  isImportDisabled = false
}: ContactsWindowMenuBarProps) {
  const { t } = useContactsContext();

  return (
    <WindowMenuBar>
      <DropdownMenu trigger={t('file')}>
        <DropdownMenuItem
          onClick={onNewContact}
          disabled={isNewContactDisabled}
        >
          {t('new')}
        </DropdownMenuItem>
        <DropdownMenuItem
          icon={<Upload className="h-3 w-3" />}
          onClick={onImportCsv}
          disabled={isImportDisabled}
        >
          {t('importCsv')}
        </DropdownMenuItem>
        <DropdownMenuSeparator />
        <DropdownMenuItem onClick={onClose}>{t('close')}</DropdownMenuItem>
      </DropdownMenu>
      <DropdownMenu trigger={t('view')}>
        <DropdownMenuItem
          onClick={() => onViewModeChange('list')}
          checked={viewMode === 'list'}
          icon={<List className="h-3 w-3" />}
        >
          {t('list')}
        </DropdownMenuItem>
        <DropdownMenuItem
          onClick={() => onViewModeChange('table')}
          checked={viewMode === 'table'}
          icon={<Table2 className="h-3 w-3" />}
        >
          {t('table')}
        </DropdownMenuItem>
        <DropdownMenuSeparator />
        <WindowOptionsMenuItem />
      </DropdownMenu>
      <DropdownMenu trigger={t('help')}>
        <AboutMenuItem
          appName="Contacts"
          version={contactsPackageJson.version}
        />
      </DropdownMenu>
    </WindowMenuBar>
  );
}
