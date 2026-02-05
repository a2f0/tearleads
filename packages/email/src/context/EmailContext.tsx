import type { ComponentType, ReactNode } from 'react';
import { createContext, useContext } from 'react';
import type { EmailFolder, EmailFolderType } from '../types/folder.js';

/**
 * UI component props interfaces
 */
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

export interface RefreshButtonProps {
  onClick: () => void;
  loading: boolean;
}

/**
 * UI components that the email package requires from the consumer
 */
export interface EmailUIComponents {
  DropdownMenu: ComponentType<DropdownMenuProps>;
  DropdownMenuItem: ComponentType<DropdownMenuItemProps>;
  DropdownMenuSeparator: ComponentType<DropdownMenuSeparatorProps>;
  WindowOptionsMenuItem: ComponentType<WindowOptionsMenuItemProps>;
  AboutMenuItem: ComponentType<AboutMenuItemProps>;
  BackLink: ComponentType<BackLinkProps>;
  RefreshButton: ComponentType<RefreshButtonProps>;
}

/**
 * Email folder operations interface
 */
export interface EmailFolderOperations {
  /** Fetch all email folders */
  fetchFolders: () => Promise<EmailFolder[]>;
  /** Create a new folder */
  createFolder: (
    name: string,
    parentId?: string | null
  ) => Promise<EmailFolder>;
  /** Rename a folder */
  renameFolder: (id: string, newName: string) => Promise<void>;
  /** Delete a folder */
  deleteFolder: (id: string) => Promise<void>;
  /** Move a folder to a new parent */
  moveFolder: (id: string, newParentId: string | null) => Promise<void>;
  /** Initialize system folders (Inbox, Sent, Drafts, Trash, Spam) */
  initializeSystemFolders: () => Promise<void>;
  /** Get folder by type (for system folders) */
  getFolderByType: (type: EmailFolderType) => Promise<EmailFolder | null>;
}

/**
 * Context value interface
 */
export interface EmailContextValue {
  /** API base URL for fetching emails */
  apiBaseUrl: string;
  /** Function to get auth header value */
  getAuthHeader?: () => string | null;
  /** UI components */
  ui: EmailUIComponents;
  /** Folder operations (optional - provided by client with database access) */
  folderOperations?: EmailFolderOperations;
}

export const EmailContext = createContext<EmailContextValue | null>(null);

export interface EmailProviderProps {
  children: ReactNode;
  apiBaseUrl: string;
  getAuthHeader?: () => string | null;
  ui: EmailUIComponents;
  folderOperations?: EmailFolderOperations;
}

/**
 * Provider component that supplies all dependencies to email components
 */
export function EmailProvider({
  children,
  apiBaseUrl,
  getAuthHeader,
  ui,
  folderOperations
}: EmailProviderProps) {
  const contextValue: EmailContextValue = {
    apiBaseUrl,
    ui,
    ...(getAuthHeader !== undefined && { getAuthHeader }),
    ...(folderOperations !== undefined && { folderOperations })
  };

  return (
    <EmailContext.Provider value={contextValue}>
      {children}
    </EmailContext.Provider>
  );
}

/**
 * Hook to access email context
 * @throws Error if used outside EmailProvider
 */
export function useEmailContext(): EmailContextValue {
  const context = useContext(EmailContext);
  if (!context) {
    throw new Error('useEmailContext must be used within an EmailProvider');
  }
  return context;
}

/**
 * Hook to access UI components
 */
export function useEmailUI(): EmailUIComponents {
  const { ui } = useEmailContext();
  return ui;
}

/**
 * Hook to access API configuration
 */
export function useEmailApi(): {
  apiBaseUrl: string;
  getAuthHeader?: () => string | null;
} {
  const { apiBaseUrl, getAuthHeader } = useEmailContext();
  return {
    apiBaseUrl,
    ...(getAuthHeader !== undefined && { getAuthHeader })
  };
}

/**
 * Hook to access folder operations
 * @throws Error if folder operations are not provided
 */
export function useEmailFolderOperations(): EmailFolderOperations {
  const { folderOperations } = useEmailContext();
  if (!folderOperations) {
    throw new Error(
      'Email folder operations are not available. Ensure EmailProvider is configured with folderOperations.'
    );
  }
  return folderOperations;
}

/**
 * Hook to check if folder operations are available
 */
export function useHasEmailFolderOperations(): boolean {
  const { folderOperations } = useEmailContext();
  return folderOperations !== undefined;
}
