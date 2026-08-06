import { z } from "zod";
import {
  type ContainerSystemSlot,
  ContainerSystemSlotSchema,
  isNullableContainerSystemSlot,
} from "../containerSystemSlot";
import { isPlainObject } from "../isPlainObject";
import { registerJsonSchemaRuntimeRefinements } from "../jsonSchema";
import { organizationProvisioningContainerKeyringRefinement } from "../organizationProvisioningRefinements";
import {
  arraySchema,
  loosePlainObject,
  nonEmptyArraySchema,
  nonEmptyStringSchema,
  plainObjectSchema,
  positiveIntegerSchema,
} from "../schema";
import {
  type AccessManifestBundleWireResponse,
  AccessManifestBundleWireResponseSchema,
  CONTAINER_KEK_LOG_PAGE_LIMIT,
  CONTAINER_KEK_WRAPS_PER_EPOCH_LIMIT,
  ContainerKekKeyringWireRecordSchema,
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
  ReferencedPrincipalStateResponseSchema,
} from "./principal";
import { isSyncWatermark, type SyncWatermark } from "./syncWatermark";

/**
 * The container's sealed predecessor key history. Opening it under the
 * current KEK yields every retained historical KEK in one decrypt; the
 * bridge log behind it is served only by the rebuild read path.
 */
export const ContainerKekKeyringWireResponseSchema =
  ContainerKekKeyringWireRecordSchema;

export type ContainerKekKeyringWireResponse = z.infer<
  typeof ContainerKekKeyringWireResponseSchema
>;

const containerKekResponseShape = {
  accessManifestHash: nonEmptyStringSchema,
  containerId: z.string(),
  containerKeyEpoch: positiveIntegerSchema,
  containerKeyEpochId: nonEmptyStringSchema,
  containerManifestHistory: arraySchema(AccessManifestBundleWireResponseSchema),
  keyEpoch: plainObjectSchema,
  keyEpochHash: nonEmptyStringSchema,
  keyring: ContainerKekKeyringWireResponseSchema.nullable(),
  keyTargetHash: nonEmptyStringSchema,
  parentContainerKeyEpochId: z.string().nullable(),
  recipientTargets: nonEmptyArraySchema(plainObjectSchema),
  wraps: nonEmptyArraySchema(plainObjectSchema),
};

export const ContainerKekResponseSchema = registerJsonSchemaRuntimeRefinements(
  loosePlainObject(containerKekResponseShape).superRefine((value, context) => {
    if ((value.keyring === null) !== (value.containerKeyEpoch === 1)) {
      context.addIssue({
        code: "custom",
        message: "container keyring must be null exactly at epoch 1",
        path: ["keyring"],
      });
    }
  }),
  [organizationProvisioningContainerKeyringRefinement],
);

export type ContainerKekResponse = z.infer<typeof ContainerKekResponseSchema>;

function isContainerKekKeyringWireResponse(
  value: unknown,
): value is ContainerKekKeyringWireResponse {
  return isContainerKekKeyringWireRecord(value);
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
  /**
   * The epoch's retained recipient envelopes — the identity-key recovery
   * backstop when a bridge below the current epoch is severed. Cross-epoch
   * wraps are never deleted, so a member present at this epoch can recover
   * its KEK from their own wrap independent of every later rotation.
   */
  wraps: Record<string, unknown>[];
}

export interface ContainerKekLogResponse {
  containerId: string;
  epochs: ContainerKekLogEpochResponse[];
  /** True when epochs above this page's last remain unserved. */
  hasMore: boolean;
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
    hasNullableStringProperty(value, "parentContainerKeyEpochId") &&
    isRecordArray(Reflect.get(value, "wraps"))
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
    typeof Reflect.get(value, "hasMore") === "boolean" &&
    Array.isArray(epochs) &&
    epochs.length <= CONTAINER_KEK_LOG_PAGE_LIMIT &&
    epochs.every(isContainerKekLogEpochResponse) &&
    // The same bounds the server applies, re-checked on the way in. A guard
    // that accepted an unbounded page would let a hostile or buggy server
    // hand back arbitrarily many envelopes and multi-megabyte keyrings, and
    // the recovery walk would do the work before anything noticed.
    epochs.every(
      (epoch: ContainerKekLogEpochResponse) =>
        epoch.wraps.length <= CONTAINER_KEK_WRAPS_PER_EPOCH_LIMIT,
    ) &&
    // At most one keyring per page: they are O(their epoch) bytes, so the
    // endpoint serves exactly the one asked for.
    epochs.filter(
      (epoch: ContainerKekLogEpochResponse) => epoch.keyring !== null,
    ).length <= 1
  );
}

export const ContainerMutationResponseSchema = loosePlainObject({
  accessManifest: AccessManifestBundleWireResponseSchema,
  containerId: z.string(),
  containerKek: ContainerKekResponseSchema,
  createdAt: z.string(),
  manifestHead: loosePlainObject({
    epoch: z.number(),
    manifestHash: z.string(),
  }),
  organizationId: z.string(),
  parentId: z.string().nullable(),
  referencedPrincipalHeads: arraySchema(ReferencedPrincipalStateResponseSchema),
  systemSlot: ContainerSystemSlotSchema.nullable().optional(),
  updatedAt: z.string(),
});

export type ContainerMutationResponse = z.infer<
  typeof ContainerMutationResponseSchema
>;

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
  return ContainerKekResponseSchema.safeParse(value).success;
}

export function isContainerMutationResponse(
  value: unknown,
): value is ContainerMutationResponse {
  return ContainerMutationResponseSchema.safeParse(value).success;
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
