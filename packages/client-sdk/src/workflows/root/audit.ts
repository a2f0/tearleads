import type { RequestResult } from "@tearleads/api-client";
import type { RootAuditEventsQuery } from "@tearleads/validators/operation";
import type {
  RootAuditAction,
  RootAuditEventResponse,
  RootAuditEventsResponse,
} from "@tearleads/validators/response";
import { type RootRequestOutcome, toOutcome } from "./identities";

/**
 * One recorded operator action (wire shape); a null actor is the API CLI. The
 * action is an operation id, which may be one this SDK predates.
 */
export type RootAuditEvent = RootAuditEventResponse & {
  readonly action: RootAuditAction | (string & {});
};

/** A page of audit events, newest first, plus the next page's cursor. */
export type RootAuditEventsPage = RootAuditEventsResponse & {
  readonly events: RootAuditEvent[];
};

/** Paging and the optional identity or organization the events involve. */
export type RootAuditEventsQueryInput = RootAuditEventsQuery;

export interface RootAuditApi {
  listRootAuditEventsResult(
    query?: RootAuditEventsQuery,
  ): Promise<RequestResult<RootAuditEventsResponse>>;
}

export async function listRootAuditEvents(
  api: RootAuditApi,
  query: RootAuditEventsQueryInput = {},
): Promise<RootRequestOutcome<RootAuditEventsPage>> {
  return toOutcome(await api.listRootAuditEventsResult(query));
}
