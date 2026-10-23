import type { DatabaseSession } from "@tearleads/api-shared/postgres";
import {
  organizations,
  type RootAuditAction,
  rootAuditEvents,
  users,
} from "@tearleads/api-shared/schema";
import type { RootAuditEventResponse } from "@tearleads/validators/response";
import { and, desc, eq, or, type SQL, sql } from "drizzle-orm";

export interface RootAuditEventInput {
  readonly action: RootAuditAction;
  readonly actorUserId: string;
  readonly filter: string | null;
  readonly sourceIpAddress: string | null;
  readonly targetOrganizationId?: string | undefined;
  readonly targetUserId?: string | undefined;
}

export async function insertRootAuditEvent(
  executor: DatabaseSession,
  input: RootAuditEventInput,
): Promise<void> {
  await executor.insert(rootAuditEvents).values({
    action: input.action,
    actorUserId: input.actorUserId,
    filter: input.filter,
    sourceIpAddress: input.sourceIpAddress,
    targetOrganizationId: input.targetOrganizationId ?? null,
    targetUserId: input.targetUserId ?? null,
  });
}

/**
 * The audit columns an audit-trail subject ID fills: an identity's, an
 * organization's, or neither when it names no one. Reads only IDs.
 */
export async function findRootAuditSubject(
  executor: DatabaseSession,
  subjectId: string,
): Promise<Pick<RootAuditEventInput, "targetOrganizationId" | "targetUserId">> {
  const [user] = await executor
    .select({ id: users.id })
    .from(users)
    .where(eq(users.id, subjectId))
    .limit(1);
  if (user) {
    return { targetUserId: user.id };
  }
  const [organization] = await executor
    .select({ id: organizations.id })
    .from(organizations)
    .where(eq(organizations.id, subjectId))
    .limit(1);
  return organization ? { targetOrganizationId: organization.id } : {};
}

interface ListRootAuditEventsInput {
  /** Return events recorded strictly before this one, newest first. */
  readonly afterEventId?: string | undefined;
  readonly limit: number;
  readonly subjectId?: string | undefined;
}

interface ListRootAuditEventsResult {
  readonly events: RootAuditEventResponse[];
  /** The last returned event id when more events remain, else null. */
  readonly nextAfterEventId: string | null;
}

// Keyset pagination on (occurred_at desc, id desc), reading the cursor row's
// timestamp inside the query so the comparison keeps native precision.
function afterEventCondition(afterEventId: string): SQL {
  const cursorOccurredAt = sql`(select ${rootAuditEvents.occurredAt} from ${rootAuditEvents} where ${rootAuditEvents.id} = ${afterEventId})`;
  return sql`(${rootAuditEvents.occurredAt} < ${cursorOccurredAt} or (${rootAuditEvents.occurredAt} = ${cursorOccurredAt} and ${rootAuditEvents.id} < ${afterEventId}))`;
}

export async function listRootAuditEvents(
  executor: DatabaseSession,
  input: ListRootAuditEventsInput,
): Promise<ListRootAuditEventsResult> {
  const conditions: SQL[] = [];
  if (input.subjectId !== undefined) {
    const subject = or(
      eq(rootAuditEvents.actorUserId, input.subjectId),
      eq(rootAuditEvents.targetUserId, input.subjectId),
      eq(rootAuditEvents.targetOrganizationId, input.subjectId),
    );
    if (subject) {
      conditions.push(subject);
    }
  }
  if (input.afterEventId !== undefined) {
    conditions.push(afterEventCondition(input.afterEventId));
  }

  const rows = await executor
    .select({
      action: rootAuditEvents.action,
      actorSigningKeyFingerprint: users.fingerprint,
      actorUserId: rootAuditEvents.actorUserId,
      filter: rootAuditEvents.filter,
      id: rootAuditEvents.id,
      occurredAt: rootAuditEvents.occurredAt,
      sourceIpAddress: rootAuditEvents.sourceIpAddress,
      targetOrganizationId: rootAuditEvents.targetOrganizationId,
      targetUserId: rootAuditEvents.targetUserId,
    })
    .from(rootAuditEvents)
    .leftJoin(users, eq(users.id, rootAuditEvents.actorUserId))
    .where(conditions.length === 0 ? undefined : and(...conditions))
    .orderBy(desc(rootAuditEvents.occurredAt), desc(rootAuditEvents.id))
    .limit(input.limit + 1);

  const page = rows.slice(0, input.limit);
  const last = page.at(-1);
  return {
    events: page.map((row) => ({
      ...row,
      occurredAt: row.occurredAt.toISOString(),
    })),
    nextAfterEventId: rows.length > input.limit && last ? last.id : null,
  };
}
