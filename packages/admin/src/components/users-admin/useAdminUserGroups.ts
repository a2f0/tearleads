import type { GroupWithMemberCount } from '@tearleads/shared';
import { useCallback, useEffect, useState } from 'react';
import { api } from '@/lib/api';

export function useAdminUserGroups(userId: string | null) {
  const [groups, setGroups] = useState<GroupWithMemberCount[]>([]);
  const [groupMemberships, setGroupMemberships] = useState<
    Record<string, { isMember: boolean; joinedAt: string | undefined }>
  >({});
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [actionError, setActionError] = useState<string | null>(null);
  const [actionId, setActionId] = useState<string | null>(null);

  const fetchGroups = useCallback(async () => {
    if (!userId) return;

    try {
      setLoading(true);
      setError(null);
      const response = await api.admin.groups.list();
      setGroups(response.groups);

      const membershipEntries = await Promise.all(
        response.groups.map(async (group) => {
          try {
            const membersResponse = await api.admin.groups.getMembers(group.id);
            const member = membersResponse.members.find(
              (entry) => entry.userId === userId
            );
            return {
              groupId: group.id,
              membership: {
                isMember: Boolean(member),
                joinedAt: member?.joinedAt
              },
              error: null as Error | null
            };
          } catch (err) {
            return {
              groupId: group.id,
              membership: { isMember: false, joinedAt: undefined },
              error: err instanceof Error ? err : new Error(String(err))
            };
          }
        })
      );

      const memberships: Record<
        string,
        { isMember: boolean; joinedAt: string | undefined }
      > = {};
      for (const entry of membershipEntries) {
        memberships[entry.groupId] = entry.membership;
      }
      setGroupMemberships(memberships);

      if (membershipEntries.some((entry) => entry.error)) {
        setError('Failed to load some group memberships');
      }
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to load groups');
    } finally {
      setLoading(false);
    }
  }, [userId]);

  useEffect(() => {
    void fetchGroups();
  }, [fetchGroups]);

  const addToGroup = useCallback(
    async (groupId: string) => {
      if (!userId) return;

      try {
        setActionId(groupId);
        setActionError(null);
        await api.admin.groups.addMember(groupId, userId);
        setGroupMemberships((prev) => ({
          ...prev,
          [groupId]: { isMember: true, joinedAt: new Date().toISOString() }
        }));
        setGroups((prev) =>
          prev.map((group) =>
            group.id === groupId
              ? { ...group, memberCount: group.memberCount + 1 }
              : group
          )
        );
      } catch (err) {
        if (err instanceof Error && err.message.includes('409')) {
          setActionError('User is already a member of this group');
        } else if (err instanceof Error && err.message.includes('404')) {
          setActionError('Group or user not found');
        } else {
          setActionError(
            err instanceof Error ? err.message : 'Failed to add user to group'
          );
        }
      } finally {
        setActionId(null);
      }
    },
    [userId]
  );

  const removeFromGroup = useCallback(
    async (groupId: string) => {
      if (!userId) return;

      try {
        setActionId(groupId);
        setActionError(null);
        await api.admin.groups.removeMember(groupId, userId);
        setGroupMemberships((prev) => ({
          ...prev,
          [groupId]: { isMember: false, joinedAt: undefined }
        }));
        setGroups((prev) =>
          prev.map((group) =>
            group.id === groupId
              ? { ...group, memberCount: Math.max(0, group.memberCount - 1) }
              : group
          )
        );
      } catch (err) {
        setActionError(
          err instanceof Error
            ? err.message
            : 'Failed to remove user from group'
        );
      } finally {
        setActionId(null);
      }
    },
    [userId]
  );

  return {
    groups,
    groupMemberships,
    loading,
    error,
    actionError,
    actionId,
    fetchGroups,
    addToGroup,
    removeFromGroup,
    setActionError
  };
}
