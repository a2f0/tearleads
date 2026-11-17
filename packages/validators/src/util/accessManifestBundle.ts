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
