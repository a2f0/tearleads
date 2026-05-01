import { isPlainObject } from "../isPlainObject";
import { hasNonEmptyStringProperty } from "./properties";

export interface AccessManifestBundleWire {
  event: Record<string, unknown>;
  manifest: Record<string, unknown>;
  manifestHash: string;
  state: Record<string, unknown>;
}

export function isAccessEventBundleWireResponse(
  value: unknown,
): value is Record<string, unknown> {
  const signedEvent = isPlainObject(value)
    ? Reflect.get(value, "event")
    : undefined;
  const body = isPlainObject(value) ? Reflect.get(value, "body") : undefined;

  return (
    isPlainObject(value) &&
    isPlainObject(signedEvent) &&
    Reflect.has(value, "body") &&
    body !== undefined &&
    hasNonEmptyStringProperty(value, "eventHash")
  );
}

export function isAccessManifestBundleWire(
  value: unknown,
): value is AccessManifestBundleWire {
  const event = isPlainObject(value) ? Reflect.get(value, "event") : undefined;
  const manifest = isPlainObject(value)
    ? Reflect.get(value, "manifest")
    : undefined;
  const state = isPlainObject(value) ? Reflect.get(value, "state") : undefined;

  return (
    isPlainObject(value) &&
    isPlainObject(event) &&
    isPlainObject(manifest) &&
    hasNonEmptyStringProperty(value, "manifestHash") &&
    isPlainObject(state)
  );
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
): value is AccessManifestBundleWire {
  const event = isPlainObject(value) ? Reflect.get(value, "event") : undefined;
  const manifest = isPlainObject(value)
    ? Reflect.get(value, "manifest")
    : undefined;
  const state = isPlainObject(value) ? Reflect.get(value, "state") : undefined;

  return (
    isPlainObject(value) &&
    isAccessEventBundleWireResponse(event) &&
    isPlainObject(manifest) &&
    hasNonEmptyStringProperty(value, "manifestHash") &&
    isPlainObject(state)
  );
}
