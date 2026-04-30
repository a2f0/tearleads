import { isPlainObject } from "../isPlainObject";
import { hasStringProperty } from "../util";

export interface ContainerManifestBundle {
  event: Record<string, unknown>;
  manifest: Record<string, unknown>;
  manifestHash: string;
  state: Record<string, unknown>;
}

export interface ContainerMutationRequest {
  event: Record<string, unknown>;
  body: unknown;
  expectedManifestHash: string;
  manifest: Record<string, unknown>;
  previousManifest?: ContainerManifestBundle | null;
  previousContainerPath?: ContainerManifestBundle[];
  parentContainerPath?: ContainerManifestBundle[];
  destinationParentContainerPath?: ContainerManifestBundle[];
  principalPolicies?: Record<string, unknown>[];
  keyEpoch: Record<string, unknown>;
  wraps: Record<string, unknown>[];
  containerManifestHistory?: ContainerManifestBundle[];
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

function isContainerManifestBundle(
  value: unknown,
): value is ContainerManifestBundle {
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

function isContainerManifestBundleArray(
  value: unknown,
): value is ContainerManifestBundle[] {
  return Array.isArray(value) && value.every(isContainerManifestBundle);
}

function isOptionalContainerManifestBundleArray(
  value: unknown,
): value is ContainerManifestBundle[] | undefined {
  return value === undefined || isContainerManifestBundleArray(value);
}

function isOptionalParentKekState(
  value: unknown,
): value is Record<string, unknown> | null | undefined {
  return value === undefined || value === null || isPlainObject(value);
}

export function isContainerMutationRequest(
  value: unknown,
): value is ContainerMutationRequest {
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
      isContainerManifestBundle(previousManifest)) &&
    isOptionalContainerManifestBundleArray(previousContainerPath) &&
    isOptionalContainerManifestBundleArray(parentContainerPath) &&
    isOptionalContainerManifestBundleArray(destinationParentContainerPath) &&
    isOptionalRecordArray(principalPolicies) &&
    isPlainObject(keyEpoch) &&
    isRecordArray(wraps) &&
    isOptionalContainerManifestBundleArray(containerManifestHistory) &&
    isOptionalParentKekState(parentKekState) &&
    isOptionalRecordArray(userRecipientKeys)
  );
}

export function isOptionalContainerMutationRequestArray(
  value: unknown,
): value is ContainerMutationRequest[] | undefined {
  return (
    value === undefined ||
    (Array.isArray(value) && value.every(isContainerMutationRequest))
  );
}
