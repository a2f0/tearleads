import { db } from "@tearleads/api-shared/postgres";
import { organizationBilling, users } from "@tearleads/api-shared/schema";
import { createTestUser, type TestUser } from "@tearleads/bob-and-alice";
import { toFingerprint } from "@tearleads/crypto";
import { bytesToBase64 } from "@tearleads/encoding";
import { eq } from "drizzle-orm";
import invariant from "invariant";
import { routeApp } from "../../src/routeApp";
import { authenticate } from "./authenticate";
import { addMemberGroupUser, addMemberGroupUsers } from "./organizationMember";
import { registerUser } from "./registerUser";

export const REVENUECAT_WEBHOOK_SECRET = "Bearer test-revenuecat-secret";
export const THIRTY_DAYS_MS = 30 * 24 * 60 * 60 * 1000;

interface WebhookEventInput {
  appUserId: string;
  currency?: string | null;
  entitlementIds?: string[];
  eventId?: string;
  eventTimestampMs?: number;
  environment?: string | null;
  expirationAtMs?: number | null;
  originalTransactionId?: string | null;
  organizationId: string;
  productId?: string | null;
  periodType?: string | null;
  priceInPurchasedCurrency?: number | null;
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

export async function addEffectiveOrganizationMember(input: {
  readonly actor: TestUser;
  readonly organizationId: string;
  readonly userId: string;
}): Promise<void> {
  await addMemberGroupUser({
    actor: input.actor,
    memberUserId: input.userId,
    organizationId: input.organizationId,
  });
}

export async function addSyntheticEffectiveOrganizationMembers(input: {
  readonly actor: TestUser;
  readonly count: number;
  readonly organizationId: string;
}): Promise<void> {
  const members = await Promise.all(
    Array.from({ length: input.count }, async () => {
      const member = createTestUser();
      member.userId = crypto.randomUUID();
      member.fingerprint = await toFingerprint(member.signing.signingPublicKey);
      return member;
    }),
  );
  await db.insert(users).values(
    await Promise.all(
      members.map(async (member) => ({
        id: member.userId,
        fingerprint: member.fingerprint,
        signingPublicKey: bytesToBase64(member.signing.signingPublicKey),
        encapsulationPublicKey: bytesToBase64(member.kem.publicKey),
        encapsulationKeyFingerprint: await toFingerprint(member.kem.publicKey),
        defaultOrganizationId: input.organizationId,
      })),
    ),
  );
  await addMemberGroupUsers({
    actor: input.actor,
    memberUserIds: members.map((member) => member.userId),
    organizationId: input.organizationId,
  });
}

export function addSyntheticMember(
  actor: TestUser,
  organizationId: string,
): Promise<void> {
  return addSyntheticEffectiveOrganizationMembers({
    actor,
    count: 1,
    organizationId,
  });
}

export function revenuecatWebhookBody(input: WebhookEventInput): string {
  return JSON.stringify({
    api_version: "1.0",
    event: {
      app_user_id: input.appUserId,
      currency: input.currency,
      entitlement_ids: input.entitlementIds ?? ["sync"],
      event_timestamp_ms: input.eventTimestampMs ?? Date.now(),
      environment: input.environment,
      expiration_at_ms:
        input.expirationAtMs === undefined
          ? Date.now() + THIRTY_DAYS_MS
          : input.expirationAtMs,
      id: input.eventId ?? crypto.randomUUID(),
      original_transaction_id: input.originalTransactionId,
      product_id: input.productId ?? "sync_monthly",
      period_type: input.periodType,
      price_in_purchased_currency: input.priceInPurchasedCurrency,
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
