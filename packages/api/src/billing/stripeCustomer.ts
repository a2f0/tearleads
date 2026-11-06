/** The per-(buyer, organization) Stripe customer checkout bills. */

import { readProviderField } from "./providerPayloadSchema";
import { customerSearchSchema, stripeObjectIdSchema } from "./stripeApiSchema";
import {
  escapeSearchValue,
  resolveDeps,
  type StripeApiDeps,
  StripeApiError,
  stripeRequest,
} from "./stripeHttp";

/**
 * Finds the Stripe customer previously created for this buyer AND
 * organization, or creates one. Customers are deliberately scoped per
 * (user, org): the Billing Portal exposes everything on a customer, so a
 * buyer purchasing for several organizations must not have their
 * subscriptions pooled on one customer — org A's portal would expose (and
 * allow cancelling) org B's billing.
 */
export async function findOrCreateCustomer(
  input: { userId: string; organizationId: string },
  deps: StripeApiDeps = {},
): Promise<string | null> {
  const { fetchImpl, secretKey } = resolveDeps(deps);
  if (!secretKey) {
    return null;
  }
  const query = encodeURIComponent(
    `metadata['userId']:'${escapeSearchValue(input.userId)}' AND ` +
      `metadata['orgId']:'${escapeSearchValue(input.organizationId)}'`,
  );
  const found = await stripeRequest({
    fetchImpl,
    secretKey,
    method: "GET",
    path: `/v1/customers/search?query=${query}&limit=1`,
    operation: "customer search",
  });
  const match = readProviderField(customerSearchSchema, found);
  if (match) {
    return match.data[0].id;
  }

  const form = new URLSearchParams();
  form.set("metadata[userId]", input.userId);
  form.set("metadata[orgId]", input.organizationId);
  const created = await stripeRequest({
    fetchImpl,
    secretKey,
    method: "POST",
    path: "/v1/customers",
    operation: "customer create",
    form,
    // Search is eventually consistent, so a rapid retry can miss the customer
    // it just created; the scoped key makes the create itself return the
    // original instead — and beyond the idempotency window the search IS
    // consistent.
    idempotencyKey: `sync-customer:${input.userId}:${input.organizationId}`,
  });
  const customerId = readProviderField(stripeObjectIdSchema, created)?.id;
  if (!customerId) {
    // The create succeeded but the id could not be read: a provider failure
    // (502), never "unconfigured" — mirrors the subscription-create handling.
    throw new StripeApiError("customer create (unreadable id)", 502);
  }
  return customerId;
}
