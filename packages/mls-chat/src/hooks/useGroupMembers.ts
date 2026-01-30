/**
 * Hook for managing group members.
 * Handles adding and removing members from MLS groups.
 */

import type { MlsGroupMember, MlsKeyPackage } from '@rapid/shared';
import { useCallback, useEffect, useState } from 'react';

import { useMlsChatApi } from '../context/index.js';
import type { MlsClient } from '../lib/mls.js';

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
        `${apiBaseUrl}/v1/mls/groups/${groupId}/members`,
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
        `${apiBaseUrl}/v1/mls/key-packages/${userId}`,
        {
          headers
        }
      );

      if (!kpResponse.ok) {
        throw new Error('User has no available key packages');
      }

      const kpData = (await kpResponse.json()) as { keyPackage: MlsKeyPackage };
      const keyPackageBytes = Uint8Array.from(
        atob(kpData.keyPackage.keyPackageData),
        (c) => c.charCodeAt(0)
      );

      // Generate MLS commit and welcome
      const { commit, welcome } = await client.addMember(
        groupId,
        keyPackageBytes
      );

      if (!welcome) {
        throw new Error('Failed to generate welcome message');
      }

      // Send to server
      const response = await fetch(
        `${apiBaseUrl}/v1/mls/groups/${groupId}/members`,
        {
          method: 'POST',
          headers,
          body: JSON.stringify({
            userId,
            keyPackageId: kpData.keyPackage.id,
            commit: btoa(String.fromCharCode(...commit)),
            welcome: btoa(String.fromCharCode(...welcome))
          })
        }
      );

      if (!response.ok) {
        throw new Error('Failed to add member');
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
      const { commit } = await client.removeMember(groupId, member.leafIndex);

      // Send to server
      const response = await fetch(
        `${apiBaseUrl}/v1/mls/groups/${groupId}/members/${userId}`,
        {
          method: 'DELETE',
          headers,
          body: JSON.stringify({
            commit: btoa(String.fromCharCode(...commit))
          })
        }
      );

      if (!response.ok) {
        throw new Error('Failed to remove member');
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
