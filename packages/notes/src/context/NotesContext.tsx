import type { Database } from '@rapid/db/sqlite';
import type { ComponentType, ReactNode } from 'react';
import { createContext, useContext } from 'react';

/**
 * Note data structure matching the notes table schema
 */
export interface NoteInfo {
  id: string;
  title: string;
  content: string;
  createdAt: Date;
  updatedAt: Date;
  deleted: boolean;
}

/**
 * Database context state
 */
export interface DatabaseState {
  isUnlocked: boolean;
  isLoading: boolean;
  currentInstanceId: string | null;
}

/**
 * UI component props interfaces
 */
export interface ButtonProps {
  variant?:
    | 'default'
    | 'ghost'
    | 'destructive'
    | 'outline'
    | 'secondary'
    | 'link';
  size?: 'default' | 'sm' | 'lg' | 'icon';
  className?: string;
  disabled?: boolean;
  onClick?: () => void;
  children?: ReactNode;
  'data-testid'?: string;
}

export interface InputProps {
  type?: string;
  placeholder?: string;
  value?: string;
  onChange?: (e: React.ChangeEvent<HTMLInputElement>) => void;
  className?: string;
  'data-testid'?: string;
}

export interface ContextMenuProps {
  x: number;
  y: number;
  onClose: () => void;
  children: ReactNode;
}

export interface ContextMenuItemProps {
  icon?: ReactNode;
  onClick: () => void;
  children: ReactNode;
}

export interface ListRowProps {
  className?: string;
  onContextMenu?: ((e: React.MouseEvent) => void) | undefined;
  children: ReactNode;
}

export interface RefreshButtonProps {
  onClick: () => void;
  loading: boolean;
  size?: 'sm' | 'default';
}

export interface VirtualListStatusProps {
  firstVisible: number;
  lastVisible: number;
  loadedCount: number;
  itemLabel: string;
}

export interface InlineUnlockProps {
  description: string;
}

export interface EditableTitleProps {
  value: string;
  onSave: (value: string) => Promise<void>;
  'data-testid'?: string;
}

export interface DropdownMenuProps {
  trigger: string;
  children: ReactNode;
}

export interface DropdownMenuItemProps {
  onClick: () => void;
  checked?: boolean;
  icon?: ReactNode;
  children: ReactNode;
}

export type DropdownMenuSeparatorProps = Record<string, never>;

export type WindowOptionsMenuItemProps = Record<string, never>;

/**
 * UI components that the notes package requires from the consumer
 */
export interface NotesUIComponents {
  Button: ComponentType<ButtonProps>;
  Input: ComponentType<InputProps>;
  ContextMenu: ComponentType<ContextMenuProps>;
  ContextMenuItem: ComponentType<ContextMenuItemProps>;
  ListRow: ComponentType<ListRowProps>;
  RefreshButton: ComponentType<RefreshButtonProps>;
  VirtualListStatus: ComponentType<VirtualListStatusProps>;
  InlineUnlock: ComponentType<InlineUnlockProps>;
  EditableTitle: ComponentType<EditableTitleProps>;
  DropdownMenu: ComponentType<DropdownMenuProps>;
  DropdownMenuItem: ComponentType<DropdownMenuItemProps>;
  DropdownMenuSeparator: ComponentType<DropdownMenuSeparatorProps>;
  WindowOptionsMenuItem: ComponentType<WindowOptionsMenuItemProps>;
}

/**
 * Translation keys used by the notes package
 */
export type NotesTranslationKey = 'getInfo' | 'delete' | 'newNote';

/**
 * Translation function type - accepts notes-specific keys
 */
export type TranslationFunction = (key: NotesTranslationKey) => string;

/**
 * Context value interface
 */
export interface NotesContextValue {
  /** Database state */
  databaseState: DatabaseState;
  /** Get the database instance for queries */
  getDatabase: () => Database;
  /** UI components */
  ui: NotesUIComponents;
  /** Translation function for context menu labels */
  t: TranslationFunction;
  /** Z-index for tooltips */
  tooltipZIndex: number;
}

const NotesContext = createContext<NotesContextValue | null>(null);

export interface NotesProviderProps {
  children: ReactNode;
  databaseState: DatabaseState;
  getDatabase: () => Database;
  ui: NotesUIComponents;
  t: TranslationFunction;
  tooltipZIndex?: number;
}

/**
 * Provider component that supplies all dependencies to notes components
 */
export function NotesProvider({
  children,
  databaseState,
  getDatabase,
  ui,
  t,
  tooltipZIndex = 10050
}: NotesProviderProps) {
  return (
    <NotesContext.Provider
      value={{
        databaseState,
        getDatabase,
        ui,
        t,
        tooltipZIndex
      }}
    >
      {children}
    </NotesContext.Provider>
  );
}

/**
 * Hook to access notes context
 * @throws Error if used outside NotesProvider
 */
export function useNotesContext(): NotesContextValue {
  const context = useContext(NotesContext);
  if (!context) {
    throw new Error('useNotesContext must be used within a NotesProvider');
  }
  return context;
}

/**
 * Hook to access database state
 */
export function useDatabaseState(): DatabaseState {
  const { databaseState } = useNotesContext();
  return databaseState;
}

/**
 * Hook to access UI components
 */
export function useNotesUI(): NotesUIComponents {
  const { ui } = useNotesContext();
  return ui;
}
