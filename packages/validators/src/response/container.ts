import type { ContainerSystemSlot } from "../containerSystemSlot";
import { isNullableContainerSystemSlot } from "../containerSystemSlot";
import { isPlainObject } from "../isPlainObject";
import {
  type AccessManifestBundleWireResponse,
  hasArrayProperty,
  hasNullableStringProperty,
  hasNumberProperty,
  hasStringProperty,
  isAccessManifestBundleWireResponse,
  isContainerKekKeyringWireRecord,
  isRecordArray,
} from "../util";
import {
  type EffectiveAccessLevel,
  isEffectiveAccessLevel,
} from "./accessLevel";
import {
  isReferencedPrincipalStateResponse,
  type ReferencedPrincipalStateResponse,
} from "./principal";
import { isSyncWatermark, type SyncWatermark } from "./syncWatermark";

/**
 * The container's sealed predecessor key history. Opening it under the
 * current KEK yields every retained historical KEK in one decrypt; the
 * bridge log behind it is served only by the rebuild read path.
 */
export interface ContainerKekKeyringWireResponse {
  version: number;
  sealingSuite: string;
  containerId: string;
  containerKeyEpochId: string;
  iv: string;
  sealed: string;
}

/**
 * A historical epoch record shipped only when an entry in the served path
 * pins it as `parentContainerKeyEpochId`; content-key envelopes need no
 * epoch record, so history stays off the hot wire otherwise.
 */
export interface HistoricalContainerKeyEpochResponse {
  accessManifestHash: string;
  containerId: string;
  containerKeyEpoch: number;
  containerKeyEpochId: string;
  keyEpoch: Record<string, unknown>;
  keyEpochHash: string;
  parentContainerKeyEpochId: string | null;
}

export interface ContainerKekResponse {
  containerId: string;
  accessManifestHash: string;
  containerKeyEpochId: string;
  containerKeyEpoch: number;
  /** Null exactly when `containerKeyEpoch` is 1. */
  keyring: ContainerKekKeyringWireResponse | null;
  historicalKeyEpochs: HistoricalContainerKeyEpochResponse[];
  keyEpoch: Record<string, unknown>;
  keyEpochHash: string;
  keyTargetHash: string;
  parentContainerKeyEpochId: string | null;
  containerManifestHistory: AccessManifestBundleWireResponse[];
  recipientTargets: Record<string, unknown>[];
  wraps: Record<string, unknown>[];
}

function isContainerKekKeyringWireResponse(
  value: unknown,
): value is ContainerKekKeyringWireResponse {
  return isContainerKekKeyringWireRecord(value);
}

function isHistoricalContainerKeyEpochResponse(
  value: unknown,
): value is HistoricalContainerKeyEpochResponse {
  const keyEpoch = isPlainObject(value)
    ? Reflect.get(value, "keyEpoch")
    : undefined;

  return (
    isPlainObject(value) &&
    hasStringProperty(value, "accessManifestHash") &&
    value.accessManifestHash.length > 0 &&
    hasStringProperty(value, "containerId") &&
    value.containerId.length > 0 &&
    hasNumberProperty(value, "containerKeyEpoch") &&
    Number.isInteger(value.containerKeyEpoch) &&
    value.containerKeyEpoch > 0 &&
    hasStringProperty(value, "containerKeyEpochId") &&
    value.containerKeyEpochId.length > 0 &&
    isPlainObject(keyEpoch) &&
    hasStringProperty(value, "keyEpochHash") &&
    value.keyEpochHash.length > 0 &&
    hasNullableStringProperty(value, "parentContainerKeyEpochId")
  );
}

/**
 * The append-only rotation log for one container: every epoch with its
 * write-once bridge and sealed keyring. This is the rebuild/repair read
 * path — hot reads use the projection keyring instead.
 */
export interface ContainerKekLogEpochResponse {
  accessManifestHash: string;
  bridge: Record<string, unknown> | null;
  containerKeyEpoch: number;
  containerKeyEpochId: string;
  keyring: ContainerKekKeyringWireResponse | null;
  parentContainerKeyEpochId: string | null;
}

export interface ContainerKekLogResponse {
  containerId: string;
  epochs: ContainerKekLogEpochResponse[];
}

function isContainerKekLogEpochResponse(
  value: unknown,
): value is ContainerKekLogEpochResponse {
  const bridge = isPlainObject(value)
    ? Reflect.get(value, "bridge")
    : undefined;
  const keyring = isPlainObject(value)
    ? Reflect.get(value, "keyring")
    : undefined;

  return (
    isPlainObject(value) &&
    hasStringProperty(value, "accessManifestHash") &&
    value.accessManifestHash.length > 0 &&
    Reflect.has(value, "bridge") &&
    (bridge === null || isPlainObject(bridge)) &&
    hasNumberProperty(value, "containerKeyEpoch") &&
    Number.isInteger(value.containerKeyEpoch) &&
    value.containerKeyEpoch > 0 &&
    hasStringProperty(value, "containerKeyEpochId") &&
    value.containerKeyEpochId.length > 0 &&
    Reflect.has(value, "keyring") &&
    (keyring === null || isContainerKekKeyringWireResponse(keyring)) &&
    hasNullableStringProperty(value, "parentContainerKeyEpochId")
  );
}

export function isContainerKekLogResponse(
  value: unknown,
): value is ContainerKekLogResponse {
  const epochs = isPlainObject(value)
    ? Reflect.get(value, "epochs")
    : undefined;

  return (
    isPlainObject(value) &&
    hasStringProperty(value, "containerId") &&
    value.containerId.length > 0 &&
    Array.isArray(epochs) &&
    epochs.every(isContainerKekLogEpochResponse)
  );
}

