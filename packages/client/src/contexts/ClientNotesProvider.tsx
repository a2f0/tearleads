/**
 * Client-side NotesProvider wrapper that supplies all dependencies
 * to the @tearleads/notes package components.
 */
import {
  type NavigateToNote,
  NotesProvider,
  type NotesUIComponents
} from '@tearleads/notes';
import notesPackageJson from '@tearleads/notes/package.json';
import {
  DesktopContextMenu as ContextMenu,
  DesktopContextMenuItem as ContextMenuItem
} from '@tearleads/window-manager';
import { type ReactNode, useCallback, useMemo } from 'react';
import { InlineUnlock } from '@/components/sqlite/InlineUnlock';
import { BackLink } from '@/components/ui/back-link';
import { Button } from '@/components/ui/button';
import {
  DropdownMenu,
  DropdownMenuItem,
  DropdownMenuSeparator
} from '@/components/ui/dropdown-menu';
import { EditableTitle } from '@/components/ui/editable-title';
import { Input } from '@/components/ui/input';
import { ListRow } from '@/components/ui/ListRow';
import { RefreshButton } from '@/components/ui/RefreshButton';
import { VirtualListStatus } from '@/components/ui/VirtualListStatus';
import { AboutMenuItem } from '@/components/window-menu/AboutMenuItem';
import { WindowOptionsMenuItem } from '@/components/window-menu/WindowOptionsMenuItem';
import { zIndex } from '@/constants/zIndex';
import { getDatabase } from '@/db';
import { useDatabaseContext } from '@/db/hooks';
import { generateSessionKey, wrapSessionKey } from '@/hooks/useVfsKeys';
import { useTypedTranslation } from '@/i18n';
import { api } from '@/lib/api';
import { isLoggedIn, readStoredAuth } from '@/lib/authStorage';
import { getFeatureFlagValue } from '@/lib/featureFlags';
import { useNavigateWithFrom } from '@/lib/navigation';

export function NotesAboutMenuItem() {
  return <AboutMenuItem appName="Notes" version={notesPackageJson.version} />;
}

const notesUIComponents: NotesUIComponents = {
  Button,
  Input,
  ContextMenu,
  ContextMenuItem,
  ListRow,
  RefreshButton,
  VirtualListStatus,
  InlineUnlock,
  EditableTitle,
  DropdownMenu,
  DropdownMenuItem,
  DropdownMenuSeparator,
  WindowOptionsMenuItem,
  AboutMenuItem: NotesAboutMenuItem,
  BackLink
};

interface ClientNotesProviderProps {
  children: ReactNode;
}

export function ClientNotesProvider({ children }: ClientNotesProviderProps) {
  const databaseContext = useDatabaseContext();
  const { t } = useTypedTranslation('contextMenu');
  const navigateWithFrom = useNavigateWithFrom();

  const databaseState = useMemo(
    () => ({
      isUnlocked: databaseContext.isUnlocked,
      isLoading: databaseContext.isLoading,
      currentInstanceId: databaseContext.currentInstanceId
    }),
    [
      databaseContext.isUnlocked,
      databaseContext.isLoading,
      databaseContext.currentInstanceId
    ]
  );

  const vfsKeys = useMemo(
    () => ({
      generateSessionKey,
      wrapSessionKey
    }),
    []
  );

  const auth = useMemo(
    () => ({
      isLoggedIn,
      readStoredAuth
    }),
    []
  );

  const featureFlags = useMemo(
    () => ({
      getFeatureFlagValue: (key: string) =>
        key === 'vfsServerRegistration' ? getFeatureFlagValue(key) : false
    }),
    []
  );

  const vfsApi = useMemo(
    () => ({
      register: async (params: {
        id: string;
        objectType: 'file' | 'folder' | 'contact' | 'note' | 'photo';
        encryptedSessionKey: string;
      }) => {
        await api.vfs.register(params);
      }
    }),
    []
  );

  const navigateToNote: NavigateToNote = useCallback(
    (noteId, options) => {
      navigateWithFrom(
        `/notes/${noteId}`,
        options?.fromLabel ? { fromLabel: options.fromLabel } : undefined
      );
    },
    [navigateWithFrom]
  );

  return (
    <NotesProvider
      databaseState={databaseState}
      getDatabase={getDatabase}
      ui={notesUIComponents}
      t={t}
      tooltipZIndex={zIndex.tooltip}
      vfsKeys={vfsKeys}
      auth={auth}
      featureFlags={featureFlags}
      vfsApi={vfsApi}
      navigateToNote={navigateToNote}
    >
      {children}
    </NotesProvider>
  );
}
