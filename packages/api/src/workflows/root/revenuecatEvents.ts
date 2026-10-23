import type { DatabaseSession } from "@tearleads/api-shared/postgres";
import { revenuecatWebhookEvents as events } from "@tearleads/api-shared/schema";
import type {
  RootOrganizationRevenuecatEventResponse,
  RootRevenuecatDisposition,
  RootRevenuecatEventResponse,
} from "@tearleads/validators/response";
import { and, desc, eq, isNull, lt, or, type SQL } from "drizzle-orm";

const selection = {
  id: events.id,
  eventId: events.eventId,
  eventType: events.eventType,
  outcome: events.outcome,
  appUserId: events.appUserId,
  organizationId: events.organizationId,
  sourceOrganizationId: events.sourceOrganizationId,
  store: events.store,
  environment: events.environment,
  productId: events.productId,
  periodType: events.periodType,
  transactionId: events.transactionId,
  originalTransactionId: events.originalTransactionId,
  currency: events.currency,
  priceInPurchasedCurrencyMinor: events.priceInPurchasedCurrencyMinor,
  purchasedAt: events.purchasedAt,
  expirationAt: events.expirationAt,
  eventTimestamp: events.eventTimestamp,
  createdAt: events.createdAt,
};

type EventRow = Omit<
  RootRevenuecatEventResponse,
  "createdAt" | "eventTimestamp" | "expirationAt" | "purchasedAt"
> & {
  readonly createdAt: Date;
  readonly eventTimestamp: Date;
  readonly expirationAt: Date | null;
  readonly purchasedAt: Date | null;
};

function toResponse(row: EventRow): RootRevenuecatEventResponse {
  return {
    ...row,
    createdAt: row.createdAt.toISOString(),
    eventTimestamp: row.eventTimestamp.toISOString(),
    expirationAt: row.expirationAt?.toISOString() ?? null,
    purchasedAt: row.purchasedAt?.toISOString() ?? null,
  };
}

interface PageInput {
  /** Return deliveries strictly older than this one, newest first. */
  readonly afterId?: string | undefined;
  readonly limit: number;
}

// Keyset pagination on (event_timestamp desc, id desc). The cursor row's
// timestamp is read inside the query so the comparison keeps native precision.
function afterEvent(
  executor: DatabaseSession,
  afterId: string | undefined,
): SQL | undefined {
  if (afterId === undefined) return undefined;
  const anchor = executor
    .select({ eventTimestamp: events.eventTimestamp })
    .from(events)
    .where(eq(events.id, afterId));
  return or(
    lt(events.eventTimestamp, anchor),
    and(eq(events.eventTimestamp, anchor), lt(events.id, afterId)),
  );
}

async function listPage(
  executor: DatabaseSession,
  where: SQL | undefined,
  input: PageInput,
) {
  const rows = await executor
    .select(selection)
    .from(events)
    .where(and(where, afterEvent(executor, input.afterId)))
    .orderBy(desc(events.eventTimestamp), desc(events.id))
    .limit(input.limit + 1);
  const page = rows.slice(0, input.limit);
  return {
    page,
    nextAfterId: rows.length > input.limit ? (page.at(-1)?.id ?? null) : null,
  };
}

/**
 * An organization's deliveries, whatever their outcome: those resolved to it,
 * and the `TRANSFER`s that
 * moved a purchase away from it, which name it only as their source.
 */
export async function listRootOrganizationRevenuecatEvents(
  executor: DatabaseSession,
  input: PageInput & { readonly organizationId: string },
): Promise<{
  events: RootOrganizationRevenuecatEventResponse[];
  nextAfterId: string | null;
}> {
  const { page, nextAfterId } = await listPage(
    executor,
    or(
      eq(events.organizationId, input.organizationId),
      eq(events.sourceOrganizationId, input.organizationId),
    ),
    input,
  );
  return {
    events: page.map((row) => ({
      ...toResponse(row),
      role: row.organizationId === input.organizationId ? "target" : "source",
    })),
    nextAfterId,
  };
}

/** The webhook handler's disposition for a delivery it chose not to apply. */
const IGNORED_OUTCOME = "ignored";

function dispositionCondition(
  disposition: RootRevenuecatDisposition,
): SQL | undefined {
  const unmatched = isNull(events.organizationId);
  const ignored = eq(events.outcome, IGNORED_OUTCOME);
  if (disposition === "unmatched") return unmatched;
  if (disposition === "ignored") return ignored;
  return or(unmatched, ignored);
}

/**
 * Deliveries across every organization that resolved to none, or that the
 * handler ignored: where "I paid but sync didn't turn on" usually ends up.
 */
export async function listRootRevenuecatEventsReport(
  executor: DatabaseSession,
  input: PageInput & { readonly disposition: RootRevenuecatDisposition },
): Promise<{
  events: RootRevenuecatEventResponse[];
  nextAfterId: string | null;
}> {
  const { page, nextAfterId } = await listPage(
    executor,
    dispositionCondition(input.disposition),
    input,
  );
  return { events: page.map(toResponse), nextAfterId };
}
