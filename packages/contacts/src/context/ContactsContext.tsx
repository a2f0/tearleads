import type { Database } from '@tearleads/db/sqlite';
import type { ComponentType, ReactNode, Ref } from 'react';
import { createContext, useContext, useMemo } from 'react';

/**
 * Database context state
 */
export interface DatabaseState {
  isUnlocked: boolean;
  isLoading: boolean;
  currentInstanceId: string | null;
}

/**
 * Navigation options for navigateWithFrom
 */
export interface NavigateOptions {
  fromLabel?: string;
  state?: Record<string, unknown>;
}

/**
 * UI component props interfaces
 */
export interface ButtonProps {
  type?: 'button' | 'submit' | 'reset';
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
  inputRef?: Ref<HTMLInputElement>;
  className?: string;
  disabled?: boolean;
  autoFocus?: boolean;
  autoComplete?: string;
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
  searchQuery?: string;
}

export interface InlineUnlockProps {
  description: string;
}

export interface DropdownMenuProps {
  trigger: string;
  children: ReactNode;
}

export interface DropdownMenuItemProps {
  onClick: () => void;
  checked?: boolean;
  icon?: ReactNode;
  disabled?: boolean;
  children: ReactNode;
}

export type DropdownMenuSeparatorProps = Record<string, never>;

export type WindowOptionsMenuItemProps = Record<string, never>;

export type AboutMenuItemProps = Record<string, never>;

export interface BackLinkProps {
  defaultTo: string;
  defaultLabel: string;
}

export interface DropzoneProps {
  onFilesSelected: (files: File[]) => void;
  accept?: string;
  multiple?: boolean;
  disabled?: boolean;
}

/**
 * UI components that the contacts package requires from the consumer
 */
export interface ContactsUIComponents {
  Button: ComponentType<ButtonProps>;
  Input: ComponentType<InputProps>;
  ContextMenu: ComponentType<ContextMenuProps>;
  ContextMenuItem: ComponentType<ContextMenuItemProps>;
  ListRow: ComponentType<ListRowProps>;
  RefreshButton: ComponentType<RefreshButtonProps>;
  VirtualListStatus: ComponentType<VirtualListStatusProps>;
  InlineUnlock: ComponentType<InlineUnlockProps>;
  DropdownMenu: ComponentType<DropdownMenuProps>;
  DropdownMenuItem: ComponentType<DropdownMenuItemProps>;
  DropdownMenuSeparator: ComponentType<DropdownMenuSeparatorProps>;
  WindowOptionsMenuItem: ComponentType<WindowOptionsMenuItemProps>;
  AboutMenuItem: ComponentType<AboutMenuItemProps>;
  BackLink: ComponentType<BackLinkProps>;
  Dropzone: ComponentType<DropzoneProps>;
}

/**
 * Translation keys used by the contacts package
 */
export type ContactsTranslationKey =
  // Context menu keys (from contextMenu namespace)
  | 'getInfo'
  | 'edit'
  | 'delete'
  | 'exportVCard'
  // Contacts namespace keys
  | 'contacts'
  | 'newContact'
  | 'firstNameRequired'
  | 'lastName'
  | 'birthdayPlaceholder'
  | 'emailAddresses'
  | 'phoneNumbers'
  | 'email'
  | 'phone'
  | 'label'
  | 'add'
  | 'primary'
  | 'details'
  | 'created'
  | 'updated'
  | 'loadingDatabase'
  | 'loadingContact'
  | 'loadingContacts'
  | 'noContactsYet'
  | 'createFirstContact'
  | 'noContactInfo'
  | 'searchContacts'
  | 'groups'
  | 'newGroup'
  | 'allContacts'
  | 'sendEmail'
  | 'rename'
  | 'groupName'
  | 'cancel'
  | 'create'
  | 'creating'
  | 'save'
  | 'saving'
  | 'deleteGroup'
  | 'deleteGroupConfirm'
  | 'deleting'
  | 'renameGroup'
  | 'importCsv'
  | 'done'
  | 'parsingCsv'
  | 'csvColumns'
  | 'dragColumnHint'
  | 'contactFields'
  | 'dragColumnHere'
  | 'previewFirstRows'
  | 'totalRows'
  | 'importing'
  | 'importContacts'
  | 'importedContacts'
  | 'skipped'
  | 'andMore'
  | 'chooseFileHint'
  | 'file'
  | 'new'
  | 'close'
  | 'view'
  | 'list'
  | 'table'
  | 'help'
  | 'thisContact'
  | 'createContact'
  | 'name'
  | 'value';

/**
 * Translation function type - accepts contacts-specific keys
 */
export type TranslationFunction = (key: ContactsTranslationKey) => string;

/**
 * File save function type for exporting vCards
 */
