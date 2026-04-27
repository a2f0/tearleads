import { isPlainObject } from "../isPlainObject";
import {
  hasArrayProperty,
  hasNullableStringProperty,
  hasNumberProperty,
  hasStringProperty,
} from "../util";
import {
  isReferencedPrincipalStateResponse,
  type ReferencedPrincipalStateResponse,
} from "./principal";

export interface CreateContainerResponse {
  id: string;
  organizationId: string;
  parentId: string;
  metadataDocumentId: string;
  metadataAccessEpoch: number;
  metadataAccessStateHash: string;
  metadataRecipientEncapsulationPublicKeys: string[];
  metadataReferencedPrincipals?: ReferencedPrincipalStateResponse[];
}

export interface ShareContainerResponse {
  id: string;
  metadataDocumentId: string;
  metadataAccessEpoch: number;
  metadataAccessStateHash: string;
  metadataRecipientEncapsulationPublicKeys: string[];
  metadataReferencedPrincipals?: ReferencedPrincipalStateResponse[];
}

export type MoveContainerResponse = ContainerSummary;

export interface ContainerV2ManifestBundleResponse {
  event: Record<string, unknown>;
  manifest: Record<string, unknown>;
  manifestHash: string;
  state: Record<string, unknown>;
}

export interface ContainerV2KekResponse {
  containerId: string;
  accessManifestHash: string;
  containerKeyEpochId: string;
  containerKeyEpoch: number;
  keyEpoch: Record<string, unknown>;
  keyEpochHash: string;
  keyTargetHash: string;
  parentContainerKeyEpochId: string | null;
  recipientTargets: Record<string, unknown>[];
  wraps: Record<string, unknown>[];
}

export interface ContainerV2MutationResponse {
  containerId: string;
  organizationId: string;
  parentId: string | null;
  manifestHead: {
    epoch: number;
    manifestHash: string;
  };
  accessManifest: ContainerV2ManifestBundleResponse;
  containerKek: ContainerV2KekResponse;
  referencedPrincipalHeads: Record<string, unknown>[];
}

export interface ContainerV2WriterProjectionResponse {
  containerId: string;
  organizationId: string;
  path: ContainerV2ManifestBundleResponse[];
  containerKeks: ContainerV2KekResponse[];
}

export interface ContainerSummary {
  id: string;
  organizationId: string;
  parentId: string | null;
  metadataDocumentId: string;
  metadataAccessEpoch: number;
  metadataAccessStateHash: string;
  metadataRecipientEncapsulationPublicKeys: string[];
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
    hasArrayProperty(value, "metadataRecipientEncapsulationPublicKeys") &&
    value.metadataRecipientEncapsulationPublicKeys.every(
      (entry) => typeof entry === "string",
    ) &&
    (metadataReferencedPrincipals === undefined ||
      (Array.isArray(metadataReferencedPrincipals) &&
        metadataReferencedPrincipals.every(isReferencedPrincipalStateResponse)))
  );
}

export function isCreateContainerResponse(
  value: unknown,
): value is CreateContainerResponse {
  return isContainerSummary(value) && value.parentId !== null;
}

export function isListContainersResponse(
  value: unknown,
): value is ListContainersResponse {
  return Array.isArray(value) && value.every(isContainerSummary);
}

export function isShareContainerResponse(
  value: unknown,
): value is ShareContainerResponse {
  const metadataReferencedPrincipals = isPlainObject(value)
    ? Reflect.get(value, "metadataReferencedPrincipals")
    : undefined;
  const metadataAccessStateHash = isPlainObject(value)
    ? Reflect.get(value, "metadataAccessStateHash")
    : undefined;

  return (
    isPlainObject(value) &&
    hasStringProperty(value, "id") &&
    hasStringProperty(value, "metadataDocumentId") &&
    hasNumberProperty(value, "metadataAccessEpoch") &&
    typeof metadataAccessStateHash === "string" &&
    metadataAccessStateHash.length > 0 &&
    hasArrayProperty(value, "metadataRecipientEncapsulationPublicKeys") &&
    value.metadataRecipientEncapsulationPublicKeys.every(
      (entry) => typeof entry === "string",
    ) &&
    (metadataReferencedPrincipals === undefined ||
      (Array.isArray(metadataReferencedPrincipals) &&
        metadataReferencedPrincipals.every(isReferencedPrincipalStateResponse)))
  );
}

export function isMoveContainerResponse(
  value: unknown,
): value is MoveContainerResponse {
  return isContainerSummary(value) && value.parentId !== null;
}

function isRecordArray(value: unknown): value is Record<string, unknown>[] {
  return Array.isArray(value) && value.every(isPlainObject);
}

function isAccessEventBundleResponse(
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
    hasStringProperty(value, "eventHash") &&
    value.eventHash.length > 0
  );
}

function isContainerV2ManifestBundleResponse(
  value: unknown,
): value is ContainerV2ManifestBundleResponse {
  const event = isPlainObject(value) ? Reflect.get(value, "event") : undefined;
  const manifest = isPlainObject(value)
    ? Reflect.get(value, "manifest")
    : undefined;
  const state = isPlainObject(value) ? Reflect.get(value, "state") : undefined;

  return (
    isPlainObject(value) &&
    isAccessEventBundleResponse(event) &&
    isPlainObject(manifest) &&
    hasStringProperty(value, "manifestHash") &&
    value.manifestHash.length > 0 &&
    isPlainObject(state)
  );
}

function isContainerV2KekResponse(
  value: unknown,
): value is ContainerV2KekResponse {
  const keyEpoch = isPlainObject(value)
    ? Reflect.get(value, "keyEpoch")
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
    isRecordArray(recipientTargets) &&
    recipientTargets.length > 0 &&
    isRecordArray(wraps) &&
    wraps.length > 0
  );
}

export function isContainerV2MutationResponse(
  value: unknown,
): value is ContainerV2MutationResponse {
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
    isContainerV2ManifestBundleResponse(accessManifest) &&
    isContainerV2KekResponse(containerKek) &&
    isRecordArray(referencedPrincipalHeads)
  );
}

export function isContainerV2WriterProjectionResponse(
  value: unknown,
): value is ContainerV2WriterProjectionResponse {
  return (
    isPlainObject(value) &&
    hasStringProperty(value, "containerId") &&
    hasStringProperty(value, "organizationId") &&
    hasArrayProperty(value, "path") &&
    value.path.length > 0 &&
    value.path.every(isContainerV2ManifestBundleResponse) &&
    hasArrayProperty(value, "containerKeks") &&
    value.containerKeks.length === value.path.length &&
    value.containerKeks.every(isContainerV2KekResponse)
  );
}
