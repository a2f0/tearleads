import { isPlainObject } from "@tearleads/validators/isPlainObject";
import type { RootAuditEventsResponse } from "@tearleads/validators/response";
import { isUuidV4String } from "@tearleads/validators/util";
import { decodeCursor, encodeCursor } from "../../utils/cursor";
import {
  insertRootAuditEvent,
  listRootAuditEvents,
} from "../../workflows/root/auditEvents";
import { createDatabaseWorkflowService } from "../databaseWorkflowService";
import type { ApiServiceRuntime } from "../runtime";

const DEFAULT_ROOT_AUDIT_PAGE_SIZE = 50;
const MAX_ROOT_AUDIT_PAGE_SIZE = 200;

export class RootAuditError extends Error {
  constructor(
    message: string,
    readonly status: 400,
  ) {
    super(message);
  }
}

/**
 * Records one operator action. Callers await it before reading or changing
 * anything, so a failed write refuses the request instead of serving it
 * unrecorded.
 */
export const recordRootAuditEvent =
  createDatabaseWorkflowService(insertRootAuditEvent);

/**
 * The listing filters an operator applied, as a query string with sorted keys.
 * Absent and empty values are dropped; null when nothing remains.
 */
export function formatRootAuditFilter(
  filters: Readonly<Record<string, string | undefined>>,
): string | null {
  const entries = Object.entries(filters)
    .filter((entry): entry is [string, string] => Boolean(entry[1]))
    .sort(([left], [right]) => (left < right ? -1 : left > right ? 1 : 0));
  return entries.length === 0 ? null : new URLSearchParams(entries).toString();
}

function parseRootAuditCursor(
  payload: unknown,
): { readonly afterEventId: string } | undefined {
  if (!isPlainObject(payload)) {
    return undefined;
  }
  const { afterEventId } = payload;
  return typeof afterEventId === "string" && isUuidV4String(afterEventId)
    ? { afterEventId }
    : undefined;
}

export async function listAuditEvents(
  runtime: ApiServiceRuntime,
  input: {
    readonly cursor?: string | undefined;
    readonly limit?: number | undefined;
    readonly subjectId?: string | undefined;
  },
): Promise<RootAuditEventsResponse> {
  const cursor =
    input.cursor === undefined
      ? undefined
      : decodeCursor(
          input.cursor,
          parseRootAuditCursor,
          () => new RootAuditError("Invalid cursor", 400),
        );
  const result = await listRootAuditEvents(runtime.db, {
    afterEventId: cursor?.afterEventId,
    limit: Math.min(
      input.limit ?? DEFAULT_ROOT_AUDIT_PAGE_SIZE,
      MAX_ROOT_AUDIT_PAGE_SIZE,
    ),
    subjectId: input.subjectId,
  });
  return {
    events: result.events,
    nextCursor:
      result.nextAfterEventId === null
        ? null
        : encodeCursor({ afterEventId: result.nextAfterEventId }),
  };
}
