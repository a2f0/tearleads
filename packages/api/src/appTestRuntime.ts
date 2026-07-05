import { db } from "@tearleads/api-shared/postgres";
import { organizationBilling } from "@tearleads/api-shared/schema";
import { eq } from "drizzle-orm";

export {
  createDestroySession,
  createDestroyUserSession,
  createIsLiveUserSession,
  createListUserSessions,
  createRequireAuth,
  createSessionTokenIssuer,
} from "./middleware/session";
export { createRouteApp } from "./routeApp";
export { createWebSocketTicketConsumer } from "./wsTicket";
export { db };

/**
 * Marks a test organization's billing as sync-enabled (`active`). Registration
 * provisions organizations as `local` (on-device only) and sync is gated on
 * per-organization billing, so the app integration harness calls this after
 * each proxied registration to keep "a registered test user can sync" the
 * default — mirroring the api package's `enableTestOrganizationSync` helper.
 */
export async function enableTestOrganizationSync(
  organizationId: string,
): Promise<void> {
  await db
    .update(organizationBilling)
    .set({ status: "active", trialEndsAt: null, updatedAt: new Date() })
    .where(eq(organizationBilling.organizationId, organizationId));
}
