/**
 * Hook for managing MLS groups.
 * Handles listing, creating, and managing group membership.
 */

import type { CreateMlsGroupRequest, MlsGroup } from '@tearleads/shared';
import { MLS_CIPHERSUITES } from '@tearleads/shared';
import { useCallback, useEffect, useState } from 'react';

import { useMlsRoutes } from '../context/index.js';
import type { ActiveGroup, MlsClient } from '../lib/index.js';
import {
  recoverMissingGroupState,
  uploadGroupStateSnapshot
} from './groupStateSync.js';

interface UseGroupsResult {
  groups: ActiveGroup[];
  isLoading: boolean;
  error: Error | null;
  createGroup: (name: string, description?: string) => Promise<MlsGroup>;
  leaveGroup: (groupId: string) => Promise<void>;
  refresh: () => Promise<void>;
}

export function useGroups(client: MlsClient | null): UseGroupsResult {
  const mlsRoutes = useMlsRoutes();

  const [groups, setGroups] = useState<ActiveGroup[]>([]);
  const [isLoading, setIsLoading] = useState(false);
  const [error, setError] = useState<Error | null>(null);

  const fetchGroups = useCallback(async () => {
    setIsLoading(true);
    setError(null);

    try {
      const data = await mlsRoutes.listGroups();

      if (client) {
        await Promise.all(
          data.groups.map(async (group) => {
            if (client.hasGroup(group.id)) {
              return;
            }
            try {
              await recoverMissingGroupState({
                groupId: group.id,
                client,
                mlsRoutes
              });
            } catch (recoverError) {
              console.warn(
                `Failed to recover MLS state for group ${group.id}:`,
                recoverError
              );
            }
          })
        );
      }

      // Map server groups to active groups with local decryption capability
      const activeGroups: ActiveGroup[] = data.groups.map((group) => ({
        id: group.id,
        name: group.name,
        canDecrypt: client?.hasGroup(group.id) ?? false,
        memberCount: 0, // Will be populated by separate member fetch
        lastMessageAt: group.lastMessageAt
          ? new Date(group.lastMessageAt)
          : undefined,
        unreadCount: 0
      }));

      setGroups(activeGroups);
    } catch (err) {
      setError(
        err instanceof Error ? err : new Error('Failed to fetch groups')
      );
    } finally {
      setIsLoading(false);
    }
  }, [mlsRoutes, client]);

  const createGroup = useCallback(
    async (name: string, description?: string): Promise<MlsGroup> => {
      if (!client) {
        throw new Error('MLS client not initialized');
      }

      // Create group on server first to get the group ID
      const groupIdMls = client.generateGroupIdMls();

      const createRequest: CreateMlsGroupRequest = {
        name,
        groupIdMls,
        cipherSuite: MLS_CIPHERSUITES.X25519_CHACHA20_SHA256_ED25519
      };
      if (description !== undefined) {
        createRequest.description = description;
      }
      const data = await mlsRoutes.createGroup(createRequest);

      // Initialize MLS group state locally
      await client.createGroup(data.group.id);
      try {
        await uploadGroupStateSnapshot({
          groupId: data.group.id,
          client,
          mlsRoutes
        });
      } catch (uploadError) {
        console.warn(
          `Failed to upload MLS state for group ${data.group.id}:`,
          uploadError
        );
      }

      // Optimistically add the new group to state so it appears immediately
      setGroups((prev) => [
        ...prev,
        {
          id: data.group.id,
          name,
          canDecrypt: true,
          memberCount: 1,
          lastMessageAt: undefined,
          unreadCount: 0
        }
      ]);

      return data.group;
    },
    [client, mlsRoutes]
  );

  const leaveGroup = useCallback(
    async (groupId: string) => {
      await mlsRoutes.leaveGroup(groupId);

      // Clean up local state
      if (client) {
        await client.leaveGroup(groupId);
      }

      setGroups((prev) => prev.filter((g) => g.id !== groupId));
    },
    [mlsRoutes, client]
  );

  useEffect(() => {
    if (client) {
      fetchGroups();
    }
  }, [client, fetchGroups]);

  return {
    groups,
    isLoading,
    error,
    createGroup,
    leaveGroup,
    refresh: fetchGroups
  };
}
