import type { Database } from '@tearleads/db/sqlite';
import type {
  CreateOrgShareRequest,
  CreateVfsShareRequest,
  ShareTargetSearchResponse,
  UpdateVfsShareRequest,
  VfsOrgShare,
  VfsShare,
  VfsSharesResponse,
  VfsShareType
} from '@tearleads/shared';
import type { ComponentType, ReactNode, RefObject } from 'react';
import { createContext, useContext } from 'react';

/**
 * Database context state
 */
export interface DatabaseState {
  isUnlocked: boolean;
  isLoading: boolean;
  currentInstanceId: string | null;
}

/**
 * VFS key management functions
 */
export interface VfsKeyFunctions {
  generateSessionKey: () => Uint8Array;
  wrapSessionKey: (key: Uint8Array) => Promise<string>;
}

/**
 * Auth functions
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
 * VFS API functions for server registration
 */
export interface VfsApiFunctions {
  register: (params: {
    id: string;
    objectType: string;
    encryptedSessionKey: string;
  }) => Promise<void>;
}

/**
 * VFS Share API functions
 */
export interface VfsShareApiFunctions {
  getShares: (itemId: string) => Promise<VfsSharesResponse>;
  createShare: (request: CreateVfsShareRequest) => Promise<VfsShare>;
  updateShare: (
    shareId: string,
    request: UpdateVfsShareRequest
  ) => Promise<VfsShare>;
  deleteShare: (
    shareId: string,
    itemId?: string
  ) => Promise<{ deleted: boolean }>;
  createOrgShare: (request: CreateOrgShareRequest) => Promise<VfsOrgShare>;
  deleteOrgShare: (
    shareId: string,
    itemId?: string
  ) => Promise<{ deleted: boolean }>;
  searchTargets: (
    query: string,
    type?: VfsShareType
  ) => Promise<ShareTargetSearchResponse>;
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
  type?: 'button' | 'submit' | 'reset';
  children?: ReactNode;
  'data-testid'?: string;
}

export interface InputProps {
  type?: string;
  placeholder?: string;
  value?: string;
  onChange?: (e: React.ChangeEvent<HTMLInputElement>) => void;
  className?: string;
  disabled?: boolean;
  autoComplete?: string;
  ref?: RefObject<HTMLInputElement | null>;
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
  'data-testid'?: string;
}

export type ContextMenuSeparatorProps = Record<string, never>;

export type WindowOptionsMenuItemProps = Record<string, never>;

export type AboutMenuItemProps = Record<string, never>;

export interface FloatingWindowProps {
  id: string;
  title: string;
  onClose: () => void;
  onMinimize: (dimensions: WindowDimensions) => void;
  onDimensionsChange?: ((dimensions: WindowDimensions) => void) | undefined;
  onRename?: ((title: string) => void) | undefined;
  onFocus: () => void;
  zIndex: number;
  initialDimensions?: WindowDimensions | undefined;
  defaultWidth?: number;
  defaultHeight?: number;
  minWidth?: number;
  minHeight?: number;
  children: ReactNode;
}

export interface WindowDimensions {
  x: number;
  y: number;
  width: number;
  height: number;
}

/**
 * UI components that the vfs-explorer package requires from the consumer
 */
export interface VfsExplorerUIComponents {
  Button: ComponentType<ButtonProps>;
  Input: ComponentType<
    InputProps & { ref?: RefObject<HTMLInputElement | null> }
  >;
  DropdownMenu: ComponentType<DropdownMenuProps>;
  DropdownMenuItem: ComponentType<DropdownMenuItemProps>;
  DropdownMenuSeparator: ComponentType<DropdownMenuSeparatorProps>;
  WindowOptionsMenuItem: ComponentType<WindowOptionsMenuItemProps>;
  AboutMenuItem: ComponentType<AboutMenuItemProps>;
  FloatingWindow: ComponentType<FloatingWindowProps>;
  ContextMenu: ComponentType<ContextMenuProps>;
  ContextMenuItem: ComponentType<ContextMenuItemProps>;
  ContextMenuSeparator: ComponentType<ContextMenuSeparatorProps>;
}

/**
 * Context value interface
 */
export interface VfsExplorerContextValue {
  /** Database state */
  databaseState: DatabaseState;
  /** Get the database instance for queries */
  getDatabase: () => Database;
  /** UI components */
  ui: VfsExplorerUIComponents;
  /** VFS key management functions */
  vfsKeys: VfsKeyFunctions;
  /** Auth functions */
  auth: AuthFunctions;
  /** Feature flag functions */
  featureFlags: FeatureFlagFunctions;
  /** VFS API functions */
  vfsApi: VfsApiFunctions;
  /** VFS Share API functions (optional) */
  vfsShareApi?: VfsShareApiFunctions | undefined;
  /** Fallback UI to render when the user is not logged in */
  loginFallback?: ReactNode | undefined;
}

const VfsExplorerContext = createContext<VfsExplorerContextValue | null>(null);

export interface VfsExplorerProviderProps {
  children: ReactNode;
  databaseState: DatabaseState;
  getDatabase: () => Database;
  ui: VfsExplorerUIComponents;
  vfsKeys: VfsKeyFunctions;
  auth: AuthFunctions;
  featureFlags: FeatureFlagFunctions;
  vfsApi: VfsApiFunctions;
  vfsShareApi?: VfsShareApiFunctions | undefined;
  loginFallback?: ReactNode | undefined;
}

/**
 * Provider component that supplies all dependencies to VFS explorer components
 */
export function VfsExplorerProvider({
  children,
  databaseState,
  getDatabase,
  ui,
  vfsKeys,
  auth,
  featureFlags,
  vfsApi,
  vfsShareApi,
  loginFallback
}: VfsExplorerProviderProps) {
  return (
    <VfsExplorerContext.Provider
      value={{
        databaseState,
        getDatabase,
        ui,
        vfsKeys,
        auth,
        featureFlags,
        vfsApi,
        vfsShareApi,
        loginFallback
      }}
    >
      {children}
    </VfsExplorerContext.Provider>
  );
}

/**
 * Hook to access VFS explorer context
 * @throws Error if used outside VfsExplorerProvider
 */
export function useVfsExplorerContext(): VfsExplorerContextValue {
  const context = useContext(VfsExplorerContext);
  if (!context) {
    throw new Error(
      'useVfsExplorerContext must be used within a VfsExplorerProvider'
    );
  }
  return context;
}

/**
 * Hook to access database state
 */
export function useDatabaseState(): DatabaseState {
  const { databaseState } = useVfsExplorerContext();
  return databaseState;
}

/**
 * Hook to access UI components
 */
export function useVfsExplorerUI(): VfsExplorerUIComponents {
  const { ui } = useVfsExplorerContext();
  return ui;
}
