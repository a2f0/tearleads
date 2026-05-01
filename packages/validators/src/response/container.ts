import { isPlainObject } from "../isPlainObject";
import {
  type AccessManifestBundleWireResponse,
  hasArrayProperty,
  hasNullableStringProperty,
  hasNumberProperty,
  hasStringProperty,
  isAccessManifestBundleWireResponse,
  isRecordArray,
} from "../util";
import {
  isReferencedPrincipalStateResponse,
  type ReferencedPrincipalStateResponse,
} from "./principal";

export interface ContainerKekResponse {
  containerId: string;
  accessManifestHash: string;
  containerKeyEpochId: string;
  containerKeyEpoch: number;
  keyEpoch: Record<string, unknown>;
  keyEpochHash: string;
  keyTargetHash: string;
  parentContainerKeyEpochId: string | null;
  containerManifestHistory?: AccessManifestBundleWireResponse[];
  recipientTargets: Record<string, unknown>[];
  wraps: Record<string, unknown>[];
}

export interface ContainerMutationResponse {
  containerId: string;
  organizationId: string;
  parentId: string | null;
  manifestHead: {
    epoch: number;
    manifestHash: string;
  };
  accessManifest: AccessManifestBundleWireResponse;
  containerKek: ContainerKekResponse;
  referencedPrincipalHeads: Record<string, unknown>[];
}

export interface ContainerWriterProjectionResponse {
  containerId: string;
  organizationId: string;
  path: AccessManifestBundleWireResponse[];
  containerKeks: ContainerKekResponse[];
}

export interface ContainerSummary {
  id: string;
  organizationId: string;
  parentId: string | null;
  metadataDocumentId: string;
  metadataAccessEpoch: number;
  metadataAccessStateHash: string;
  metadataReferencedPrincipals?: ReferencedPrincipalStateResponse[];
}

export type ListContainersResponse = ContainerSummary[];

function isContainerSummary(value: unknown): value is ContainerSummary {
  const metadataReferencedPrincipals = isPlainObject(value)
    ? Reflect.get(value, "metadataReferencedPrincipals")
    : undefined;
  const metadataAccessStateHash = isPlainObject(value)
    ? Reflect.get(value, "metadataAccessStateHash")
    : undefined;

  return (
    isPlainObject(value) &&
    hasStringProperty(value, "id") &&
    hasStringProperty(value, "organizationId") &&
    hasNullableStringProperty(value, "parentId") &&
    hasStringProperty(value, "metadataDocumentId") &&
    hasNumberProperty(value, "metadataAccessEpoch") &&
    typeof metadataAccessStateHash === "string" &&
    metadataAccessStateHash.length > 0 &&
    (metadataReferencedPrincipals === undefined ||
      (Array.isArray(metadataReferencedPrincipals) &&
        metadataReferencedPrincipals.every(isReferencedPrincipalStateResponse)))
  );
}

export function isListContainersResponse(
  value: unknown,
): value is ListContainersResponse {
  return Array.isArray(value) && value.every(isContainerSummary);
}

function isContainerKekResponse(value: unknown): value is ContainerKekResponse {
  const keyEpoch = isPlainObject(value)
    ? Reflect.get(value, "keyEpoch")
    : undefined;
  const containerManifestHistory = isPlainObject(value)
    ? Reflect.get(value, "containerManifestHistory")
    : undefined;
  const recipientTargets = isPlainObject(value)
    ? Reflect.get(value, "recipientTargets")
    : undefined;
  const wraps = isPlainObject(value) ? Reflect.get(value, "wraps") : undefined;

  return (
    isPlainObject(value) &&
    hasStringProperty(value, "containerId") &&
    hasStringProperty(value, "accessManifestHash") &&
    value.accessManifestHash.length > 0 &&
    hasStringProperty(value, "containerKeyEpochId") &&
    value.containerKeyEpochId.length > 0 &&
    hasNumberProperty(value, "containerKeyEpoch") &&
    Number.isInteger(value.containerKeyEpoch) &&
    value.containerKeyEpoch > 0 &&
    isPlainObject(keyEpoch) &&
    hasStringProperty(value, "keyEpochHash") &&
    value.keyEpochHash.length > 0 &&
    hasStringProperty(value, "keyTargetHash") &&
    value.keyTargetHash.length > 0 &&
    hasNullableStringProperty(value, "parentContainerKeyEpochId") &&
    (containerManifestHistory === undefined ||
      (Array.isArray(containerManifestHistory) &&
        containerManifestHistory.every(isAccessManifestBundleWireResponse))) &&
    isRecordArray(recipientTargets) &&
    recipientTargets.length > 0 &&
    isRecordArray(wraps) &&
    wraps.length > 0
  );
}

export function isContainerMutationResponse(
  value: unknown,
): value is ContainerMutationResponse {
  const manifestHead = isPlainObject(value)
    ? Reflect.get(value, "manifestHead")
    : undefined;
  const accessManifest = isPlainObject(value)
    ? Reflect.get(value, "accessManifest")
    : undefined;
  const containerKek = isPlainObject(value)
    ? Reflect.get(value, "containerKek")
    : undefined;
  const referencedPrincipalHeads = isPlainObject(value)
    ? Reflect.get(value, "referencedPrincipalHeads")
    : undefined;

  return (
    isPlainObject(value) &&
    hasStringProperty(value, "containerId") &&
    hasStringProperty(value, "organizationId") &&
    hasNullableStringProperty(value, "parentId") &&
    isPlainObject(manifestHead) &&
    hasNumberProperty(manifestHead, "epoch") &&
    hasStringProperty(manifestHead, "manifestHash") &&
    isAccessManifestBundleWireResponse(accessManifest) &&
    isContainerKekResponse(containerKek) &&
    isRecordArray(referencedPrincipalHeads)
  );
}

export function isContainerWriterProjectionResponse(
  value: unknown,
): value is ContainerWriterProjectionResponse {
  return (
    isPlainObject(value) &&
    hasStringProperty(value, "containerId") &&
    hasStringProperty(value, "organizationId") &&
    hasArrayProperty(value, "path") &&
    value.path.length > 0 &&
    value.path.every(isAccessManifestBundleWireResponse) &&
    hasArrayProperty(value, "containerKeks") &&
    value.containerKeks.length === value.path.length &&
    value.containerKeks.every(isContainerKekResponse)
  );
}
