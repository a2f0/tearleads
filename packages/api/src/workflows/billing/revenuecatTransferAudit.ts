import type { ApiDatabase } from "@symcrypt/api-shared/postgres";
import { revenuecatWebhookEvents } from "@symcrypt/api-shared/schema";
import type { RevenueCatTransferWebhookEvent } from "@symcrypt/validators/request";
import { resolveRevenueCatFinancialAuditFields } from "../../billing/revenuecatFinancials";

/** Persists a permanent transfer rejection so redelivery becomes a duplicate. */
export async function runRecordIgnoredRevenueCatTransferWorkflow(input: {
  readonly appUserId: string;
  readonly db: ApiDatabase;
  readonly event: RevenueCatTransferWebhookEvent;
  readonly organizationId: string | null;
}): Promise<boolean> {
  return input.db.transaction(async (tx) => {
    const financials = resolveRevenueCatFinancialAuditFields(input.event);
    const [claimed] = await tx
      .insert(revenuecatWebhookEvents)
      .values({
        appUserId: input.appUserId,
        eventId: input.event.id,
        eventTimestamp: new Date(input.event.event_timestamp_ms),
        eventType: "TRANSFER",
        organizationId: input.organizationId,
        outcome: "ignored",
        store: input.event.store?.toUpperCase() ?? null,
        ...financials,
      })
      .onConflictDoNothing({ target: revenuecatWebhookEvents.eventId })
      .returning({ id: revenuecatWebhookEvents.id });
    return claimed !== undefined;
  });
}
