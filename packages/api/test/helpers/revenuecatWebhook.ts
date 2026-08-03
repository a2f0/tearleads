import { db } from "@tearleads/api-shared/postgres";
import {
  organizationBilling,
  organizations,
  principalMembershipProjection,
  principalStates,
  users,
} from "@tearleads/api-shared/schema";
import type { TestUser } from "@tearleads/bob-and-alice";
import { and, desc, eq } from "drizzle-orm";
import invariant from "invariant";
import { routeApp } from "../../src/routeApp";
import { authenticate } from "./authenticate";
import { registerUser } from "./registerUser";

export const REVENUECAT_WEBHOOK_SECRET = "Bearer test-revenuecat-secret";
export const THIRTY_DAYS_MS = 30 * 24 * 60 * 60 * 1000;

interface WebhookEventInput {
  appUserId: string;
  entitlementIds?: string[];
  eventId?: string;
  eventTimestampMs?: number;
  expirationAtMs?: number | null;
  originalTransactionId?: string | null;
  organizationId: string;
  productId?: string | null;
  purchasedAtMs?: number | null;
  store?: string;
  transactionId?: string | null;
  type: string;
}

export async function registerAndAuthenticate(user: TestUser): Promise<string> {
  await registerUser(user);
  await authenticate(user);
  const [row] = await db
    .select({ organizationId: users.defaultOrganizationId })
    .from(users)
    .where(eq(users.id, user.userId));
  invariant(row, "expected registered user row");
  return row.organizationId;
}

export async function addEffectiveOrganizationMember(
  organizationId: string,
  userId: string,
): Promise<void> {
  const [organization] = await db
    .select({ memberGroupId: organizations.memberGroupId })
    .from(organizations)
    .where(eq(organizations.id, organizationId));
  invariant(organization, "expected organization row");
  const [state] = await db
    .select({ stateHash: principalStates.stateHash })
    .from(principalStates)
    .where(
      and(
        eq(principalStates.principalType, "group"),
        eq(principalStates.principalId, organization.memberGroupId),
      ),
    )
    .orderBy(desc(principalStates.version))
    .limit(1);
  invariant(state, "expected current Members-group state");
  await db.insert(principalMembershipProjection).values({
    userId: userId,
    principalId: organization.memberGroupId,
    principalType: "group",
    role: "member",
    stateHash: state.stateHash,
  });
}

export function revenuecatWebhookBody(input: WebhookEventInput): string {
  return JSON.stringify({
    api_version: "1.0",
    event: {
      app_user_id: input.appUserId,
      entitlement_ids: input.entitlementIds ?? ["sync"],
      event_timestamp_ms: input.eventTimestampMs ?? Date.now(),
      expiration_at_ms:
        input.expirationAtMs === undefined
          ? Date.now() + THIRTY_DAYS_MS
          : input.expirationAtMs,
      id: input.eventId ?? crypto.randomUUID(),
      original_transaction_id: input.originalTransactionId,
      product_id: input.productId ?? "sync_monthly",
      purchased_at_ms: input.purchasedAtMs,
      store: input.store,
      subscriber_attributes: { orgId: { value: input.organizationId } },
      transaction_id: input.transactionId,
      type: input.type,
    },
  });
}

export async function postRevenueCatWebhook(
  body: string,
  authorization: string | null = REVENUECAT_WEBHOOK_SECRET,
): Promise<Response> {
  const headers: Record<string, string> = {
    "Content-Type": "application/json",
    ...(authorization !== null ? { Authorization: authorization } : {}),
  };
  return routeApp.request("/billing/revenuecat/webhook", {
    body,
    headers,
    method: "POST",
  });
}

export async function readOrganizationBilling(organizationId: string) {
  const [row] = await db
    .select({
      currentPeriodEndsAt: organizationBilling.currentPeriodEndsAt,
      currentPeriodStartsAt: organizationBilling.currentPeriodStartsAt,
      disabledAt: organizationBilling.disabledAt,
      entitlementId: organizationBilling.entitlementId,
      provider: organizationBilling.provider,
      providerCustomerId: organizationBilling.providerCustomerId,
      providerProductId: organizationBilling.providerProductId,
      providerSubscriptionId: organizationBilling.providerSubscriptionId,
      providerTransactionId: organizationBilling.providerTransactionId,
      purgeAfter: organizationBilling.purgeAfter,
      seatCount: organizationBilling.seatCount,
      status: organizationBilling.status,
    })
    .from(organizationBilling)
    .where(eq(organizationBilling.organizationId, organizationId));
  invariant(row, "expected billing row");
  return row;
}
