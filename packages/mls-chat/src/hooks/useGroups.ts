/**
 * Hook for managing MLS groups.
 * Handles listing, creating, and managing group membership.
 */

import type { MlsGroup } from '@tearleads/shared';
import { MLS_CIPHERSUITES } from '@tearleads/shared';
import { useCallback, useEffect, useState } from 'react';

import { useMlsChatApi } from '../context/index.js';
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
  const { apiBaseUrl, getAuthHeader } = useMlsChatApi();

  const [groups, setGroups] = useState<ActiveGroup[]>([]);
  const [isLoading, setIsLoading] = useState(false);
  const [error, setError] = useState<Error | null>(null);

  const fetchGroups = useCallback(async () => {
    setIsLoading(true);
    setError(null);

    try {
      const headers: HeadersInit = { 'Content-Type': 'application/json' };
      const authValue = getAuthHeader?.();
      if (authValue) {
        headers['Authorization'] = authValue;
      }

      const response = await fetch(`${apiBaseUrl}/mls/groups`, {
        headers
      });

      if (!response.ok) {
        throw new Error('Failed to fetch groups');
      }

      const data = (await response.json()) as { groups: MlsGroup[] };

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
                apiBaseUrl,
                getAuthHeader
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
  }, [apiBaseUrl, getAuthHeader, client]);

  const createGroup = useCallback(
    async (name: string, description?: string): Promise<MlsGroup> => {
      if (!client) {
        throw new Error('MLS client not initialized');
      }

      const headers: HeadersInit = { 'Content-Type': 'application/json' };
      const authValue = getAuthHeader?.();
      if (authValue) {
        headers['Authorization'] = authValue;
      }

      // Create group on server first to get the group ID
      const groupIdMls = client.generateGroupIdMls();
      const body: {
        name: string;
        description?: string;
        groupIdMls: string;
        cipherSuite: number;
      } = {
        name,
        groupIdMls,
        cipherSuite: MLS_CIPHERSUITES.X25519_CHACHA20_SHA256_ED25519
      };
      if (description) {
        body.description = description;
      }

      const response = await fetch(`${apiBaseUrl}/mls/groups`, {
        method: 'POST',
        headers,
        body: JSON.stringify(body)
      });

      if (!response.ok) {
        throw new Error('Failed to create group');
      }

      const data = (await response.json()) as { group: MlsGroup };

      // Initialize MLS group state locally
      await client.createGroup(data.group.id);
      try {
        await uploadGroupStateSnapshot({
          groupId: data.group.id,
          client,
          apiBaseUrl,
          getAuthHeader
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
    [client, apiBaseUrl, getAuthHeader]
  );

  const leaveGroup = useCallback(
    async (groupId: string) => {
      const headers: HeadersInit = { 'Content-Type': 'application/json' };
      const authValue = getAuthHeader?.();
      if (authValue) {
        headers['Authorization'] = authValue;
      }

      const response = await fetch(`${apiBaseUrl}/mls/groups/${groupId}`, {
        method: 'DELETE',
        headers
      });

      if (!response.ok) {
        throw new Error('Failed to leave group');
      }

      // Clean up local state
      if (client) {
        await client.leaveGroup(groupId);
      }

      setGroups((prev) => prev.filter((g) => g.id !== groupId));
    },
    [apiBaseUrl, getAuthHeader, client]
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
