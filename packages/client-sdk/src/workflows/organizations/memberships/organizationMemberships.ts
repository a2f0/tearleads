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
} from "../../sync";

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
 * What applying a pause needs from the device's content. Wired by the
 * composition root to the container tree and the document sync lanes.
 */
export interface OrganizationContentHost {
  /** Removes an organization's content, keeping its metadata root. */
  forgetOrganizationContent(organizationId: string): Promise<boolean>;
  /** Whether any local write for the organization has not uploaded yet. */
  hasUnsyncedOrganizationWrites(organizationId: string): Promise<boolean>;
  /** Asks every sync lane to upload now and waits briefly for them to idle. */
  flushWrites(): Promise<void>;
  /** Re-lists the whole tree so resumed organizations download again. */
  refetchContent(): Promise<void>;
}

interface OrganizationMembershipInput {
  readonly apiClient: OrganizationMembershipApi;
  readonly domainScope: DomainScope;
  readonly execSql: ExecSql;
  readonly host: OrganizationContentHost;
}

export type OrganizationSyncPauseResult =
  | { readonly status: "updated"; readonly membership: OrganizationMembership }
  | { readonly status: "unsynced-writes" }
  | {
      readonly status: "failed";
      readonly httpStatus: number | null;
      readonly message: string;
    };

/**
 * Removes the content of every paused organization that has nothing left to
 * upload. An organization with pending writes keeps syncing those out and is
 * retried on the next pass, so pausing never discards unsynced work.
 */
export async function forgetPausedOrganizationContent(input: {
  readonly host: OrganizationContentHost;
  readonly pauses: OrganizationSyncPauses;
}): Promise<void> {
  for (const organizationId of [...input.pauses.pausedOrganizationIds()]) {
    if (await input.host.hasUnsyncedOrganizationWrites(organizationId)) {
      continue;
    }
    await input.host.forgetOrganizationContent(organizationId);
  }
}

/**
 * Reads the user's memberships and applies their pause choices, including
 * ones made on another device: paused organizations leave this device, and
 * resumed ones download again. Returns null when the list is unavailable, in
 * which case the persisted pauses stay in force.
 */
export async function refreshOrganizationMemberships(
  input: OrganizationMembershipInput,
): Promise<OrganizationMembership[] | null> {
  const response = await input.apiClient.listOrganizationMemberships();
  if (!response) return null;
  const pauses = getOrCreateOrganizationSyncPauses(input.domainScope);
  const change = await pauses.replace(
    input.execSql,
    response.memberships.flatMap((membership) =>
      membership.syncPaused ? [membership.organizationId] : [],
    ),
  );
  await forgetPausedOrganizationContent({ host: input.host, pauses });
  if (change.resumed.length > 0) await input.host.refetchContent();
  return [...response.memberships];
}

/**
 * Pauses or resumes one organization for every device of this user. Pausing
 * first uploads this device's pending writes and is refused while any remain,
 * so the local copy it removes holds nothing the server lacks.
 */
export async function setOrganizationSyncPaused(
  input: OrganizationMembershipInput & {
    readonly organizationId: string;
    readonly paused: boolean;
  },
): Promise<OrganizationSyncPauseResult> {
  const { host, organizationId, paused } = input;
  if (paused) {
    await host.flushWrites();
    if (await host.hasUnsyncedOrganizationWrites(organizationId)) {
      return { status: "unsynced-writes" };
    }
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
  const pauses = getOrCreateOrganizationSyncPauses(input.domainScope);
  await pauses.load(input.execSql);
  const next = new Set(pauses.pausedOrganizationIds());
  if (paused) next.add(organizationId);
  else next.delete(organizationId);
  await pauses.replace(input.execSql, next);
  if (paused) await host.forgetOrganizationContent(organizationId);
  else await host.refetchContent();
  return { membership: result.data, status: "updated" };
}
