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
 * - `expiration_at_ms`: End of the current entitlement period, when applicable.
 * - `entitlement_ids`: Entitlement(s) the event concerns.
 * - `subscriber_attributes`: Custom attributes; the `orgId` attribute binds the
 *   purchase to the organization being paid for.
 */
export interface RevenueCatWebhookEvent {
  id: string;
  type: string;
  app_user_id: string;
  event_timestamp_ms: number;
  expiration_at_ms?: number | null;
  entitlement_ids?: string[];
  subscriber_attributes?: Record<string, RevenueCatSubscriberAttribute>;
}

/**
 * The webhook request envelope RevenueCat POSTs to
 * `/billing/revenuecat/webhook`.
 */
export interface RevenueCatWebhookRequest {
  api_version?: string;
  event: RevenueCatWebhookEvent;
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

function isAbsentOrSubscriberAttributeMap(
  value: Record<string, unknown>,
  key: string,
): boolean {
  const candidate = value[key];
  return candidate === undefined || isSubscriberAttributeMap(candidate);
}

function isRevenueCatWebhookEvent(
  value: unknown,
): value is RevenueCatWebhookEvent {
  return (
    isPlainObject(value) &&
    hasStringProperty(value, "id") &&
    hasStringProperty(value, "type") &&
    hasStringProperty(value, "app_user_id") &&
    isRevenueCatTimestampMs(value[EVENT_TIMESTAMP_MS_KEY]) &&
    isAbsentOrNullableTimestampMs(value, "expiration_at_ms") &&
    isAbsentOrStringArray(value, "entitlement_ids") &&
    isAbsentOrSubscriberAttributeMap(value, "subscriber_attributes")
  );
}

export function isRevenueCatWebhookRequest(
  value: unknown,
): value is RevenueCatWebhookRequest {
  return (
    isPlainObject(value) &&
    hasOptionalStringProperty(value, "api_version") &&
    hasObjectProperty(value, "event") &&
    isRevenueCatWebhookEvent(value.event)
  );
}
