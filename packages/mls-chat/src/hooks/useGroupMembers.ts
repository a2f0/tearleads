/**
 * Hook for managing group members.
 * Handles adding and removing members from MLS groups.
 */

import type { MlsGroupMember, MlsKeyPackage } from '@tearleads/shared';
import { useCallback, useEffect, useState } from 'react';

import { useMlsChatApi } from '../context/index.js';
import type { MlsClient } from '../lib/mls.js';
import { uploadGroupStateSnapshot } from './groupStateSync.js';

interface UseGroupMembersResult {
  members: MlsGroupMember[];
  isLoading: boolean;
  error: Error | null;
  addMember: (userId: string) => Promise<void>;
  removeMember: (userId: string) => Promise<void>;
  refresh: () => Promise<void>;
}

export function useGroupMembers(
  groupId: string | null,
  client: MlsClient | null
): UseGroupMembersResult {
  const { apiBaseUrl, getAuthHeader } = useMlsChatApi();

  const [members, setMembers] = useState<MlsGroupMember[]>([]);
  const [isLoading, setIsLoading] = useState(false);
  const [error, setError] = useState<Error | null>(null);

  const fetchMembers = useCallback(async () => {
    if (!groupId) return;

    setIsLoading(true);
    setError(null);

    try {
      const headers: HeadersInit = { 'Content-Type': 'application/json' };
      const authValue = getAuthHeader?.();
      if (authValue) {
        headers['Authorization'] = authValue;
      }

      const response = await fetch(
        `${apiBaseUrl}/mls/groups/${groupId}/members`,
        {
          headers
        }
      );

      if (!response.ok) {
        throw new Error('Failed to fetch members');
      }

      const data = (await response.json()) as { members: MlsGroupMember[] };
      setMembers(data.members);
    } catch (err) {
      setError(
        err instanceof Error ? err : new Error('Failed to fetch members')
      );
    } finally {
      setIsLoading(false);
    }
  }, [groupId, apiBaseUrl, getAuthHeader]);

  const addMember = useCallback(
    async (userId: string) => {
      if (!groupId || !client) {
        throw new Error('Group or client not initialized');
      }

      const headers: HeadersInit = { 'Content-Type': 'application/json' };
      const authValue = getAuthHeader?.();
      if (authValue) {
        headers['Authorization'] = authValue;
      }

      // Fetch a key package for the user to add
      const kpResponse = await fetch(
        `${apiBaseUrl}/mls/key-packages/${userId}`,
        {
          headers
        }
      );

      if (!kpResponse.ok) {
        throw new Error('User has no available key packages');
      }

      const kpData = (await kpResponse.json()) as {
        keyPackages: MlsKeyPackage[];
      };
      const keyPackage = kpData.keyPackages[0];
      if (!keyPackage) {
        throw new Error('User has no available key packages');
      }
      const keyPackageBytes = Uint8Array.from(
        atob(keyPackage.keyPackageData),
        (c) => c.charCodeAt(0)
      );

      // Generate MLS commit and welcome
      const { commit, welcome, newEpoch } = await client.addMember(
        groupId,
        keyPackageBytes
      );

      if (!welcome || newEpoch === undefined) {
        throw new Error('Failed to generate welcome message');
      }

      // Send to server
      const response = await fetch(
        `${apiBaseUrl}/mls/groups/${groupId}/members`,
        {
          method: 'POST',
          headers,
          body: JSON.stringify({
            userId,
            keyPackageRef: keyPackage.keyPackageRef,
            commit: btoa(String.fromCharCode.apply(null, Array.from(commit))),
            welcome: btoa(String.fromCharCode.apply(null, Array.from(welcome))),
            newEpoch
          })
        }
      );

      if (!response.ok) {
        throw new Error('Failed to add member');
      }

      try {
        await uploadGroupStateSnapshot({
          groupId,
          client,
          apiBaseUrl,
          getAuthHeader
        });
      } catch (uploadError) {
        console.warn(
          `Failed to upload MLS state for group ${groupId}:`,
          uploadError
        );
      }

      await fetchMembers();
    },
    [groupId, client, apiBaseUrl, getAuthHeader, fetchMembers]
  );

  const removeMember = useCallback(
    async (userId: string) => {
      if (!groupId || !client) {
        throw new Error('Group or client not initialized');
      }

      // Find the member's leaf index
      const member = members.find((m) => m.userId === userId);
      if (!member || member.leafIndex === null) {
        throw new Error('Member not found or leaf index unknown');
      }

      const headers: HeadersInit = { 'Content-Type': 'application/json' };
      const authValue = getAuthHeader?.();
      if (authValue) {
        headers['Authorization'] = authValue;
      }

      // Generate MLS remove commit
      const { commit, newEpoch } = await client.removeMember(
        groupId,
        member.leafIndex
      );
      if (newEpoch === undefined) {
        throw new Error('Failed to generate remove commit');
      }

      // Send to server
      const response = await fetch(
        `${apiBaseUrl}/mls/groups/${groupId}/members/${userId}`,
        {
          method: 'DELETE',
          headers,
          body: JSON.stringify({
            commit: btoa(String.fromCharCode.apply(null, Array.from(commit))),
            newEpoch
          })
        }
      );

      if (!response.ok) {
        throw new Error('Failed to remove member');
      }

      try {
        await uploadGroupStateSnapshot({
          groupId,
          client,
          apiBaseUrl,
          getAuthHeader
        });
      } catch (uploadError) {
        console.warn(
          `Failed to upload MLS state for group ${groupId}:`,
          uploadError
        );
      }

      await fetchMembers();
    },
    [groupId, client, members, apiBaseUrl, getAuthHeader, fetchMembers]
  );

  useEffect(() => {
    if (groupId && client) {
      fetchMembers();
    }
  }, [groupId, client, fetchMembers]);

  return {
    members,
    isLoading,
    error,
    addMember,
    removeMember,
    refresh: fetchMembers
  };
}
