import { isPlainObject } from "../isPlainObject";
import {
  hasNullableStringProperty,
  hasObjectProperty,
  hasOptionalStringProperty,
  hasStringProperty,
  isStringArray,
} from "../util";

const MAX_VALID_DATE_MS = 8_640_000_000_000_000;
const EVENT_TIMESTAMP_MS_KEY = "event_timestamp_ms";
const EVENT_TYPE_KEY = "type";
const TRANSFERRED_FROM_KEY = "transferred_from";
const TRANSFERRED_TO_KEY = "transferred_to";

/**
 * A single RevenueCat subscriber attribute as delivered on a webhook event. Only
 * `value` is consumed; the accompanying `updated_at_ms` is ignored. `value` may
 * be null when RevenueCat reports an attribute that was cleared.
 */
export interface RevenueCatSubscriberAttribute {
  value: string | null;
}

/**
 * The RevenueCat webhook event body fields the server consumes. RevenueCat sends
 * many more fields; this narrows to the ones that drive org sync-billing and
 * keeps snake_case to match the wire payload verbatim.
 *
 * - `id`: Globally-unique event id used to make processing idempotent.
 * - `type`: Event type (e.g. `INITIAL_PURCHASE`, `RENEWAL`, `EXPIRATION`).
 * - `app_user_id`: RevenueCat App User ID; our client sets it to the buyer's
 *   global user id.
 * - `event_timestamp_ms`: When RevenueCat emitted the event.
 * - `purchased_at_ms`: Start of the current subscription period, when
 *   applicable.
 * - `expiration_at_ms`: End of the current entitlement period, when applicable.
 * - `product_id`: Product/package id the provider reported. On
 *   `PRODUCT_CHANGE`, RevenueCat reports the old product here and the newly
 *   purchased tier in `new_product_id`.
 * - `transaction_id` / `original_transaction_id`: Provider transaction ids used
 *   for audit and correlation.
 * - `entitlement_ids`: Entitlement(s) the event concerns.
 * - `subscriber_attributes`: Custom attributes; the `orgId` attribute binds the
 *   purchase to the organization being paid for.
 * - `store`: Which store processed the purchase (e.g. `RC_BILLING`,
 *   `STRIPE`, `APP_STORE`). Stripe-store events carry no transaction
 *   metadata, so the server resolves their organization from the Stripe
 *   subscription itself (see the api webhook workflow).
 * - `environment`: `SANDBOX` or `PRODUCTION`. Native store testing (StoreKit
 *   sandbox, TestFlight, Play internal testing) emits real webhook events that
 *   are indistinguishable from paid ones apart from this field, so the server
 *   must read it to keep a tester's free purchase from provisioning real
 *   billing. Optional because RevenueCat has not always sent it and a missing
 *   value must not fail the request; the server treats absent as production.
 * - `currency` / `price_in_purchased_currency`: The store transaction's ISO
 *   currency and decimal amount as reported by RevenueCat. They are optional
 *   because RevenueCat documents financial fields as nullable on some events.
 * - `period_type`: Whether the transaction is a trial, intro, normal,
 *   promotional, or prepaid period.
 * - `metadata`: Developer-defined metadata RevenueCat attaches to Web Billing
 *   transactions. The client stamps `orgId` here too; unlike the customer-level
 *   subscriber attribute this is immutable per purchase, so it is the preferred
 *   org binding. RevenueCat documents values as string/number/boolean/null.
 */
export interface RevenueCatWebhookEvent {
  id: string;
  type: string;
  app_user_id: string;
  event_timestamp_ms: number;
  purchased_at_ms?: number | null;
  expiration_at_ms?: number | null;
  product_id?: string | null;
  new_product_id?: string | null;
  transaction_id?: string | null;
  original_transaction_id?: string | null;
  entitlement_ids?: string[];
  store?: string | null;
  environment?: string | null;
  currency?: string | null;
  price_in_purchased_currency?: number | null;
  period_type?: string | null;
  subscriber_attributes?: Record<string, RevenueCatSubscriberAttribute>;
  metadata?: Record<string, string | number | boolean | null> | null;
}

/**
 * RevenueCat's receipt-transfer event. Unlike lifecycle events it has no
 * `app_user_id`; it reports the complete source and destination App User ID
 * sets instead. The server resolves the destination's personal organization,
 * verifies its active subscription through RevenueCat v2, and moves the local
 * billing binding atomically.
 */
export interface RevenueCatTransferWebhookEvent {
  id: string;
  type: "TRANSFER";
  event_timestamp_ms: number;
  transferred_from: string[];
  transferred_to: string[];
  store?: string | null;
  environment?: string | null;
}

export type RevenueCatIncomingWebhookEvent =
  | RevenueCatWebhookEvent
  | RevenueCatTransferWebhookEvent;

/**
 * The webhook request envelope RevenueCat POSTs to
 * `/billing/revenuecat/webhook`.
 */
export interface RevenueCatWebhookRequest {
  api_version?: string;
  event: RevenueCatIncomingWebhookEvent;
}

