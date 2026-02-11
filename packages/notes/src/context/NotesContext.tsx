import type { Database } from '@tearleads/db/sqlite';
import type { ComponentType, ReactNode } from 'react';
import { createContext, useContext, useMemo } from 'react';

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
 * VFS key management functions for registering notes in VFS
 */
export interface VfsKeyFunctions {
  generateSessionKey: () => Uint8Array;
  wrapSessionKey: (key: Uint8Array) => Promise<string>;
}

/**
 * Auth functions for VFS registration
 */
export interface AuthFunctions {
  isLoggedIn: () => boolean;
  readStoredAuth: () => { user: { id: string } | null };
}

/**
 * Feature flag functions
 */
export interface FeatureFlagFunctions {
  getFeatureFlagValue: (key: string) => boolean;
}

/**
 * VFS object type (matches @tearleads/shared VfsObjectType)
 */
export type VfsObjectType = 'file' | 'folder' | 'contact' | 'note' | 'photo';

/**
 * VFS API functions for server registration
 */
export interface VfsApiFunctions {
  register: (params: {
    id: string;
    objectType: VfsObjectType;
    encryptedSessionKey: string;
  }) => Promise<void>;
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

export type AboutMenuItemProps = Record<string, never>;

export interface BackLinkProps {
  defaultTo: string;
  defaultLabel: string;
}

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
  AboutMenuItem: ComponentType<AboutMenuItemProps>;
  BackLink: ComponentType<BackLinkProps>;
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
 * Navigation options for note navigation
 */
export interface NavigateToNoteOptions {
  fromLabel?: string;
}

/**
 * Navigation function type for navigating to a specific note
 */
export type NavigateToNote = (
  noteId: string,
  options?: NavigateToNoteOptions
) => void;

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
  /** VFS key management functions (optional - for VFS registration) */
  vfsKeys?: VfsKeyFunctions;
  /** Auth functions (optional - for VFS registration) */
  auth?: AuthFunctions;
  /** Feature flag functions (optional - for VFS registration) */
  featureFlags?: FeatureFlagFunctions;
  /** VFS API functions (optional - for server registration) */
  vfsApi?: VfsApiFunctions;
  /** Navigate to a specific note (for page component) */
  navigateToNote?: NavigateToNote;
}

const NotesContext = createContext<NotesContextValue | null>(null);

export interface NotesProviderProps {
  children: ReactNode;
  databaseState: DatabaseState;
  getDatabase: () => Database;
  ui: NotesUIComponents;
  t: TranslationFunction;
  tooltipZIndex?: number;
  /** VFS key management functions (optional - for VFS registration) */
  vfsKeys?: VfsKeyFunctions;
  /** Auth functions (optional - for VFS registration) */
  auth?: AuthFunctions;
  /** Feature flag functions (optional - for VFS registration) */
  featureFlags?: FeatureFlagFunctions;
  /** VFS API functions (optional - for server registration) */
  vfsApi?: VfsApiFunctions;
  navigateToNote?: NavigateToNote;
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
  tooltipZIndex = 10050,
  vfsKeys,
  auth,
  featureFlags,
  vfsApi,
  navigateToNote
}: NotesProviderProps) {
  const value = useMemo<NotesContextValue>(
    () => ({
      databaseState,
      getDatabase,
      ui,
      t,
      tooltipZIndex,
      ...(vfsKeys && { vfsKeys }),
      ...(auth && { auth }),
      ...(featureFlags && { featureFlags }),
      ...(vfsApi && { vfsApi }),
      ...(navigateToNote && { navigateToNote })
    }),
    [
      databaseState,
      getDatabase,
      ui,
      t,
      tooltipZIndex,
      vfsKeys,
      auth,
      featureFlags,
      vfsApi,
      navigateToNote
    ]
  );

  return (
    <NotesContext.Provider value={value}>{children}</NotesContext.Provider>
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
