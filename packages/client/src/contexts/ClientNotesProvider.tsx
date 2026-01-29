/**
 * Client-side NotesProvider wrapper that supplies all dependencies
 * to the @rapid/notes package components.
 */
import { NotesProvider, type NotesUIComponents } from '@rapid/notes';
import type { ReactNode } from 'react';
import { InlineUnlock } from '@/components/sqlite/InlineUnlock';
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
import { useTypedTranslation } from '@/i18n';
import notesPackageJson from '../../../notes/package.json';

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
  AboutMenuItem: NotesAboutMenuItem
};

interface ClientNotesProviderProps {
  children: ReactNode;
}

export function ClientNotesProvider({ children }: ClientNotesProviderProps) {
  const databaseContext = useDatabaseContext();
  const { t } = useTypedTranslation('contextMenu');

  const databaseState = {
    isUnlocked: databaseContext.isUnlocked,
    isLoading: databaseContext.isLoading,
    currentInstanceId: databaseContext.currentInstanceId
  };

  return (
    <NotesProvider
      databaseState={databaseState}
      getDatabase={getDatabase}
      ui={notesUIComponents}
      t={t}
      tooltipZIndex={zIndex.tooltip}
    >
      {children}
    </NotesProvider>
  );
}
