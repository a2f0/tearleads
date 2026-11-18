import type { OrganizationReadModelDeltaResponse } from "@tearleads/validators/response";
import type {
  OrganizationContainerGrants,
  OrganizationDirectoryAndGroups,
  OrganizationGroupContainers,
  OrganizationGroupMembers,
  OrganizationGroupPolicyHistory,
  OrganizationPolicyHistory,
  OrganizationUserDetail,
} from "../../workflows/organizations";

export interface OrganizationReadModelCoordinator {
  loadLocal(
    organizationId?: string | undefined,
  ): Promise<OrganizationDirectoryAndGroups | null>;
  loadLocalGroupMembers(
    groupId: string,
    organizationId?: string | undefined,
  ): Promise<OrganizationGroupMembers | null>;
  loadGroupPolicyHistory(
    groupId: string,
    organizationId?: string | undefined,
    beforeVersion?: number | undefined,
  ): Promise<OrganizationGroupPolicyHistory | null>;
  loadOrganizationPolicyHistory(
    organizationId?: string | undefined,
    beforeVersion?: number | undefined,
  ): Promise<OrganizationPolicyHistory | null>;
  loadLocalGrants(
    organizationId?: string | undefined,
  ): Promise<OrganizationContainerGrants | null>;
  loadLocalGroupContainers(
    groupId: string,
    organizationId?: string | undefined,
  ): Promise<OrganizationGroupContainers | null>;
  loadLocalUserDetail(
    userId: string,
    organizationId?: string | undefined,
  ): Promise<OrganizationUserDetail | null>;
  /**
   * Resolves `undefined` when the runtime declines without I/O (offline,
   * database not ready, organization mismatch) or when the feed failed,
   * even with locally retained data — passes that must not count as caught
   * up; `null` when the reconcile completed but produced nothing presentable
   * — including an authoritative denial that purged the projection, which
   * consumers must repaint.
   */
  reconcile(
    organizationId?: string | undefined,
  ): Promise<OrganizationDirectoryAndGroups | null | undefined>;
  reconcileAfterMutation(
    organizationId?: string | undefined,
  ): Promise<OrganizationDirectoryAndGroups | null | undefined>;
  /** Apply this device's own mutation's committed delta; `undefined` if not. */
  applyCommittedReadModel(
    organizationId: string,
    delta: OrganizationReadModelDeltaResponse | undefined,
  ): Promise<OrganizationDirectoryAndGroups | null | undefined>;
  /** An own mutation's post-commit read: its delta, else the feed. */
  reconcileAfterOwnMutation(
    organizationId: string,
    delta: OrganizationReadModelDeltaResponse | undefined,
  ): Promise<OrganizationDirectoryAndGroups | null | undefined>;
  /**
   * The presented applied cursor for a realtime hint naming `hintPosition`:
   * at once when it already covers the hint, else once this scope's own
   * mutations that could be that commit and its reconcile in flight settle.
   */
  loadAppliedCursor(
    hintPosition: bigint,
    organizationId?: string | undefined,
  ): Promise<string | null>;
}
