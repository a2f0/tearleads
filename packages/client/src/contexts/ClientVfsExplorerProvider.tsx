/**
 * Client-side VfsExplorerProvider wrapper that supplies all dependencies
 * to the @rapid/vfs-explorer package components.
 */
import {
  VfsExplorerProvider,
  type VfsExplorerUIComponents
} from '@rapid/vfs-explorer';
import vfsExplorerPackageJson from '@rapid/vfs-explorer/package.json';
import { type ReactNode, useMemo } from 'react';
import { FloatingWindow } from '@/components/floating-window';
import { Button } from '@/components/ui/button';
import {
  ContextMenu,
  ContextMenuItem,
  ContextMenuSeparator
} from '@/components/ui/context-menu';
import {
  DropdownMenu,
  DropdownMenuItem,
  DropdownMenuSeparator
} from '@/components/ui/dropdown-menu';
import { Input } from '@/components/ui/input';
import { AboutMenuItem } from '@/components/window-menu/AboutMenuItem';
import { WindowOptionsMenuItem } from '@/components/window-menu/WindowOptionsMenuItem';
import { getDatabase } from '@/db';
import { useDatabaseContext } from '@/db/hooks';
import { generateSessionKey, wrapSessionKey } from '@/hooks/useVfsKeys';
import { api } from '@/lib/api';
import { isLoggedIn, readStoredAuth } from '@/lib/auth-storage';
import { getFeatureFlagValue } from '@/lib/feature-flags';

export function VfsExplorerAboutMenuItem() {
  return (
    <AboutMenuItem
      appName="VFS Explorer"
      version={vfsExplorerPackageJson.version}
    />
  );
}

const vfsExplorerUIComponents: VfsExplorerUIComponents = {
  AboutMenuItem: VfsExplorerAboutMenuItem,
  Button,
  ContextMenu,
  ContextMenuItem,
  ContextMenuSeparator,
  DropdownMenu,
  DropdownMenuItem,
  DropdownMenuSeparator,
  FloatingWindow,
  Input,
  WindowOptionsMenuItem
};

interface ClientVfsExplorerProviderProps {
  children: ReactNode;
}

export function ClientVfsExplorerProvider({
  children
}: ClientVfsExplorerProviderProps) {
  const databaseContext = useDatabaseContext();

  const databaseState = useMemo(
    () => ({
      isUnlocked: databaseContext.isUnlocked,
      isLoading: databaseContext.isLoading,
      currentInstanceId: databaseContext.currentInstanceId
    }),
    [
      databaseContext.isUnlocked,
      databaseContext.isLoading,
      databaseContext.currentInstanceId
    ]
  );

  const vfsKeys = useMemo(
    () => ({
      generateSessionKey,
      wrapSessionKey
    }),
    []
  );

  const auth = useMemo(
    () => ({
      isLoggedIn,
      readStoredAuth
    }),
    []
  );

  const featureFlags = useMemo(
    () => ({
      getFeatureFlagValue: (key: string) =>
        key === 'vfsServerRegistration' ? getFeatureFlagValue(key) : false
    }),
    []
  );

  const vfsApi = useMemo(
    () => ({
      register: async (params: {
        id: string;
        objectType: string;
        encryptedSessionKey: string;
      }) => {
        if (params.objectType !== 'folder') {
          throw new Error(`Unsupported VFS object type: ${params.objectType}`);
        }
        await api.vfs.register({
          id: params.id,
          objectType: params.objectType,
          encryptedSessionKey: params.encryptedSessionKey
        });
      }
    }),
    []
  );

  return (
    <VfsExplorerProvider
      databaseState={databaseState}
      getDatabase={getDatabase}
      ui={vfsExplorerUIComponents}
      vfsKeys={vfsKeys}
      auth={auth}
      featureFlags={featureFlags}
      vfsApi={vfsApi}
    >
      {children}
    </VfsExplorerProvider>
  );
}
