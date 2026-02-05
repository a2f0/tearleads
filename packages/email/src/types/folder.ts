/**
 * Email folder types for the folder sidebar
 */

/**
 * Folder type enum matching the database schema
 */
export type EmailFolderType =
  | 'inbox'
  | 'sent'
  | 'drafts'
  | 'trash'
  | 'spam'
  | 'custom';

/**
 * System folder types that are created automatically and cannot be deleted
 */
export const SYSTEM_FOLDER_TYPES: EmailFolderType[] = [
  'inbox',
  'sent',
  'drafts',
  'trash',
  'spam'
];

/**
 * Special ID for the "All Mail" view
 */
export const ALL_MAIL_ID = '__all_mail__';

/**
 * Display names for system folders (for i18n, use translation keys)
 */
export const SYSTEM_FOLDER_NAMES: Record<
  Exclude<EmailFolderType, 'custom'>,
  string
> = {
  inbox: 'Inbox',
  sent: 'Sent',
  drafts: 'Drafts',
  trash: 'Trash',
  spam: 'Spam'
};

/**
 * Email folder representation
 */
export interface EmailFolder {
  /** Unique identifier (VFS registry ID) */
  id: string;
  /** Decrypted folder name */
  name: string;
  /** Folder type */
  folderType: EmailFolderType;
  /** Parent folder ID (null for root folders) */
  parentId: string | null;
  /** Number of unread emails in this folder */
  unreadCount: number;
}

/**
 * Email folder with hierarchy information for tree rendering
 */
export interface EmailFolderWithChildren extends EmailFolder {
  /** Child folders */
  children: EmailFolderWithChildren[];
}

/**
 * Check if a folder is a system folder
 */
export function isSystemFolder(folder: EmailFolder): boolean {
  return SYSTEM_FOLDER_TYPES.includes(folder.folderType);
}

/**
 * Check if a folder can be deleted
 */
export function canDeleteFolder(folder: EmailFolder): boolean {
  return folder.folderType === 'custom';
}

/**
 * Check if a folder can be renamed
 */
export function canRenameFolder(folder: EmailFolder): boolean {
  return folder.folderType === 'custom';
}

/**
 * Check if a folder can have children
 */
export function canHaveChildren(folder: EmailFolder): boolean {
  // Only custom folders can have children
  return folder.folderType === 'custom';
}
