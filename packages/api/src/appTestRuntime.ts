import { db } from "@tearleads/api-shared/postgres";
import { organizationBilling } from "@tearleads/api-shared/schema";
import { eq } from "drizzle-orm";
import { runOrganizationPurgeMaintenance } from "./services/billing/organizationPurge";
import { getDefaultApiServiceRuntime } from "./services/runtime";

export { initializeApiDatabase } from "@tearleads/api-shared/postgres";
export { createMemoryBlobObjectStore } from "./adapters/blobObjectStore";
export {
  createDestroySession,
  createDestroyUserSession,
  createIsLiveUserSession,
  createListUserSessions,
  createRequireAuth,
  createSessionTokenIssuer,
} from "./middleware/session";
export { authorizeContainerAccessWithWorkflow } from "./realtime/containerInterestAccess";
export { createRealtimeGateway } from "./realtime/realtimeGateway";
export { createWebSocketTicketConsumer } from "./realtime/wsTicket";
export { createRouteApp, routeApp } from "./routeApp";
export { getDefaultApiServiceRuntime } from "./services/runtime";
export { db };

/**
 * Lapses an organization's billing past its retention window and runs the
 * scheduled purge maintenance job once, for end-to-end recovery scenarios.
 */
export async function purgeOrganizationForTest(
  organizationId: string,
  runtime = getDefaultApiServiceRuntime(),
): Promise<{ claimed: number; failed: number; purged: number }> {
  const now = new Date();
  await runtime.db
    .update(organizationBilling)
    .set({ status: "disabled", purgeAfter: new Date(now.getTime() - 1) })
    .where(eq(organizationBilling.organizationId, organizationId));
  return runOrganizationPurgeMaintenance(runtime, {
    now,
    organizationIds: [organizationId],
  });
}
