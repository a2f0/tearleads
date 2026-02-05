// Components
export { EmailWindow, EmailWindowMenuBar, type ViewMode } from './components';

// Context
export {
  type AboutMenuItemProps,
  type BackLinkProps,
  type DropdownMenuItemProps,
  type DropdownMenuProps,
  type DropdownMenuSeparatorProps,
  type EmailContextValue,
  type EmailFolderOperations,
  EmailProvider,
  type EmailProviderProps,
  type EmailUIComponents,
  type RefreshButtonProps,
  useEmailApi,
  useEmailContext,
  useEmailFolderOperations,
  useEmailUI,
  useHasEmailFolderOperations,
  type WindowOptionsMenuItemProps
} from './context';

// Hooks
export { useEmailFolders, useEmails } from './hooks';

// Lib
export { type EmailItem, formatEmailDate, formatEmailSize } from './lib';

// Pages
export { Email } from './pages';

// Types
export {
  ALL_MAIL_ID,
  canDeleteFolder,
  canHaveChildren,
  canRenameFolder,
  type EmailFolder,
  type EmailFolderType,
  type EmailFolderWithChildren,
  isSystemFolder,
  SYSTEM_FOLDER_NAMES,
  SYSTEM_FOLDER_TYPES
} from './types';
