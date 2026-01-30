import type { ComponentType, ReactNode } from 'react';
import { createContext, useContext } from 'react';

/**
 * UI component props interfaces
 */
export interface ButtonProps {
  onClick?: () => void;
  children: ReactNode;
  disabled?: boolean;
  variant?: 'default' | 'destructive' | 'outline' | 'secondary' | 'ghost';
  size?: 'default' | 'sm' | 'lg' | 'icon';
  className?: string;
}

export interface InputProps {
  value: string;
  onChange: (value: string) => void;
  placeholder?: string;
  disabled?: boolean;
  className?: string;
}

export interface AvatarProps {
  userId: string;
  email?: string | undefined;
  size?: 'sm' | 'md' | 'lg';
  className?: string;
}

export interface ScrollAreaProps {
  children: ReactNode;
  className?: string;
}

export interface DropdownMenuProps {
  trigger: ReactNode;
  children: ReactNode;
}

export interface DropdownMenuItemProps {
  onClick: () => void;
  icon?: ReactNode;
  children: ReactNode;
}

/**
 * UI components that the MLS chat package requires from the consumer
 */
export interface MlsChatUIComponents {
  Button: ComponentType<ButtonProps>;
  Input: ComponentType<InputProps>;
  Avatar: ComponentType<AvatarProps>;
  ScrollArea: ComponentType<ScrollAreaProps>;
  DropdownMenu: ComponentType<DropdownMenuProps>;
  DropdownMenuItem: ComponentType<DropdownMenuItemProps>;
}

/**
 * Context value interface
 */
export interface MlsChatContextValue {
  /** API base URL for MLS endpoints */
  apiBaseUrl: string;
  /** Function to get auth header value */
  getAuthHeader?: () => string | null;
  /** Current user ID */
  userId: string;
  /** Current user email */
  userEmail: string;
  /** UI components */
  ui: MlsChatUIComponents;
}

const MlsChatContext = createContext<MlsChatContextValue | null>(null);

export interface MlsChatProviderProps {
  children: ReactNode;
  apiBaseUrl: string;
  getAuthHeader?: () => string | null;
  userId: string;
  userEmail: string;
  ui: MlsChatUIComponents;
}

/**
 * Provider component that supplies all dependencies to MLS chat components
 */
export function MlsChatProvider({
  children,
  apiBaseUrl,
  getAuthHeader,
  userId,
  userEmail,
  ui
}: MlsChatProviderProps) {
  const contextValue: MlsChatContextValue = {
    apiBaseUrl,
    userId,
    userEmail,
    ui,
    ...(getAuthHeader !== undefined && { getAuthHeader })
  };

  return (
    <MlsChatContext.Provider value={contextValue}>
      {children}
    </MlsChatContext.Provider>
  );
}

/**
 * Hook to access MLS chat context
 * @throws Error if used outside MlsChatProvider
 */
export function useMlsChatContext(): MlsChatContextValue {
  const context = useContext(MlsChatContext);
  if (!context) {
    throw new Error('useMlsChatContext must be used within an MlsChatProvider');
  }
  return context;
}

/**
 * Hook to access UI components
 */
export function useMlsChatUI(): MlsChatUIComponents {
  const { ui } = useMlsChatContext();
  return ui;
}

/**
 * Hook to access API configuration
 */
export function useMlsChatApi(): {
  apiBaseUrl: string;
  getAuthHeader?: () => string | null;
} {
  const { apiBaseUrl, getAuthHeader } = useMlsChatContext();
  return {
    apiBaseUrl,
    ...(getAuthHeader !== undefined && { getAuthHeader })
  };
}

/**
 * Hook to access current user info
 */
export function useMlsChatUser(): { userId: string; userEmail: string } {
  const { userId, userEmail } = useMlsChatContext();
  return { userId, userEmail };
}