export type SaveFileFunction = (
  content: string,
  filename: string,
  mimeType: string
) => Promise<void>;

/**
 * VFS registration result
 */
export interface VfsRegistrationResult {
  success: boolean;
  error?: string;
}

/**
 * VFS registration function type
 * Registers a contact in the VFS registry for organization and sharing
 */
export type RegisterInVfsFunction = (
  contactId: string,
  createdAt: Date
) => Promise<VfsRegistrationResult>;

export interface ImportedContactRecord {
  id: string;
  firstName: string;
  lastName: string | null;
  email: string | null;
  phone: string | null;
  createdAt: Date;
  updatedAt: Date;
}

export type OnContactsImportedFunction = (
  contacts: ImportedContactRecord[]
) => Promise<void>;

/**
 * Context value interface
 */
/**
 * Database adapter interface for transaction support.
 * This is a simplified interface that matches what's needed for contacts operations.
 */
export interface DatabaseAdapter {
  beginTransaction: () => Promise<void>;
  commitTransaction: () => Promise<void>;
  rollbackTransaction: () => Promise<void>;
}

export interface ContactsContextValue {
  /** Database state */
  databaseState: DatabaseState;
  /** Get the database instance for queries */
  getDatabase: () => Database;
  /** Get the database adapter for transactions */
  getDatabaseAdapter: () => DatabaseAdapter;
  /** Save file function for exports */
  saveFile: SaveFileFunction;
  /** Register a contact in VFS for organization and sharing */
  registerInVfs: RegisterInVfsFunction;
  /** Optional callback after successful CSV import */
  onContactsImported: OnContactsImportedFunction;
  /** UI components */
  ui: ContactsUIComponents;
  /** Translation function for context menu labels */
  t: TranslationFunction;
  /** Z-index for tooltips */
  tooltipZIndex: number;
  /** Navigate to a route */
  navigate: (to: string) => void;
  /** Navigate with from state for back links */
  navigateWithFrom: (to: string, options?: NavigateOptions) => void;
  /** Format date utility */
  formatDate: (date: Date) => string;
  /** Open email composer with prefilled recipients */
  openEmailComposer?: (recipients: string[]) => boolean;
}

const ContactsContext = createContext<ContactsContextValue | null>(null);

export interface ContactsProviderProps {
  children: ReactNode;
  databaseState: DatabaseState;
  getDatabase: () => Database;
  getDatabaseAdapter: () => DatabaseAdapter;
  saveFile: SaveFileFunction;
  registerInVfs: RegisterInVfsFunction;
  onContactsImported?: OnContactsImportedFunction;
  ui: ContactsUIComponents;
  t: TranslationFunction;
  tooltipZIndex?: number;
  navigate: (to: string) => void;
  navigateWithFrom: (to: string, options?: NavigateOptions) => void;
  formatDate: (date: Date) => string;
  openEmailComposer?: (recipients: string[]) => boolean;
}

/**
 * Provider component that supplies all dependencies to contacts components
 */
export function ContactsProvider({
  children,
  databaseState,
  getDatabase,
  getDatabaseAdapter,
  saveFile,
  registerInVfs,
  onContactsImported,
  ui,
  t,
  tooltipZIndex = 10050,
  navigate,
  navigateWithFrom,
  formatDate,
  openEmailComposer
}: ContactsProviderProps) {
  const value = useMemo<ContactsContextValue>(
    () => ({
      databaseState,
      getDatabase,
      getDatabaseAdapter,
      saveFile,
      registerInVfs,
      onContactsImported:
        onContactsImported ??
        (async () => {
          return;
        }),
      ui,
      t,
      tooltipZIndex,
      navigate,
      navigateWithFrom,
      formatDate,
      ...(openEmailComposer !== undefined && { openEmailComposer })
    }),
    [
      databaseState,
      getDatabase,
      getDatabaseAdapter,
      saveFile,
      registerInVfs,
      onContactsImported,
      ui,
      t,
      tooltipZIndex,
      navigate,
      navigateWithFrom,
      formatDate,
      openEmailComposer
    ]
  );

  return (
    <ContactsContext.Provider value={value}>
      {children}
    </ContactsContext.Provider>
  );
}

/**
 * Hook to access contacts context
 * @throws Error if used outside ContactsProvider
 */
export function useContactsContext(): ContactsContextValue {
  const context = useContext(ContactsContext);
  if (!context) {
    throw new Error(
      'useContactsContext must be used within a ContactsProvider'
    );
  }
  return context;
}

/**
 * Hook to access database state
 */
export function useDatabaseState(): DatabaseState {
  const { databaseState } = useContactsContext();
  return databaseState;
}

/**
 * Hook to access UI components
 */
export function useContactsUI(): ContactsUIComponents {
  const { ui } = useContactsContext();
  return ui;
}
