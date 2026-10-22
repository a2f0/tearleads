import type { Context, MiddlewareHandler } from "hono";
import { readRequestIpAddress } from "../../middleware/requestIp";
import type { SessionEnv, UserSessionSummary } from "../../middleware/session";
import {
  formatRootAuditFilter,
  recordRootAuditEvent,
} from "../../services/root/audit";
import type { ApiServiceRuntime } from "../../services/runtime";

type RootAuditEventInput = Parameters<typeof recordRootAuditEvent>[1];

export interface RootRouterDeps {
  readonly listUserSessions: (input: {
    currentToken: string;
    userId: string;
  }) => Promise<UserSessionSummary[]>;
  readonly requireAuth: MiddlewareHandler<SessionEnv>;
  /** Runs after `requireAuth`; admits only identities flagged `is_root`. */
  readonly requireRoot: MiddlewareHandler<SessionEnv>;
  readonly runtime: ApiServiceRuntime;
}

/**
 * Records the operator's request before a root handler reads anything. It
 * throws when the row cannot be written, which the handler lets reach the 500
 * handler, so an unrecorded lookup is never served.
 */
export async function auditRootRequest(
  c: Context<SessionEnv>,
  runtime: ApiServiceRuntime,
  event: Pick<
    RootAuditEventInput,
    "action" | "targetOrganizationId" | "targetUserId"
  > & { readonly filters?: Readonly<Record<string, string | undefined>> },
): Promise<void> {
  await recordRootAuditEvent(runtime, {
    action: event.action,
    actorUserId: c.get("session").userId,
    filter: formatRootAuditFilter(event.filters ?? {}),
    sourceIpAddress: readRequestIpAddress(c),
    targetOrganizationId: event.targetOrganizationId,
    targetUserId: event.targetUserId,
  });
}
