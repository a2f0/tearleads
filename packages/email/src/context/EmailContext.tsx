import type { ComponentType, ReactNode } from 'react';
import { createContext, useContext } from 'react';

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
  BackLink: ComponentType<BackLinkProps>;
  RefreshButton: ComponentType<RefreshButtonProps>;
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
}

const EmailContext = createContext<EmailContextValue | null>(null);

export interface EmailProviderProps {
  children: ReactNode;
  apiBaseUrl: string;
  getAuthHeader?: () => string | null;
  ui: EmailUIComponents;
}

/**
 * Provider component that supplies all dependencies to email components
 */
export function EmailProvider({
  children,
  apiBaseUrl,
  getAuthHeader,
  ui
}: EmailProviderProps) {
  const contextValue: EmailContextValue = {
    apiBaseUrl,
    ui,
    ...(getAuthHeader !== undefined && { getAuthHeader })
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
