import type { z } from "zod";
import {
  loosePlainObject,
  nonEmptyStringSchema,
  plainObjectSchema,
  requiredUnknownSchema,
} from "../schema";

export const AccessManifestBundleWireSchema = loosePlainObject({
  event: plainObjectSchema,
  manifest: plainObjectSchema,
  manifestHash: nonEmptyStringSchema,
  state: plainObjectSchema,
});

export type AccessManifestBundleWire = z.infer<
  typeof AccessManifestBundleWireSchema
>;

export const AccessEventBundleWireResponseSchema = loosePlainObject({
  body: requiredUnknownSchema,
  event: plainObjectSchema,
  eventHash: nonEmptyStringSchema,
});

export type AccessEventBundleWireResponse = z.infer<
  typeof AccessEventBundleWireResponseSchema
>;

export const AccessManifestBundleWireResponseSchema = loosePlainObject({
  event: AccessEventBundleWireResponseSchema,
  manifest: plainObjectSchema,
  manifestHash: nonEmptyStringSchema,
  state: plainObjectSchema,
});

export type AccessManifestBundleWireResponse = z.infer<
  typeof AccessManifestBundleWireResponseSchema
>;

/**
 * A bundle as a writer projection serves it: the signed event and the
 * manifest, without the derived state. The client rebuilds the state from
 * the signed bodies along the served predecessor chain when it decodes the
 * projection, and the verifier requires it to equal the state it derives.
 */
export const ServedAccessManifestBundleWireResponseSchema = loosePlainObject({
  event: AccessEventBundleWireResponseSchema,
  manifest: plainObjectSchema,
  manifestHash: nonEmptyStringSchema,
});

export type ServedAccessManifestBundleWireResponse = z.infer<
  typeof ServedAccessManifestBundleWireResponseSchema
>;

/** Every field a projection serves: the bundle without its derived state. */
export function toServedAccessManifestBundle(
  bundle: ServedAccessManifestBundleWireResponse,
): ServedAccessManifestBundleWireResponse {
  return {
    event: bundle.event,
    manifest: bundle.manifest,
    manifestHash: bundle.manifestHash,
  };
}

export function isServedAccessManifestBundleWireResponse(
  value: unknown,
): value is ServedAccessManifestBundleWireResponse {
  return ServedAccessManifestBundleWireResponseSchema.safeParse(value).success;
}

export function isAccessEventBundleWireResponse(
  value: unknown,
): value is AccessEventBundleWireResponse {
  return AccessEventBundleWireResponseSchema.safeParse(value).success;
}

export function isAccessManifestBundleWire(
  value: unknown,
): value is AccessManifestBundleWire {
  return AccessManifestBundleWireSchema.safeParse(value).success;
}

export function isAccessManifestBundleWireArray(
  value: unknown,
): value is AccessManifestBundleWire[] {
  return Array.isArray(value) && value.every(isAccessManifestBundleWire);
}

export function isOptionalAccessManifestBundleWireArray(
  value: unknown,
): value is AccessManifestBundleWire[] | undefined {
  return value === undefined || isAccessManifestBundleWireArray(value);
}

export function isAccessManifestBundleWireResponse(
  value: unknown,
): value is AccessManifestBundleWireResponse {
  return AccessManifestBundleWireResponseSchema.safeParse(value).success;
}
