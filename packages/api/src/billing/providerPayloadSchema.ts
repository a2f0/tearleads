/**
 * Leaf schemas and soft readers for third-party billing payloads (Stripe and
 * RevenueCat responses, and Stripe webhook events after signature checks).
 *
 * These payloads are read field by field: a missing or malformed field reads
 * as null without failing its siblings, and object schemas are loose, since
 * providers add keys freely. Every read goes through `safeParse`; nothing
 * coerces, defaults, or rewrites a provider value.
 */

import { z } from "zod";

/** A non-empty string: the ids, statuses, and URLs read from providers. */
export const providerStringSchema = z.string().min(1);

/** zod 4 `.int()` admits only safe integers, as `Number.isSafeInteger` does. */
export const nonnegativeIntegerSchema = z.number().int().nonnegative();

export const positiveIntegerSchema = z.number().int().positive();

/** Unix seconds; zod 4 numbers reject NaN and infinities. */
const unixSecondsSchema = z.number();

/**
 * A field that is read later on its own, by its own schema. It may be absent:
 * in zod 4 an object key typed `z.unknown()` alone must be present.
 */
export const providerFieldSchema = z.unknown().optional();

/** Any JSON object or array: what a `typeof body === "object"` check admits. */
export const providerResponseSchema = z.union([
  z.looseObject({}),
  z.array(z.unknown()),
]);

/** Stripe leaves a referenced resource as its id or expands it to an object. */
export const stripeReferenceSchema = z.union([
  providerStringSchema,
  z.looseObject({ id: providerStringSchema }),
]);

export function stripeReferenceId(
  reference: z.output<typeof stripeReferenceSchema>,
): string {
  return typeof reference === "string" ? reference : reference.id;
}

/** The parsed value, or null when it is missing or does not match. */
export function readProviderField<T>(
  schema: z.ZodType<T>,
  value: unknown,
): T | null {
  const result = schema.safeParse(value);
  return result.success ? result.data : null;
}

/**
 * Reads a provider object whose fields are then read one by one; anything
 * that is not an object reads as an object with every field missing.
 */
export function readProviderObject<T extends object>(
  schema: z.ZodType<T>,
  value: unknown,
): Partial<T> {
  return readProviderField(schema, value) ?? {};
}

export function readProviderString(value: unknown): string | null {
  return readProviderField(providerStringSchema, value);
}

export function readStripeReferenceId(value: unknown): string | null {
  const reference = readProviderField(stripeReferenceSchema, value);
  return reference === null ? null : stripeReferenceId(reference);
}

export function readUnixTimestamp(value: unknown): Date | null {
  const seconds = readProviderField(unixSecondsSchema, value);
  if (seconds === null) {
    return null;
  }
  const date = new Date(seconds * 1000);
  return Number.isNaN(date.getTime()) ? null : date;
}
