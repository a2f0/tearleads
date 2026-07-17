import { z } from "zod";
import {
  arraySchema,
  loosePlainObject,
  nonEmptyArraySchema,
  nonEmptyStringSchema,
  plainObjectSchema,
  positiveIntegerSchema,
} from "../schema";

export const DocumentContentKeyTargetEnvelopeResponseSchema = loosePlainObject({
  containerId: nonEmptyStringSchema,
  containerKeyEpoch: positiveIntegerSchema,
  containerKeyEpochId: nonEmptyStringSchema,
  containerManifestHash: nonEmptyStringSchema,
  wrappedKey: nonEmptyStringSchema,
  wrappingMetadata: plainObjectSchema,
});

export type DocumentContentKeyTargetEnvelopeResponse = z.infer<
  typeof DocumentContentKeyTargetEnvelopeResponseSchema
>;

export const DocumentKekTargetsResponseSchema = loosePlainObject({
  documentId: z.string(),
  documentKeyTargetHash: nonEmptyStringSchema,
  linkedContainerKeyEpochIds: nonEmptyArraySchema(nonEmptyStringSchema),
  linkedContainerManifestHashes: nonEmptyArraySchema(nonEmptyStringSchema),
  linkSetManifestHash: nonEmptyStringSchema,
  targets: nonEmptyArraySchema(plainObjectSchema),
});

export type DocumentKekTargetsResponse = z.infer<
  typeof DocumentKekTargetsResponseSchema
>;

export const DocumentContentKeyBundleResponseSchema = loosePlainObject({
  contentKeyEpoch: positiveIntegerSchema,
  documentId: z.string(),
  linkSetManifestHash: nonEmptyStringSchema,
  targetHash: nonEmptyStringSchema,
  targets: nonEmptyArraySchema(DocumentContentKeyTargetEnvelopeResponseSchema),
});

export type DocumentContentKeyBundleResponse = z.infer<
  typeof DocumentContentKeyBundleResponseSchema
>;

export const DocumentSyncUpdateResponseSchema = loosePlainObject({
  accessEpoch: positiveIntegerSchema,
  authorFingerprint: z.string(),
  checkpointKind: z.literal("rotate_baseline").optional(),
  checkpointPayloadKind: z.literal("full_history_snapshot").optional(),
  createdAt: z.string(),
  documentId: z.string(),
  encryptedData: z.string(),
  id: z.string(),
  partialEndVersionVector: z.string(),
  partialStartVersionVector: z.string(),
  sourceVersionVector: z.string().min(1).optional(),
  writeHeader: plainObjectSchema,
}).superRefine((update, context) => {
  const hasNoCheckpoint =
    update.checkpointKind === undefined &&
    update.checkpointPayloadKind === undefined &&
    update.sourceVersionVector === undefined;
  const hasRotationCheckpoint =
    update.checkpointKind === "rotate_baseline" &&
    update.checkpointPayloadKind === "full_history_snapshot" &&
    update.sourceVersionVector !== undefined;

  if (!hasNoCheckpoint && !hasRotationCheckpoint) {
    context.addIssue({
      code: "custom",
      message: "checkpoint fields must be absent or form a rotation baseline",
    });
  }
});

export type DocumentSyncUpdateResponse = z.infer<
  typeof DocumentSyncUpdateResponseSchema
>;

export const DocumentSyncResponseSchema = loosePlainObject({
  acceptedOutgoingUpdateIds: arraySchema(z.string()),
  commitLsn: z.string().nullable(),
  contentKeyBundle: DocumentContentKeyBundleResponseSchema,
  contentKeyBundles: arraySchema(DocumentContentKeyBundleResponseSchema),
  documentId: z.string(),
  documentKekTargets: DocumentKekTargetsResponseSchema,
  updates: arraySchema(DocumentSyncUpdateResponseSchema),
});

export type DocumentSyncResponse = z.infer<typeof DocumentSyncResponseSchema>;
