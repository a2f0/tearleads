import type {
  OrganizationContainerGrants,
  OrganizationDirectory,
  OrganizationGroupContainers,
  OrganizationGroupMembers,
  OrganizationGroupPolicyHistory,
  OrganizationGroupSummary,
  OrganizationPolicyHistory,
} from "@tearleads/client-sdk";
import { useMemo, useState } from "react";
import {
  scopeOrganizationDirectory,
  scopeOrganizationList,
} from "../hooks/orgManagerStateScope";

/**
 * The organization read models and request flags the Org Manager loads, with
 * the directory and groups scoped to the active organization and user.
 */
export function useOrgManagerDataState(
  organizationId: string | null,
  userId: string | null,
) {
  const [directory, setDirectory] = useState<OrganizationDirectory | null>(
    null,
  );
  const [groups, setGroups] = useState<ReadonlyArray<OrganizationGroupSummary>>(
    [],
  );
  const [readModelCursor, setReadModelCursor] = useState<string | null>(null);
  const [memberGroupId, setMemberGroupId] = useState<string | null>(null);
  const [members, setMembers] = useState<OrganizationGroupMembers | null>(null);
  const [groupContainers, setGroupContainers] =
    useState<OrganizationGroupContainers | null>(null);
  const [groupPolicyHistory, setGroupPolicyHistory] =
    useState<OrganizationGroupPolicyHistory | null>(null);
  const [organizationPolicyHistory, setOrganizationPolicyHistory] =
    useState<OrganizationPolicyHistory | null>(null);
  const [grants, setGrants] = useState<OrganizationContainerGrants | null>(
    null,
  );
  const [loading, setLoading] = useState(false);
  const [loadingUserDetail, setLoadingUserDetail] = useState(false);
  const [mutating, setMutating] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const activeDirectory = scopeOrganizationDirectory(
    directory,
    organizationId,
    userId,
  );
  const activeGroups = useMemo(
    () => scopeOrganizationList(groups, organizationId),
    [groups, organizationId],
  );
  return {
    activeDirectory,
    activeGroups,
    error,
    grants,
    groupContainers,
    groupPolicyHistory,
    loading,
    loadingUserDetail,
    memberGroupId,
    members,
    mutating,
    organizationPolicyHistory,
    readModelCursor,
    setDirectory,
    setError,
    setGrants,
    setGroupContainers,
    setGroupPolicyHistory,
    setGroups,
    setLoading,
    setLoadingUserDetail,
    setMemberGroupId,
    setMembers,
    setMutating,
    setOrganizationPolicyHistory,
    setReadModelCursor,
  };
}
