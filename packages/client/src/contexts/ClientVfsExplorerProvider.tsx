/**
 * Client-side VfsExplorerProvider wrapper that supplies all dependencies
 * to the @rapid/vfs-explorer package components.
 */
import {
  VfsExplorerProvider,
  type VfsExplorerUIComponents
} from '@rapid/vfs-explorer';
import type { ReactNode } from 'react';
import { FloatingWindow } from '@/components/floating-window';
import { Button } from '@/components/ui/button';
import {
  DropdownMenu,
  DropdownMenuItem,
  DropdownMenuSeparator
} from '@/components/ui/dropdown-menu';
import { Input } from '@/components/ui/input';
import { WindowOptionsMenuItem } from '@/components/window-menu/WindowOptionsMenuItem';
import { getDatabase } from '@/db';
import { useDatabaseContext } from '@/db/hooks';
import { generateSessionKey, wrapSessionKey } from '@/hooks/useVfsKeys';
import { api } from '@/lib/api';
import { isLoggedIn, readStoredAuth } from '@/lib/auth-storage';
import { getFeatureFlagValue } from '@/lib/feature-flags';

const vfsExplorerUIComponents: VfsExplorerUIComponents = {
  Button,
  Input,
  DropdownMenu,
  DropdownMenuItem,
  DropdownMenuSeparator,
  WindowOptionsMenuItem,
  FloatingWindow
};

interface ClientVfsExplorerProviderProps {
  children: ReactNode;
}

export function ClientVfsExplorerProvider({
  children
}: ClientVfsExplorerProviderProps) {
  const databaseContext = useDatabaseContext();

  const databaseState = {
    isUnlocked: databaseContext.isUnlocked,
    isLoading: databaseContext.isLoading,
    currentInstanceId: databaseContext.currentInstanceId
  };

  return (
    <VfsExplorerProvider
      databaseState={databaseState}
      getDatabase={getDatabase}
      ui={vfsExplorerUIComponents}
      vfsKeys={{
        generateSessionKey,
        wrapSessionKey
      }}
      auth={{
        isLoggedIn,
        readStoredAuth
      }}
      featureFlags={{
        getFeatureFlagValue: (key: string) =>
          getFeatureFlagValue(key as 'vfsServerRegistration')
      }}
      vfsApi={{
        register: async (params: {
          id: string;
          objectType: string;
          encryptedSessionKey: string;
        }) => {
          await api.vfs.register({
            id: params.id,
            objectType: params.objectType as 'folder',
            encryptedSessionKey: params.encryptedSessionKey
          });
        }
      }}
    >
      {children}
    </VfsExplorerProvider>
  );
}
