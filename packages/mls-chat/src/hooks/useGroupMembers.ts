/**
 * Hook for managing group members.
 * Handles adding and removing members from MLS groups.
 */

import type { MlsGroupMember } from '@tearleads/shared';
import { useCallback, useEffect, useState } from 'react';

import { useMlsRoutes } from '../context/index.js';
import type { MlsClient } from '../lib/index.js';
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
  const mlsRoutes = useMlsRoutes();

  const [members, setMembers] = useState<MlsGroupMember[]>([]);
  const [isLoading, setIsLoading] = useState(false);
  const [error, setError] = useState<Error | null>(null);

  const fetchMembers = useCallback(async () => {
    if (!groupId) return;

    setIsLoading(true);
    setError(null);

    try {
      const data = await mlsRoutes.getGroupMembers(groupId);
      setMembers(data.members);
    } catch (err) {
      setError(
        err instanceof Error ? err : new Error('Failed to fetch members')
      );
    } finally {
      setIsLoading(false);
    }
  }, [groupId, mlsRoutes]);

  const addMember = useCallback(
    async (userId: string) => {
      if (!groupId || !client) {
        throw new Error('Group or client not initialized');
      }

      // Fetch a key package for the user to add
      const kpData = await mlsRoutes.getUserKeyPackages(userId);
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
      await mlsRoutes.addGroupMember(groupId, {
        userId,
        keyPackageRef: keyPackage.keyPackageRef,
        commit: btoa(String.fromCharCode.apply(null, Array.from(commit))),
        welcome: btoa(String.fromCharCode.apply(null, Array.from(welcome))),
        newEpoch
      });

      try {
        await uploadGroupStateSnapshot({
          groupId,
          client,
          mlsRoutes
        });
      } catch (uploadError) {
        console.warn(
          `Failed to upload MLS state for group ${groupId}:`,
          uploadError
        );
      }

      await fetchMembers();
    },
    [groupId, client, mlsRoutes, fetchMembers]
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

      // Generate MLS remove commit
      const { commit, newEpoch } = await client.removeMember(
        groupId,
        member.leafIndex
      );
      if (newEpoch === undefined) {
        throw new Error('Failed to generate remove commit');
      }

      // Send to server
      await mlsRoutes.removeGroupMember(groupId, userId, {
        commit: btoa(String.fromCharCode.apply(null, Array.from(commit))),
        newEpoch
      });

      try {
        await uploadGroupStateSnapshot({
          groupId,
          client,
          mlsRoutes
        });
      } catch (uploadError) {
        console.warn(
          `Failed to upload MLS state for group ${groupId}:`,
          uploadError
        );
      }

      await fetchMembers();
    },
    [groupId, client, members, mlsRoutes, fetchMembers]
  );

  useEffect(() => {
    if (groupId && client) {
      fetchMembers();
    }
  }, [groupId, client, fetchMembers]);

  useEffect(() => {
    if (!groupId) {
      return;
    }

    const registryKey = '__mlsMembershipHandler';
    const existingRegistry = Reflect.get(globalThis, registryKey);
    const handlerRegistry =
      existingRegistry instanceof Map
        ? existingRegistry
        : new Map<string, Set<() => void>>();

    if (!(existingRegistry instanceof Map)) {
      Reflect.set(globalThis, registryKey, handlerRegistry);
    }

    const refreshHandler = () => {
      void fetchMembers();
    };

    const existingHandlers = handlerRegistry.get(groupId);
    const groupHandlers =
      existingHandlers instanceof Set
        ? existingHandlers
        : new Set<() => void>();

    if (!(existingHandlers instanceof Set)) {
      handlerRegistry.set(groupId, groupHandlers);
    }

    groupHandlers.add(refreshHandler);

    return () => {
      groupHandlers.delete(refreshHandler);
      if (groupHandlers.size === 0) {
        handlerRegistry.delete(groupId);
      }
      if (handlerRegistry.size === 0) {
        Reflect.deleteProperty(globalThis, registryKey);
      }
    };
  }, [groupId, fetchMembers]);

  return {
    members,
    isLoading,
    error,
    addMember,
    removeMember,
    refresh: fetchMembers
  };
}
