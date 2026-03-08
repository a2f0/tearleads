// Components
export {
  AttachmentInput,
  AttachmentList,
  ComposeDialog,
  EmailAboutMenuItem,
  EmailBodyView,
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
  type EmailBodyOperations,
  type EmailContactEmail,
  type EmailContactOperations,
  type EmailContextValue,
  type EmailDraftOperations,
  type EmailFolderOperations,
  EmailProvider,
  type EmailProviderProps,
  type EmailUIComponents,
  type RefreshButtonProps,
  type SaveDraftInput,
  useEmailApi,
  useEmailBodyOperations,
  useEmailContactOperations,
  useEmailContext,
  useEmailFolderOperations,
  useEmailUI,
  useHasEmailBodyOperations,
  useHasEmailContactOperations,
  useHasEmailFolderOperations,
  type WindowOptionsMenuItemProps
} from './context';

// Hooks
export {
  useCompose,
  useDrafts,
  useEmailBody,
  useEmailFolders,
  useEmails
} from './hooks';

// Lib
export {
  buildComposeRequest,
  buildForwardBody,
  buildForwardSubject,
  buildReplyBody,
  buildReplySubject,
  type ComposeMode,
  type ComposeRequestFields,
  type EmailItem,
  formatEmailDate,
  formatEmailSize,
  parseMimeMessage
} from './lib';

// Pages
export { Email } from './pages';

// Persistence
export {
  deleteEmailDraftFromDb,
  getEmailDraftFromDb,
  listEmailDraftsFromDb,
  saveEmailDraftToDb
} from './persistence';

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
  type EmailAttachmentPart,
  type EmailBodyViewMode,
  type EmailFolder,
  type EmailFolderType,
  type EmailFolderWithChildren,
  formatEmailAddresses,
  formatFileSize,
  initialComposeState,
  isSystemFolder,
  isValidEmail,
  type ParsedEmailBody,
  parseEmailAddresses,
  SYSTEM_FOLDER_NAMES,
  SYSTEM_FOLDER_TYPES,
  validateEmailAddresses
} from './types';
