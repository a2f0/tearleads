import { z } from "zod";
import {
  classifyDocumentSyncCheckpointFields,
  DOCUMENT_SYNC_CHECKPOINT_FIELD_SET_ISSUE_MESSAGE,
  DOCUMENT_SYNC_ROTATION_CHECKPOINT_KIND,
  DOCUMENT_SYNC_ROTATION_CHECKPOINT_PAYLOAD_KIND,
} from "../documentSyncCheckpoint";
import {
  documentSyncResponseCommitLsnModeRefinement,
  documentSyncResponseCommitLsnSentinelRefinement,
  documentSyncResponsePullPageRefinement,
  documentSyncResponseRotationRefinement,
} from "../documentSyncRefinements";
import { registerJsonSchemaRuntimeRefinements } from "../jsonSchema";
import {
  arraySchema,
  boundedNonEmptyStringSchema,
  loosePlainObject,
  nonEmptyArraySchema,
  nonEmptyStringSchema,
  plainObjectSchema,
  positiveIntegerSchema,
} from "../schema";
import {
  MAX_DOCUMENT_SYNC_OUTGOING_UPDATES,
  MAX_DOCUMENT_SYNC_PULL_CURSOR_LENGTH,
} from "../util/documentSyncLimits";

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

const DocumentContentKeyTargetResponseSchema = loosePlainObject({
  containerId: nonEmptyStringSchema,
  containerKeyEpoch: positiveIntegerSchema,
  containerKeyEpochId: nonEmptyStringSchema,
  containerManifestHash: nonEmptyStringSchema,
});

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

export const DocumentSyncUpdateResponseSchema =
  registerJsonSchemaRuntimeRefinements(
    loosePlainObject({
      accessEpoch: positiveIntegerSchema,
      authorizationTargets: nonEmptyArraySchema(
        DocumentContentKeyTargetResponseSchema,
      ).optional(),
      authorFingerprint: z.string(),
      checkpointKind: z
        .literal(DOCUMENT_SYNC_ROTATION_CHECKPOINT_KIND)
        .optional(),
      checkpointPayloadKind: z
        .literal(DOCUMENT_SYNC_ROTATION_CHECKPOINT_PAYLOAD_KIND)
        .optional(),
      createdAt: z.string(),
      documentId: z.string(),
      encryptedData: z.string(),
      id: z.string(),
      partialEndVersionVector: z.string(),
      partialStartVersionVector: z.string(),
      plaintextHash: nonEmptyStringSchema,
      sourceVersionVector: z.string().min(1).optional(),
      writeHeader: plainObjectSchema,
    }).superRefine((update, context) => {
      if (classifyDocumentSyncCheckpointFields(update) === "invalid") {
        context.addIssue({
          code: "custom",
          message: DOCUMENT_SYNC_CHECKPOINT_FIELD_SET_ISSUE_MESSAGE,
        });
      }
    }),
    [documentSyncResponseRotationRefinement],
  );

export type DocumentSyncUpdateResponse = z.infer<
  typeof DocumentSyncUpdateResponseSchema
>;

export const DocumentSyncPullPageResponseSchema = loosePlainObject({
  hasMore: z.boolean(),
  nextCursor: boundedNonEmptyStringSchema(
    MAX_DOCUMENT_SYNC_PULL_CURSOR_LENGTH,
  ).nullable(),
});

export type DocumentSyncPullPageResponse = z.infer<
  typeof DocumentSyncPullPageResponseSchema
>;

export const DocumentSyncResponseSchema = registerJsonSchemaRuntimeRefinements(
  loosePlainObject({
    acceptedOutgoingUpdateIds: arraySchema(
      z.string(),
      MAX_DOCUMENT_SYNC_OUTGOING_UPDATES,
    ),
    commitLsn: z.string().nullable(),
    commitLsnMode: z
      .union([z.literal("tracked"), z.literal("untracked")])
      .optional(),
    contentKeyBundle: DocumentContentKeyBundleResponseSchema,
    contentKeyBundles: arraySchema(DocumentContentKeyBundleResponseSchema),
    documentId: z.string(),
    documentKekTargets: DocumentKekTargetsResponseSchema,
    pullPage: DocumentSyncPullPageResponseSchema.optional(),
    updates: arraySchema(DocumentSyncUpdateResponseSchema),
  }).superRefine((response, context) => {
    if (
      response.pullPage !== undefined &&
      response.pullPage.hasMore !== (response.pullPage.nextCursor !== null)
    ) {
      context.addIssue({
        code: "custom",
        message: "pull page continuation does not match hasMore",
        path: ["pullPage", "nextCursor"],
      });
    }
    if (
      response.commitLsnMode === "untracked" &&
      response.commitLsn !== "0/0"
    ) {
      context.addIssue({
        code: "custom",
        message: "untracked commit LSN must use the 0/0 sentinel",
        path: ["commitLsn"],
      });
    }
    if (
      response.commitLsn === "0/0" &&
      response.commitLsnMode !== "untracked"
    ) {
      context.addIssue({
        code: "custom",
        message: "0/0 commit LSN must be declared untracked",
        path: ["commitLsnMode"],
      });
    }
  }),
  [
    documentSyncResponseCommitLsnModeRefinement,
    documentSyncResponseCommitLsnSentinelRefinement,
    documentSyncResponsePullPageRefinement,
  ],
);

export type DocumentSyncResponse = z.infer<typeof DocumentSyncResponseSchema>;
