import type { MlsV2Routes } from '@tearleads/api-client/mlsRoutes';
import type { BroadcastMessage } from '@tearleads/shared';
import type { ComponentType, ReactNode } from 'react';
import { createContext, useContext } from 'react';
import type { SseConnectionState } from '../types.js';

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
  align?: 'left' | 'right';
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

export interface MlsRealtimeMessage {
  channel: string;
  message: BroadcastMessage;
}

export interface MlsRealtimeBridge {
  connectionState: SseConnectionState;
  lastMessage: MlsRealtimeMessage | null;
  addChannels: (channels: string[]) => void;
  removeChannels: (channels: string[]) => void;
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
  /** MLS V2 API routes (generated Connect-ES client) */
  mlsRoutes: MlsV2Routes;
  /** Optional shared realtime bridge from the host app */
  realtime?: MlsRealtimeBridge;
}

const MlsChatContext = createContext<MlsChatContextValue | null>(null);

export interface MlsChatProviderProps {
  children: ReactNode;
  apiBaseUrl: string;
  getAuthHeader?: () => string | null;
  userId: string;
  userEmail: string;
  ui: MlsChatUIComponents;
  mlsRoutes: MlsV2Routes;
  realtime?: MlsRealtimeBridge;
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
  ui,
  mlsRoutes,
  realtime
}: MlsChatProviderProps) {
  const contextValue: MlsChatContextValue = {
    apiBaseUrl,
    userId,
    userEmail,
    ui,
    mlsRoutes,
    ...(realtime !== undefined && { realtime }),
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

/**
 * Hook to access MLS V2 routes
 */
export function useMlsRoutes(): MlsV2Routes {
  const { mlsRoutes } = useMlsChatContext();
  return mlsRoutes;
}

export function useMlsChatRealtime(): MlsRealtimeBridge | undefined {
  const { realtime } = useMlsChatContext();
  return realtime;
}