export function isRevenueCatTransferWebhookEvent(
  value: unknown,
): value is RevenueCatTransferWebhookEvent {
  return (
    isPlainObject(value) &&
    hasStringProperty(value, "id") &&
    value[EVENT_TYPE_KEY] === "TRANSFER" &&
    isRevenueCatTimestampMs(value[EVENT_TIMESTAMP_MS_KEY]) &&
    isStringArray(value[TRANSFERRED_FROM_KEY]) &&
    isStringArray(value[TRANSFERRED_TO_KEY]) &&
    value[TRANSFERRED_TO_KEY].length > 0 &&
    isAbsentOrNullableString(value, "store") &&
    isAbsentOrNullableString(value, "environment")
  );
}

function isSubscriberAttributeMap(
  value: unknown,
): value is Record<string, RevenueCatSubscriberAttribute> {
  if (!isPlainObject(value)) {
    return false;
  }
  return Object.values(value).every(
    (attribute) =>
      isPlainObject(attribute) && hasNullableStringProperty(attribute, "value"),
  );
}

// Property helpers take the key as a parameter, which keeps both tsc's
// no-index-signature-dot-access rule and biome's prefer-dot-access rule happy
// (neither fires on a variable key); these thin wrappers extend that to the
// optional/nullable/array shapes RevenueCat sends.
function isAbsentOrNullableTimestampMs(
  value: Record<string, unknown>,
  key: string,
): boolean {
  const candidate = value[key];
  return (
    candidate === undefined ||
    candidate === null ||
    isRevenueCatTimestampMs(candidate)
  );
}

function isRevenueCatTimestampMs(value: unknown): value is number {
  return (
    typeof value === "number" &&
    Number.isSafeInteger(value) &&
    value >= 0 &&
    value <= MAX_VALID_DATE_MS
  );
}

function isAbsentOrStringArray(
  value: Record<string, unknown>,
  key: string,
): boolean {
  const candidate = value[key];
  return candidate === undefined || isStringArray(candidate);
}

function isAbsentOrNullableString(
  value: Record<string, unknown>,
  key: string,
): boolean {
  const candidate = value[key];
  return (
    candidate === undefined ||
    candidate === null ||
    typeof candidate === "string"
  );
}

function isAbsentOrNullableFiniteNumber(
  value: Record<string, unknown>,
  key: string,
): boolean {
  const candidate = value[key];
  return (
    candidate === undefined ||
    candidate === null ||
    (typeof candidate === "number" && Number.isFinite(candidate))
  );
}

function isAbsentOrSubscriberAttributeMap(
  value: Record<string, unknown>,
  key: string,
): boolean {
  const candidate = value[key];
  return candidate === undefined || isSubscriberAttributeMap(candidate);
}

function isMetadataMap(
  value: unknown,
): value is Record<string, string | number | boolean | null> {
  if (!isPlainObject(value)) {
    return false;
  }
  return Object.values(value).every(
    (entry) =>
      entry === null ||
      typeof entry === "string" ||
      typeof entry === "number" ||
      typeof entry === "boolean",
  );
}

function isAbsentOrNullableMetadataMap(
  value: Record<string, unknown>,
  key: string,
): boolean {
  const candidate = value[key];
  return (
    candidate === undefined || candidate === null || isMetadataMap(candidate)
  );
}

function isRevenueCatWebhookEvent(
  value: unknown,
): value is RevenueCatWebhookEvent {
  return (
    isPlainObject(value) &&
    hasStringProperty(value, "id") &&
    hasStringProperty(value, "type") &&
    value[EVENT_TYPE_KEY] !== "TRANSFER" &&
    hasStringProperty(value, "app_user_id") &&
    isRevenueCatTimestampMs(value[EVENT_TIMESTAMP_MS_KEY]) &&
    isAbsentOrNullableTimestampMs(value, "purchased_at_ms") &&
    isAbsentOrNullableTimestampMs(value, "expiration_at_ms") &&
    isAbsentOrNullableString(value, "product_id") &&
    isAbsentOrNullableString(value, "new_product_id") &&
    isAbsentOrNullableString(value, "transaction_id") &&
    isAbsentOrNullableString(value, "original_transaction_id") &&
    isAbsentOrStringArray(value, "entitlement_ids") &&
    isAbsentOrNullableString(value, "store") &&
    isAbsentOrNullableString(value, "environment") &&
    isAbsentOrNullableString(value, "currency") &&
    isAbsentOrNullableFiniteNumber(value, "price_in_purchased_currency") &&
    isAbsentOrNullableString(value, "period_type") &&
    isAbsentOrSubscriberAttributeMap(value, "subscriber_attributes") &&
    isAbsentOrNullableMetadataMap(value, "metadata")
  );
}

export function isRevenueCatWebhookRequest(
  value: unknown,
): value is RevenueCatWebhookRequest {
  return (
    isPlainObject(value) &&
    hasOptionalStringProperty(value, "api_version") &&
    hasObjectProperty(value, "event") &&
    (isRevenueCatWebhookEvent(value.event) ||
      isRevenueCatTransferWebhookEvent(value.event))
  );
}
