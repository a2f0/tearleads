/**
 * Client-side NotesProvider wrapper that supplies all dependencies
 * to the @rapid/notes package components.
 */
import {
  type NavigateToNote,
  NotesProvider,
  type NotesUIComponents
} from '@rapid/notes';
import notesPackageJson from '@rapid/notes/package.json';
import { type ReactNode, useCallback } from 'react';
import { InlineUnlock } from '@/components/sqlite/InlineUnlock';
import { BackLink } from '@/components/ui/back-link';
import { Button } from '@/components/ui/button';
import { ContextMenu, ContextMenuItem } from '@/components/ui/context-menu';
import {
  DropdownMenu,
  DropdownMenuItem,
  DropdownMenuSeparator
} from '@/components/ui/dropdown-menu';
import { EditableTitle } from '@/components/ui/editable-title';
import { Input } from '@/components/ui/input';
import { ListRow } from '@/components/ui/list-row';
import { RefreshButton } from '@/components/ui/refresh-button';
import { VirtualListStatus } from '@/components/ui/VirtualListStatus';
import { AboutMenuItem } from '@/components/window-menu/AboutMenuItem';
import { WindowOptionsMenuItem } from '@/components/window-menu/WindowOptionsMenuItem';
import { zIndex } from '@/constants/zIndex';
import { getDatabase } from '@/db';
import { useDatabaseContext } from '@/db/hooks';
import { generateSessionKey, wrapSessionKey } from '@/hooks/useVfsKeys';
import { useTypedTranslation } from '@/i18n';
import { api } from '@/lib/api';
import { isLoggedIn, readStoredAuth } from '@/lib/auth-storage';
import { getFeatureFlagValue } from '@/lib/feature-flags';
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

  const databaseState = {
    isUnlocked: databaseContext.isUnlocked,
    isLoading: databaseContext.isLoading,
    currentInstanceId: databaseContext.currentInstanceId
  };

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
      vfsKeys={{
        generateSessionKey,
        wrapSessionKey
      }}
      auth={{
        isLoggedIn,
        readStoredAuth
      }}
      featureFlags={{
        getFeatureFlagValue: (key: string) =>
          key === 'vfsServerRegistration' ? getFeatureFlagValue(key) : false
      }}
      vfsApi={{
        register: async (params) => {
          await api.vfs.register(params);
        }
      }}
      navigateToNote={navigateToNote}
    >
      {children}
    </NotesProvider>
  );
}
