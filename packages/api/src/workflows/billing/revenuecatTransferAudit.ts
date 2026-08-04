import type { ApiDatabase } from "@tearleads/api-shared/postgres";
import { revenuecatWebhookEvents } from "@tearleads/api-shared/schema";
import type { RevenueCatTransferWebhookEvent } from "@tearleads/validators/request";

/** Persists a permanent transfer rejection so redelivery becomes a duplicate. */
export async function runRecordIgnoredRevenueCatTransferWorkflow(input: {
  readonly appUserId: string;
  readonly db: ApiDatabase;
  readonly event: RevenueCatTransferWebhookEvent;
  readonly organizationId: string | null;
}): Promise<boolean> {
  return input.db.transaction(async (tx) => {
    const [claimed] = await tx
      .insert(revenuecatWebhookEvents)
      .values({
        appUserId: input.appUserId,
        eventId: input.event.id,
        eventTimestamp: new Date(input.event.event_timestamp_ms),
        eventType: "TRANSFER",
        organizationId: input.organizationId,
        outcome: "ignored",
        store: input.event.store ?? null,
      })
      .onConflictDoNothing({ target: revenuecatWebhookEvents.eventId })
      .returning({ id: revenuecatWebhookEvents.id });
    return claimed !== undefined;
  });
}
