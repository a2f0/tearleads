import { isPlainObject } from "../isPlainObject";
import {
  type AccessManifestBundleWire,
  hasStringProperty,
  isAccessManifestBundleWire,
  isOptionalAccessManifestBundleWireArray,
  isOptionalRecordArray,
  isRecordArray,
} from "../util";

export interface ContainerMutationRequest {
  event: Record<string, unknown>;
  body: unknown;
  expectedManifestHash: string;
  manifest: Record<string, unknown>;
  previousManifest?: AccessManifestBundleWire | null;
  previousContainerPath?: AccessManifestBundleWire[];
  parentContainerPath?: AccessManifestBundleWire[];
  destinationParentContainerPath?: AccessManifestBundleWire[];
  principalPolicies: Record<string, unknown>[];
  keyEpoch: Record<string, unknown>;
  predecessorBridge: Record<string, unknown> | null;
  wraps: Record<string, unknown>[];
  containerManifestHistory?: AccessManifestBundleWire[];
  parentKekState?: Record<string, unknown> | null;
  userRecipientKeys?: Record<string, unknown>[];
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
  const predecessorBridge = isPlainObject(value)
    ? Reflect.get(value, "predecessorBridge")
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
      isAccessManifestBundleWire(previousManifest)) &&
    isOptionalAccessManifestBundleWireArray(previousContainerPath) &&
    isOptionalAccessManifestBundleWireArray(parentContainerPath) &&
    isOptionalAccessManifestBundleWireArray(destinationParentContainerPath) &&
    isRecordArray(principalPolicies) &&
    isPlainObject(keyEpoch) &&
    Reflect.has(value, "predecessorBridge") &&
    (predecessorBridge === null || isPlainObject(predecessorBridge)) &&
    isRecordArray(wraps) &&
    isOptionalAccessManifestBundleWireArray(containerManifestHistory) &&
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
