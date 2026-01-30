/**
 * Client-side ContactsProvider wrapper that supplies all dependencies
 * to the @rapid/contacts package components.
 */
import { ContactsProvider, type ContactsUIComponents } from '@rapid/contacts';
import contactsPackageJson from '@rapid/contacts/package.json';
import type { ReactNode } from 'react';
import { useNavigate } from 'react-router-dom';
import { InlineUnlock } from '@/components/sqlite/InlineUnlock';
import { BackLink } from '@/components/ui/back-link';
import { Button } from '@/components/ui/button';
import { ContextMenu, ContextMenuItem } from '@/components/ui/context-menu';
import {
  DropdownMenu,
  DropdownMenuItem,
  DropdownMenuSeparator
} from '@/components/ui/dropdown-menu';
import { Dropzone } from '@/components/ui/dropzone';
import { Input } from '@/components/ui/input';
import { ListRow } from '@/components/ui/list-row';
import { RefreshButton } from '@/components/ui/refresh-button';
import { VirtualListStatus } from '@/components/ui/VirtualListStatus';
import { AboutMenuItem } from '@/components/window-menu/AboutMenuItem';
import { WindowOptionsMenuItem } from '@/components/window-menu/WindowOptionsMenuItem';
import { zIndex } from '@/constants/zIndex';
import { getDatabase, getDatabaseAdapter } from '@/db';
import { useDatabaseContext } from '@/db/hooks';
import { useTypedTranslation } from '@/i18n';
import { saveFile as saveFileUtil } from '@/lib/file-utils';
import { useNavigateWithFrom } from '@/lib/navigation';
import { formatDate } from '@/lib/utils';

export function ContactsAboutMenuItem() {
  return (
    <AboutMenuItem appName="Contacts" version={contactsPackageJson.version} />
  );
}

const contactsUIComponents: ContactsUIComponents = {
  Button,
  Input,
  ContextMenu,
  ContextMenuItem,
  ListRow,
  RefreshButton,
  VirtualListStatus,
  InlineUnlock,
  DropdownMenu,
  DropdownMenuItem,
  DropdownMenuSeparator,
  WindowOptionsMenuItem,
  AboutMenuItem: ContactsAboutMenuItem,
  BackLink,
  Dropzone
};

interface ClientContactsProviderProps {
  children: ReactNode;
}

async function saveFile(
  content: string,
  filename: string,
  _mimeType: string
): Promise<void> {
  const data = new TextEncoder().encode(content);
  await saveFileUtil(data, filename);
}

export function ClientContactsProvider({
  children
}: ClientContactsProviderProps) {
  const databaseContext = useDatabaseContext();
  const { t } = useTypedTranslation('contextMenu');
  const navigate = useNavigate();
  const navigateWithFrom = useNavigateWithFrom();

  const databaseState = {
    isUnlocked: databaseContext.isUnlocked,
    isLoading: databaseContext.isLoading,
    currentInstanceId: databaseContext.currentInstanceId
  };

  return (
    <ContactsProvider
      databaseState={databaseState}
      getDatabase={getDatabase}
      getDatabaseAdapter={getDatabaseAdapter}
      saveFile={saveFile}
      ui={contactsUIComponents}
      t={t}
      tooltipZIndex={zIndex.tooltip}
      navigate={navigate}
      navigateWithFrom={navigateWithFrom}
      formatDate={formatDate}
    >
      {children}
    </ContactsProvider>
  );
}
