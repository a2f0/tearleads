/**
 * Client-side ContactsProvider wrapper that supplies all dependencies
 * to the @rapid/contacts package components.
 */
import {
  ContactsProvider,
  type ContactsUIComponents,
  type ImportedContactRecord,
  type VfsRegistrationResult
} from '@rapid/contacts';
import contactsPackageJson from '@rapid/contacts/package.json';
import { vfsRegistry } from '@rapid/db/sqlite';
import type { ReactNode } from 'react';
import { useCallback } from 'react';
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
import { generateSessionKey, wrapSessionKey } from '@/hooks/useVfsKeys';
import { useTypedTranslation } from '@/i18n';
import { api } from '@/lib/api';
import { isLoggedIn, readStoredAuth } from '@/lib/auth-storage';
import { getFeatureFlagValue } from '@/lib/feature-flags';
import { saveFile as saveFileUtil } from '@/lib/file-utils';
import { useNavigateWithFrom } from '@/lib/navigation';
import { formatDate } from '@/lib/utils';
import { createContactDocument, indexDocuments } from '@/search';

export function ContactsAboutMenuItem() {
  return (
    <AboutMenuItem appName="Contacts" version={contactsPackageJson.version} />
  );
}

const ContactsInput: ContactsUIComponents['Input'] = ({
  inputRef,
  ...props
}) => <Input ref={inputRef} {...props} />;

const contactsUIComponents: ContactsUIComponents = {
  Button,
  Input: ContactsInput,
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

/**
 * Register a contact in the VFS registry for organization and sharing.
 * This is called after contact creation to enable VFS features.
 */
async function registerInVfs(
  contactId: string,
  createdAt: Date
): Promise<VfsRegistrationResult> {
  try {
    const db = getDatabase();
    const auth = readStoredAuth();

    // Generate and wrap session key if logged in
    let encryptedSessionKey: string | null = null;
    if (isLoggedIn()) {
      try {
        const sessionKey = generateSessionKey();
        encryptedSessionKey = await wrapSessionKey(sessionKey);
      } catch (err) {
        console.warn('Failed to wrap contact session key:', err);
      }
    }

    // Register in local VFS registry
    await db.insert(vfsRegistry).values({
      id: contactId,
      objectType: 'contact',
      ownerId: auth.user?.id ?? null,
      encryptedSessionKey,
      createdAt
    });

    // Server-side VFS registration if enabled
    if (
      isLoggedIn() &&
      getFeatureFlagValue('vfsServerRegistration') &&
      encryptedSessionKey
    ) {
      try {
        await api.vfs.register({
          id: contactId,
          objectType: 'contact',
          encryptedSessionKey
        });
      } catch (err) {
        console.warn('Failed to register contact on server:', err);
      }
    }

    return { success: true };
  } catch (err) {
    console.error('Failed to register contact in VFS:', err);
    return {
      success: false,
      error: err instanceof Error ? err.message : String(err)
    };
  }
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

  const handleContactsImported = useCallback(
    async (importedContacts: ImportedContactRecord[]) => {
      const instanceId = databaseContext.currentInstanceId;
      if (!instanceId || importedContacts.length === 0) {
        return;
      }

      await indexDocuments(
        instanceId,
        importedContacts.map((contact) =>
          createContactDocument(
            contact.id,
            contact.firstName,
            contact.lastName,
            contact.email,
            contact.phone,
            contact.createdAt.getTime(),
            contact.updatedAt.getTime()
          )
        )
      );
    },
    [databaseContext.currentInstanceId]
  );

  return (
    <ContactsProvider
      databaseState={databaseState}
      getDatabase={getDatabase}
      getDatabaseAdapter={getDatabaseAdapter}
      saveFile={saveFile}
      registerInVfs={registerInVfs}
      onContactsImported={handleContactsImported}
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
