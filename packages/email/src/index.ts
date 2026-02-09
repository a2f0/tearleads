// Components
export {
  AttachmentInput,
  AttachmentList,
  ComposeDialog,
  EmailWindow,
  EmailWindowMenuBar,
  type ViewMode
} from './components';

// Context
export {
  type AboutMenuItemProps,
  type BackLinkProps,
  type DropdownMenuItemProps,
  type DropdownMenuProps,
  type DropdownMenuSeparatorProps,
  type EmailContactEmail,
  type EmailContactOperations,
  type EmailContextValue,
  type EmailFolderOperations,
  EmailProvider,
  type EmailProviderProps,
  type EmailUIComponents,
  type RefreshButtonProps,
  useEmailApi,
  useEmailContactOperations,
  useEmailContext,
  useEmailFolderOperations,
  useEmailUI,
  useHasEmailContactOperations,
  useHasEmailFolderOperations,
  type WindowOptionsMenuItemProps
} from './context';

// Hooks
export { useCompose, useDrafts, useEmailFolders, useEmails } from './hooks';

// Lib
export { type EmailItem, formatEmailDate, formatEmailSize } from './lib';

// Pages
export { Email } from './pages';

// Types
export {
  ALL_MAIL_ID,
  type Attachment,
  type ComposeState,
  canDeleteFolder,
  canHaveChildren,
  canRenameFolder,
  type DraftEmail,
  type DraftListItem,
  type EmailFolder,
  type EmailFolderType,
  type EmailFolderWithChildren,
  formatEmailAddresses,
  formatFileSize,
  initialComposeState,
  isSystemFolder,
  isValidEmail,
  parseEmailAddresses,
  SYSTEM_FOLDER_NAMES,
  SYSTEM_FOLDER_TYPES,
  validateEmailAddresses
} from './types';
