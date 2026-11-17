import type { RequestResult } from "@tearleads/api-client";
import type { UpdateOrganizationMembershipRequest } from "@tearleads/validators/request";
import type {
  OrganizationMembershipResponse,
  OrganizationMembershipsResponse,
} from "@tearleads/validators/response";
import type { DomainScope } from "../../../data/shared/domainScope";
import type { ExecSql } from "../../../data/sqlite/sqlSchema";
import {
  getOrCreateOrganizationSyncPauses,
  type OrganizationSyncPauses,
} from "../../sync/coordination";

/** One organization the user belongs to, with their own choices for it. */
export type OrganizationMembership = OrganizationMembershipResponse;

export interface OrganizationMembershipApi {
  listOrganizationMemberships(): Promise<OrganizationMembershipsResponse | null>;
  updateOrganizationMembership(
    organizationId: string,
    input: UpdateOrganizationMembershipRequest,
  ): Promise<RequestResult<OrganizationMembershipResponse>>;
}

/**
 * What applying a pause or a resume needs from the device's sync. Wired by
 * the composition root to the document reconciler and the sync lanes.
 */
export interface OrganizationContentHost {
  /**
   * Re-lists the whole tree and re-drives every sync lane, so a resumed
   * organization fetches what it missed and sends the writes it held.
   */
  resumeSync(): Promise<void>;
}

interface OrganizationMembershipInput {
  readonly apiClient: OrganizationMembershipApi;
  readonly domainScope: DomainScope;
  readonly execSql: ExecSql;
  readonly host: OrganizationContentHost;
  /**
   * Whether the session still uses `domainScope`. A membership list or pause
   * that completes after an identity switch must not touch the new identity's
   * device state.
   */
  readonly isCurrent: () => boolean;
}

export type OrganizationSyncPauseResult =
  | { readonly status: "updated"; readonly membership: OrganizationMembership }
  | {
      readonly status: "failed";
      readonly httpStatus: number | null;
      readonly message: string;
    };

/**
 * The pauses a membership list puts in force on this device. A pause follows
 * the user to every device, except on their personal organization: a device
 * holds that one only when it was paused from this device, because a new
 * device needs it to start. Resuming always applies everywhere.
 */
function pausesInForce(
  memberships: readonly OrganizationMembership[],
  heldHere: ReadonlySet<string>,
): string[] {
  return memberships.flatMap((membership) =>
    membership.syncPaused &&
    (!membership.isPersonalOrganizationOwner ||
      heldHere.has(membership.organizationId))
      ? [membership.organizationId]
      : [],
  );
}

/**
 * Reads the user's memberships and applies their pause choices, including
 * ones made on another device: a paused organization's sync is held here, and
 * a resumed one catches up. Returns null when the list is unavailable, in
 * which case the persisted pauses stay in force.
 */
export async function refreshOrganizationMemberships(
  input: OrganizationMembershipInput,
): Promise<OrganizationMembership[] | null> {
  const pauses = getOrCreateOrganizationSyncPauses(input.domainScope);
  return pauses.runExclusive(() => applyMembershipList(input, pauses));
}

async function applyMembershipList(
  input: OrganizationMembershipInput,
  pauses: OrganizationSyncPauses,
): Promise<OrganizationMembership[] | null> {
  const response = await input.apiClient.listOrganizationMemberships();
  if (!response || !input.isCurrent()) return null;
  await pauses.load(input.execSql);
  const change = await pauses.replace(
    input.execSql,
    pausesInForce(response.memberships, pauses.pausedOrganizationIds()),
  );
  if (change.resumed.length > 0) await input.host.resumeSync();
  return [...response.memberships];
}

/**
 * Pauses or resumes one organization. Pausing holds its sync in both
 * directions and keeps everything on the device: writes made meanwhile stay
 * queued and send on resume, so nothing has to upload first.
 */
export async function setOrganizationSyncPaused(
  input: OrganizationMembershipInput & {
    readonly organizationId: string;
    readonly paused: boolean;
  },
): Promise<OrganizationSyncPauseResult> {
  const pauses = getOrCreateOrganizationSyncPauses(input.domainScope);
  return pauses.runExclusive(() => applySyncPauseChoice(input, pauses));
}

async function applySyncPauseChoice(
  input: OrganizationMembershipInput & {
    readonly organizationId: string;
    readonly paused: boolean;
  },
  pauses: OrganizationSyncPauses,
): Promise<OrganizationSyncPauseResult> {
  const { host, organizationId, paused } = input;
  // Queued behind other membership work, the session may have switched
  // identity; the shared API client would then act for the new identity.
  if (!input.isCurrent()) {
    return {
      httpStatus: null,
      message: "The session changed before sync could be changed.",
      status: "failed",
    };
  }
  const result = await input.apiClient.updateOrganizationMembership(
    organizationId,
    { syncPaused: paused },
  );
  if (!result.ok) {
    return {
      httpStatus: result.status,
      message: result.message,
      status: "failed",
    };
  }
  // The choice is recorded; a scope that ended meanwhile applies it on its
  // next membership read instead.
  if (!input.isCurrent()) return { membership: result.data, status: "updated" };
  await pauses.load(input.execSql);
  const next = new Set(pauses.pausedOrganizationIds());
  if (paused) next.add(organizationId);
  else next.delete(organizationId);
  const change = await pauses.replace(input.execSql, next);
  if (change.resumed.length > 0) await host.resumeSync();
  return { membership: result.data, status: "updated" };
}
