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
 * How removing an organization's content ended. `retry`: unsynced writes or
 * the active workspace blocked it until the sync lanes settle.
 * `next-session`: a document of the organization is open this session, so the
 * next session's membership refresh removes it.
 */
type OrganizationContentRemovalOutcome = "removed" | "retry" | "next-session";

/**
 * What applying a pause needs from the device's content. Wired by the
 * composition root to the container tree and the document sync lanes.
 */
export interface OrganizationContentHost {
  /**
   * Removes an organization's content, keeping its metadata root. Refuses
   * while any of its writes is unsynced or any of its documents is open.
   */
  forgetOrganizationContent(
    organizationId: string,
  ): Promise<OrganizationContentRemovalOutcome>;
  /** Whether any local write for the organization has not uploaded yet. */
  hasUnsyncedOrganizationWrites(organizationId: string): Promise<boolean>;
  /** Asks every sync lane to upload now and waits briefly for them to idle. */
  flushWrites(): Promise<void>;
  /** Re-lists the whole tree so resumed organizations download again. */
  refetchContent(): Promise<void>;
  /**
   * Runs `retry` each time the scope's sync lanes go idle until it resolves
   * true. A later call replaces the pending retry.
   */
  retryWhenWritesSettle(retry: () => Promise<boolean>): void;
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
  | { readonly status: "unsynced-writes" }
  | {
      readonly status: "failed";
      readonly httpStatus: number | null;
      readonly message: string;
    };

/** Whether no paused organization is left that a later retry could remove. */
async function forgetEveryPausedOrganization(input: {
  readonly host: OrganizationContentHost;
  readonly pauses: OrganizationSyncPauses;
}): Promise<boolean> {
  let settled = true;
  for (const organizationId of [...input.pauses.pausedOrganizationIds()]) {
    if (
      (await input.host.forgetOrganizationContent(organizationId)) === "retry"
    ) {
      settled = false;
    }
  }
  return settled;
}

/**
 * Removes the content of every paused organization that has nothing left to
 * upload and none of its documents open. An organization with pending writes
 * keeps syncing those out and is retried once the sync lanes go idle, so
 * pausing never discards unsynced work and a removal does not wait for the
 * next membership read. One with an open document keeps syncing until the
 * next session's membership read removes it.
 */
export async function forgetPausedOrganizationContent(input: {
  readonly host: OrganizationContentHost;
  readonly pauses: OrganizationSyncPauses;
}): Promise<void> {
  if (await forgetEveryPausedOrganization(input)) return;
  input.host.retryWhenWritesSettle(() =>
    input.pauses.runExclusive(() => forgetEveryPausedOrganization(input)),
  );
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
  const pauses = getOrCreateOrganizationSyncPauses(input.domainScope);
  return pauses.runExclusive(() => applyMembershipList(input, pauses));
}

async function applyMembershipList(
  input: OrganizationMembershipInput,
  pauses: OrganizationSyncPauses,
): Promise<OrganizationMembership[] | null> {
  const response = await input.apiClient.listOrganizationMemberships();
  if (!response || !input.isCurrent()) return null;
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
  const scopeEnded = {
    httpStatus: null,
    message: "The session changed before sync could be changed.",
    status: "failed",
  } as const;
  // Queued behind other membership work, the session may have switched
  // identity; the shared API client would then act for the new identity.
  if (!input.isCurrent()) return scopeEnded;
  if (paused) {
    await host.flushWrites();
    if (await host.hasUnsyncedOrganizationWrites(organizationId)) {
      return { status: "unsynced-writes" };
    }
  }
  if (!input.isCurrent()) return scopeEnded;
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
  await pauses.replace(input.execSql, next);
  if (paused) await forgetPausedOrganizationContent({ host, pauses });
  else await host.refetchContent();
  return { membership: result.data, status: "updated" };
}
