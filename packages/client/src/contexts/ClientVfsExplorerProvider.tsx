/**
 * Client-side VfsExplorerProvider wrapper that supplies all dependencies
 * to the @tearleads/vfs-explorer package components.
 */

import { rotateItemKeyEpochAndPersist } from '@tearleads/api-client';
import {
  VfsExplorerProvider,
  type VfsExplorerUIComponents
} from '@tearleads/vfs-explorer';
import vfsExplorerPackageJson from '@tearleads/vfs-explorer/package.json';
import {
  DesktopContextMenu as ContextMenu,
  DesktopContextMenuItem as ContextMenuItem,
  DesktopContextMenuSeparator as ContextMenuSeparator,
  DesktopFloatingWindow as FloatingWindow
} from '@tearleads/window-manager';
import { type ReactNode, useCallback, useMemo } from 'react';
import { InlineLogin } from '@/components/auth/InlineLogin';
import { Button } from '@/components/ui/button';
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
import { generateSessionKey, wrapSessionKey } from '@/hooks/vfs';
import { api } from '@/lib/api';
import { isLoggedIn, readStoredAuth } from '@/lib/authStorage';
import { getFeatureFlagValue } from '@/lib/featureFlags';
import { hydrateLocalReadModelFromRemoteFeeds } from '@/lib/vfsReadModelHydration';
import {
  useVfsKeyManager,
  useVfsOrchestratorInstance
} from './VfsOrchestratorContext';

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
  const keyManager = useVfsKeyManager();
  const orchestrator = useVfsOrchestratorInstance();

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

  const vfsShareApi = useMemo(
    () => ({
      getShares: api.vfs.getShares,
      createShare: api.vfs.createShare,
      updateShare: api.vfs.updateShare,
      deleteShare: async (shareId: string, itemId?: string) => {
        const result = await api.vfs.deleteShare(shareId);
        if (result.deleted && itemId) {
          if (!keyManager) {
            throw new Error('VFS key manager is not initialized');
          }
          await rotateItemKeyEpochAndPersist({
            itemId,
            reason: 'unshare',
            keyManager,
            apiClient: {
              rekeyItem: api.vfs.rekeyItem
            }
          });
        }
        return result;
      },
      createOrgShare: api.vfs.createOrgShare,
      deleteOrgShare: async (shareId: string, itemId?: string) => {
        const result = await api.vfs.deleteOrgShare(shareId);
        if (result.deleted && itemId) {
          if (!keyManager) {
            throw new Error('VFS key manager is not initialized');
          }
          await rotateItemKeyEpochAndPersist({
            itemId,
            reason: 'unshare',
            keyManager,
            apiClient: {
              rekeyItem: api.vfs.rekeyItem
            }
          });
        }
        return result;
      },
      searchTargets: api.vfs.searchShareTargets
    }),
    [keyManager]
  );

  const syncRemoteState = useCallback(async () => {
    if (!orchestrator) {
      return;
    }

    await orchestrator.syncCrdt();
    await hydrateLocalReadModelFromRemoteFeeds();
  }, [orchestrator]);

  return (
    <VfsExplorerProvider
      databaseState={databaseState}
      getDatabase={getDatabase}
      ui={vfsExplorerUIComponents}
      vfsKeys={vfsKeys}
      auth={auth}
      featureFlags={featureFlags}
      vfsApi={vfsApi}
      vfsShareApi={vfsShareApi}
      syncRemoteState={syncRemoteState}
      loginFallback={<InlineLogin description="shared items" />}
    >
      {children}
    </VfsExplorerProvider>
  );
}
