import { isPlainObject } from "../isPlainObject";
import { hasStringProperty } from "../util";

export interface ContainerV2ManifestBundle {
  event: Record<string, unknown>;
  manifest: Record<string, unknown>;
  manifestHash: string;
  state: Record<string, unknown>;
}

export interface ContainerV2MutationRequest {
  event: Record<string, unknown>;
  body: unknown;
  expectedManifestHash: string;
  manifest: Record<string, unknown>;
  previousManifest?: ContainerV2ManifestBundle | null;
  previousContainerPath?: ContainerV2ManifestBundle[];
  parentContainerPath?: ContainerV2ManifestBundle[];
  destinationParentContainerPath?: ContainerV2ManifestBundle[];
  principalPolicies?: Record<string, unknown>[];
  keyEpoch: Record<string, unknown>;
  wraps: Record<string, unknown>[];
  containerManifestHistory?: ContainerV2ManifestBundle[];
  parentKekState?: Record<string, unknown> | null;
  userRecipientKeys?: Record<string, unknown>[];
}

function isRecordArray(value: unknown): value is Record<string, unknown>[] {
  return Array.isArray(value) && value.every(isPlainObject);
}

function isOptionalRecordArray(
  value: unknown,
): value is Record<string, unknown>[] | undefined {
  return value === undefined || isRecordArray(value);
}

function isContainerV2ManifestBundle(
  value: unknown,
): value is ContainerV2ManifestBundle {
  const event = isPlainObject(value) ? Reflect.get(value, "event") : undefined;
  const manifest = isPlainObject(value)
    ? Reflect.get(value, "manifest")
    : undefined;
  const state = isPlainObject(value) ? Reflect.get(value, "state") : undefined;

  return (
    isPlainObject(value) &&
    isPlainObject(event) &&
    isPlainObject(manifest) &&
    hasStringProperty(value, "manifestHash") &&
    value.manifestHash.length > 0 &&
    isPlainObject(state)
  );
}

function isContainerV2ManifestBundleArray(
  value: unknown,
): value is ContainerV2ManifestBundle[] {
  return Array.isArray(value) && value.every(isContainerV2ManifestBundle);
}

function isOptionalContainerV2ManifestBundleArray(
  value: unknown,
): value is ContainerV2ManifestBundle[] | undefined {
  return value === undefined || isContainerV2ManifestBundleArray(value);
}

function isOptionalParentKekState(
  value: unknown,
): value is Record<string, unknown> | null | undefined {
  return value === undefined || value === null || isPlainObject(value);
}

export function isContainerV2MutationRequest(
  value: unknown,
): value is ContainerV2MutationRequest {
  const previousManifest = isPlainObject(value)
    ? Reflect.get(value, "previousManifest")
    : undefined;
  const event = isPlainObject(value) ? Reflect.get(value, "event") : undefined;
  const body = isPlainObject(value) ? Reflect.get(value, "body") : undefined;
  const manifest = isPlainObject(value)
    ? Reflect.get(value, "manifest")
    : undefined;
  const previousContainerPath = isPlainObject(value)
    ? Reflect.get(value, "previousContainerPath")
    : undefined;
  const parentContainerPath = isPlainObject(value)
    ? Reflect.get(value, "parentContainerPath")
    : undefined;
  const destinationParentContainerPath = isPlainObject(value)
    ? Reflect.get(value, "destinationParentContainerPath")
    : undefined;
  const principalPolicies = isPlainObject(value)
    ? Reflect.get(value, "principalPolicies")
    : undefined;
  const keyEpoch = isPlainObject(value)
    ? Reflect.get(value, "keyEpoch")
    : undefined;
  const wraps = isPlainObject(value) ? Reflect.get(value, "wraps") : undefined;
  const containerManifestHistory = isPlainObject(value)
    ? Reflect.get(value, "containerManifestHistory")
    : undefined;
  const parentKekState = isPlainObject(value)
    ? Reflect.get(value, "parentKekState")
    : undefined;
  const userRecipientKeys = isPlainObject(value)
    ? Reflect.get(value, "userRecipientKeys")
    : undefined;

  return (
    isPlainObject(value) &&
    isPlainObject(event) &&
    Reflect.has(value, "body") &&
    body !== undefined &&
    hasStringProperty(value, "expectedManifestHash") &&
    value.expectedManifestHash.length > 0 &&
    isPlainObject(manifest) &&
    (previousManifest === undefined ||
      previousManifest === null ||
      isContainerV2ManifestBundle(previousManifest)) &&
    isOptionalContainerV2ManifestBundleArray(previousContainerPath) &&
    isOptionalContainerV2ManifestBundleArray(parentContainerPath) &&
    isOptionalContainerV2ManifestBundleArray(destinationParentContainerPath) &&
    isOptionalRecordArray(principalPolicies) &&
    isPlainObject(keyEpoch) &&
    isRecordArray(wraps) &&
    isOptionalContainerV2ManifestBundleArray(containerManifestHistory) &&
    isOptionalParentKekState(parentKekState) &&
    isOptionalRecordArray(userRecipientKeys)
  );
}