export interface ContainerMutationResponse {
  systemSlot?: ContainerSystemSlot | null;
  containerId: string;
  createdAt: string;
  organizationId: string;
  parentId: string | null;
  updatedAt: string;
  manifestHead: {
    epoch: number;
    manifestHash: string;
  };
  accessManifest: AccessManifestBundleWireResponse;
  containerKek: ContainerKekResponse;
  referencedPrincipalHeads: ReferencedPrincipalStateResponse[];
}

export interface ContainerDeleteResponse {
  containerId: string;
  deletedAt: string;
}

export interface ContainerWriterProjectionResponse {
  containerId: string;
  organizationId: string;
  path: AccessManifestBundleWireResponse[];
  containerKeks: ContainerKekResponse[];
}

export interface ContainerSummary {
  systemSlot?: ContainerSystemSlot | null;
  createdAt: string;
  depth: number;
  effectiveAccessLevel: EffectiveAccessLevel;
  id: string;
  organizationId: string;
  parentId: string | null;
  metadataDocumentId: string;
  metadataAccessEpoch: number;
  metadataAccessStateHash: string;
  metadataReferencedPrincipals: ReferencedPrincipalStateResponse[];
  updatedAt: string;
}

export interface ContainerSyncTombstone {
  containerId: string;
  depth: number;
  parentId: string | null;
  reason: "access_revoked" | "deleted";
  updatedAt: string;
}

export interface ListContainersResponse {
  hasMore: boolean;
  items: ContainerSummary[];
  nextWatermark: SyncWatermark | null;
  tombstones: ContainerSyncTombstone[];
}

function isContainerSummary(value: unknown): value is ContainerSummary {
  const metadataReferencedPrincipals = isPlainObject(value)
    ? Reflect.get(value, "metadataReferencedPrincipals")
    : undefined;
  const metadataAccessStateHash = isPlainObject(value)
    ? Reflect.get(value, "metadataAccessStateHash")
    : undefined;
  const systemSlot = isPlainObject(value)
    ? Reflect.get(value, "systemSlot")
    : undefined;

  return (
    isPlainObject(value) &&
    (systemSlot === undefined || isNullableContainerSystemSlot(systemSlot)) &&
    hasStringProperty(value, "createdAt") &&
    hasNumberProperty(value, "depth") &&
    Number.isInteger(value.depth) &&
    value.depth >= 0 &&
    isEffectiveAccessLevel(Reflect.get(value, "effectiveAccessLevel")) &&
    hasStringProperty(value, "id") &&
    hasStringProperty(value, "organizationId") &&
    hasNullableStringProperty(value, "parentId") &&
    hasStringProperty(value, "metadataDocumentId") &&
    hasNumberProperty(value, "metadataAccessEpoch") &&
    typeof metadataAccessStateHash === "string" &&
    metadataAccessStateHash.length > 0 &&
    hasStringProperty(value, "updatedAt") &&
    Array.isArray(metadataReferencedPrincipals) &&
    metadataReferencedPrincipals.every(isReferencedPrincipalStateResponse)
  );
}

function isContainerSyncTombstone(
  value: unknown,
): value is ContainerSyncTombstone {
  const reason = isPlainObject(value)
    ? Reflect.get(value, "reason")
    : undefined;

  return (
    isPlainObject(value) &&
    hasStringProperty(value, "containerId") &&
    hasNumberProperty(value, "depth") &&
    Number.isInteger(value.depth) &&
    value.depth >= 0 &&
    hasNullableStringProperty(value, "parentId") &&
    (reason === "access_revoked" || reason === "deleted") &&
    hasStringProperty(value, "updatedAt")
  );
}

export function isListContainersResponse(
  value: unknown,
): value is ListContainersResponse {
  const nextWatermark = isPlainObject(value)
    ? Reflect.get(value, "nextWatermark")
    : undefined;

  return (
    isPlainObject(value) &&
    typeof Reflect.get(value, "hasMore") === "boolean" &&
    hasArrayProperty(value, "items") &&
    value.items.every(isContainerSummary) &&
    (isSyncWatermark(nextWatermark) || nextWatermark === null) &&
    hasArrayProperty(value, "tombstones") &&
    value.tombstones.every(isContainerSyncTombstone)
  );
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
  const keyring = isPlainObject(value)
    ? Reflect.get(value, "keyring")
    : undefined;
  const historicalKeyEpochs = isPlainObject(value)
    ? Reflect.get(value, "historicalKeyEpochs")
    : undefined;

  return (
    isPlainObject(value) &&
    Reflect.has(value, "keyring") &&
    (keyring === null || isContainerKekKeyringWireResponse(keyring)) &&
    Array.isArray(historicalKeyEpochs) &&
    historicalKeyEpochs.every(isHistoricalContainerKeyEpochResponse) &&
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
    Array.isArray(containerManifestHistory) &&
    containerManifestHistory.every(isAccessManifestBundleWireResponse) &&
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
    hasStringProperty(value, "createdAt") &&
    hasStringProperty(value, "organizationId") &&
    hasNullableStringProperty(value, "parentId") &&
    hasStringProperty(value, "updatedAt") &&
    isPlainObject(manifestHead) &&
    hasNumberProperty(manifestHead, "epoch") &&
    hasStringProperty(manifestHead, "manifestHash") &&
    isAccessManifestBundleWireResponse(accessManifest) &&
    isContainerKekResponse(containerKek) &&
    Array.isArray(referencedPrincipalHeads) &&
    referencedPrincipalHeads.every(isReferencedPrincipalStateResponse)
  );
}

export function isContainerDeleteResponse(
  value: unknown,
): value is ContainerDeleteResponse {
  return (
    isPlainObject(value) &&
    hasStringProperty(value, "containerId") &&
    hasStringProperty(value, "deletedAt")
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
