import { z } from "zod";
import {
  classifyDocumentSyncCheckpointFields,
  DOCUMENT_SYNC_CHECKPOINT_FIELD_SET_ISSUE_MESSAGE,
  DOCUMENT_SYNC_ROTATION_CHECKPOINT_KIND,
  DOCUMENT_SYNC_ROTATION_CHECKPOINT_PAYLOAD_KIND,
} from "../documentSyncCheckpoint";
import {
  documentSyncRequestEnvelopeRefinements,
  documentSyncRequestPullRefinements,
  documentSyncRequestRotationRefinement,
} from "../documentSyncRefinements";
import { classifyDocumentSyncRequestMode } from "../documentSyncRequestMode";
import { isPlainObject } from "../isPlainObject";
import {
  registerJsonSchemaFragment,
  registerJsonSchemaRuntimeRefinements,
  registerJsonSchemaView,
} from "../jsonSchema";
import {
  arraySchema,
  boundedNonEmptyArraySchema,
  boundedNonEmptyStringSchema,
  boundedStringSchema,
  loosePlainObject,
  nonEmptyStringSchema,
  plainObjectSchema,
  positiveIntegerSchema,
  requiredUnknownSchema,
} from "../schema";
import { AccessManifestBundleWireSchema } from "../util/accessManifestBundle";
import { MAX_INLINE_CONTAINER_REKEYS } from "../util/containerKekKeyringWire";
import {
  MAX_DOCUMENT_SYNC_AUTHORIZATION_PATH_DEPTH,
  MAX_DOCUMENT_SYNC_AUTHORIZATION_PATHS,
  MAX_DOCUMENT_SYNC_CONTENT_KEY_TARGETS,
  MAX_DOCUMENT_SYNC_OUTGOING_UPDATES,
  MAX_DOCUMENT_SYNC_PULL_CURSOR_LENGTH,
  MAX_DOCUMENT_SYNC_REQUEST_BYTES,
} from "../util/documentSyncLimits";
import { isUuidV4String, UUID_V4_PATTERN } from "../util/uuid";
import { isWalLsnString, WAL_LSN_PATTERN } from "../util/walLsn";
import {
  type ContainerMutationRequest,
  ContainerMutationRequestSchema,
} from "./container";

/**
 * A reference to a container access manifest the server already stores, in lieu
 * of re-embedding the full signed manifest bundle. The server resolves the full
 * manifest from its own store by `manifestHash` and pins it to the container's
 * current head, so the reference carries the same authority as the full bundle
 * without the multi-KB signature. `containerId` is advisory: the server keys the
 * head lookup off the resolved bundle's own containerId and rejects a mismatch.
 */
export const ContainerManifestRefSchema = loosePlainObject({
  containerId: nonEmptyStringSchema,
  manifestHash: nonEmptyStringSchema,
});

export type ContainerManifestRef = z.infer<typeof ContainerManifestRefSchema>;

export const ContainerManifestPathSchema = boundedNonEmptyArraySchema(
  ContainerManifestRefSchema,
  MAX_DOCUMENT_SYNC_AUTHORIZATION_PATH_DEPTH,
);

export const ContainerManifestRefArrayArraySchema = arraySchema(
  ContainerManifestPathSchema,
  MAX_DOCUMENT_SYNC_AUTHORIZATION_PATHS,
);

export const DocumentContentKeyTargetEnvelopeSchema = loosePlainObject({
  containerId: nonEmptyStringSchema,
  containerKeyEpoch: positiveIntegerSchema,
  containerKeyEpochId: nonEmptyStringSchema,
  containerManifestHash: nonEmptyStringSchema,
  wrappedKey: nonEmptyStringSchema,
  wrappingMetadata: plainObjectSchema,
});

export type DocumentContentKeyTargetEnvelope = z.infer<
  typeof DocumentContentKeyTargetEnvelopeSchema
>;

export const DocumentContentKeyBundleRequestSchema = loosePlainObject({
  contentKeyEpoch: positiveIntegerSchema,
  linkSetManifestHash: nonEmptyStringSchema,
  targetHash: nonEmptyStringSchema,
  targets: arraySchema(
    DocumentContentKeyTargetEnvelopeSchema,
    MAX_DOCUMENT_SYNC_CONTENT_KEY_TARGETS,
  ),
});

export type DocumentContentKeyBundleRequest = z.infer<
  typeof DocumentContentKeyBundleRequestSchema
>;

function createDocumentOutgoingUpdateSchema(
  encryptedDataSchema: z.ZodType<string>,
  versionVectorSchema: z.ZodType<string>,
) {
  return registerJsonSchemaRuntimeRefinements(
    loosePlainObject({
      checkpointKind: z
        .literal(DOCUMENT_SYNC_ROTATION_CHECKPOINT_KIND)
        .optional(),
      checkpointPayloadKind: z
        .literal(DOCUMENT_SYNC_ROTATION_CHECKPOINT_PAYLOAD_KIND)
        .optional(),
      encryptedData: encryptedDataSchema,
      id: registerJsonSchemaFragment(z.string().refine(isUuidV4String), {
        pattern: UUID_V4_PATTERN.source,
        type: "string",
      }),
      partialEndVersionVector: versionVectorSchema,
      partialStartVersionVector: versionVectorSchema,
      plaintextHash: nonEmptyStringSchema,
      sourceVersionVector: versionVectorSchema.optional(),
      writeHeader: plainObjectSchema,
    }).superRefine((update, context) => {
      if (classifyDocumentSyncCheckpointFields(update) === "invalid") {
        context.addIssue({
          code: "custom",
          message: DOCUMENT_SYNC_CHECKPOINT_FIELD_SET_ISSUE_MESSAGE,
        });
      }
    }),
    [documentSyncRequestRotationRefinement],
  );
}

// Link-set rotations may carry a full-history baseline that is larger than a
// single sync request. Their route has its own ingress policy, so keep the
// shared update contract unbounded and apply the sync-specific ceiling only
// where an update is embedded in DocumentSyncRequest.
export const DocumentOutgoingUpdateSchema = createDocumentOutgoingUpdateSchema(
  nonEmptyStringSchema,
  nonEmptyStringSchema,
);

const DocumentSyncOutgoingUpdateSchema = createDocumentOutgoingUpdateSchema(
  boundedNonEmptyStringSchema(MAX_DOCUMENT_SYNC_REQUEST_BYTES),
  boundedNonEmptyStringSchema(MAX_DOCUMENT_SYNC_REQUEST_BYTES),
);

export type DocumentOutgoingUpdate = z.infer<
  typeof DocumentOutgoingUpdateSchema
>;

// Document sync published container keyrings as opaque records before the
// canonical container-mutation schema described their fields. Keep that one
// existing OpenAPI view stable while runtime validation delegates to the shared
// schema used by newer operations.
const DocumentSyncContainerMutationRequestSchema = registerJsonSchemaView(
  z.custom<ContainerMutationRequest>(
    (value) => ContainerMutationRequestSchema.safeParse(value).success,
  ),
  z.looseObject({
    body: requiredUnknownSchema,
    containerManifestHistory: z
      .array(AccessManifestBundleWireSchema)
      .optional(),
    destinationParentContainerPath: z
      .array(AccessManifestBundleWireSchema)
      .optional(),
    event: plainObjectSchema,
    expectedManifestHash: nonEmptyStringSchema,
    keyEpoch: plainObjectSchema,
    keyring: plainObjectSchema.nullable(),
    manifest: plainObjectSchema,
    parentContainerPath: z.array(AccessManifestBundleWireSchema).optional(),
    parentKekState: plainObjectSchema.nullable().optional(),
    predecessorBridge: plainObjectSchema.nullable(),
    previousContainerPath: z.array(AccessManifestBundleWireSchema).optional(),
    previousManifest: AccessManifestBundleWireSchema.nullable().optional(),
    principalPolicies: z.array(plainObjectSchema),
    userRecipientKeys: z.array(plainObjectSchema).optional(),
    wraps: z.array(plainObjectSchema),
  }),
);

const WalLsnSchema = registerJsonSchemaFragment(
  z.string().refine(isWalLsnString),
  { pattern: WAL_LSN_PATTERN.source, type: "string" },
);

export const DocumentSyncRequestSchema = registerJsonSchemaRuntimeRefinements(
  loosePlainObject({
    authorizingContainerPathRefs:
      ContainerManifestRefArrayArraySchema.optional(),
    // Each rotation carries a keyring sized by its epoch, so the batch is
    // bounded here as well as in the runtime guard.
    containerRekeys: arraySchema(
      DocumentSyncContainerMutationRequestSchema,
      MAX_INLINE_CONTAINER_REKEYS,
    ).optional(),
    contentKeyBundle: DocumentContentKeyBundleRequestSchema.optional(),
    contentKeyEpoch: positiveIntegerSchema,
    expectedLinkSetManifestHash: nonEmptyStringSchema,
    expectedTargetHash: nonEmptyStringSchema,
    localVersionVector: boundedStringSchema(
      MAX_DOCUMENT_SYNC_REQUEST_BYTES,
    ).nullable(),
    minLsn: WalLsnSchema.optional(),
    outgoingUpdates: arraySchema(
      DocumentSyncOutgoingUpdateSchema,
      MAX_DOCUMENT_SYNC_OUTGOING_UPDATES,
    ),
    pullCursor: boundedNonEmptyStringSchema(
      MAX_DOCUMENT_SYNC_PULL_CURSOR_LENGTH,
    ).optional(),
    supportsPullPagination: z.literal(true),
    supportsUntrackedCommitLsn: z.literal(true).optional(),
  }).superRefine((request, context) => {
    if (!Array.isArray(request.outgoingUpdates)) {
      return;
    }
    // The field schemas have already recorded their cardinality errors. Do
    // not let the cross-field checks below rescan attacker-sized arrays after
    // those bounded schemas deliberately stopped before item validation.
    if (request.outgoingUpdates.length > MAX_DOCUMENT_SYNC_OUTGOING_UPDATES) {
      return;
    }
    if (
      Array.isArray(request.authorizingContainerPathRefs) &&
      request.authorizingContainerPathRefs.length >
        MAX_DOCUMENT_SYNC_AUTHORIZATION_PATHS
    ) {
      return;
    }

    const hasOutgoingUpdates = request.outgoingUpdates.length > 0;
    if (
      request.pullCursor !== undefined &&
      (hasOutgoingUpdates ||
        (request.containerRekeys?.length ?? 0) > 0 ||
        request.contentKeyBundle !== undefined ||
        request.authorizingContainerPathRefs !== undefined)
    ) {
      context.addIssue({
        code: "custom",
        message: "continued pulls must be read-only",
        path: ["pullCursor"],
      });
    }
    const requestMode = classifyDocumentSyncRequestMode({
      authorizingContainerPathRefsPresent:
        request.authorizingContainerPathRefs !== undefined,
      hasContainerRekeys: (request.containerRekeys?.length ?? 0) > 0,
      hasOutgoingUpdates,
    });

    if (requestMode === "invalid-authorizing-path-refs-absent") {
      context.addIssue({
        code: "custom",
        message:
          "authorizing container paths are required for outgoing updates",
        path: ["authorizingContainerPathRefs"],
      });
    }

    if (requestMode === "invalid-rekeys-without-write") {
      context.addIssue({
        code: "custom",
        message: "container rekeys require an outgoing update",
        path: ["containerRekeys"],
      });
    }

    if (
      new Set(
        request.outgoingUpdates
          .filter(isPlainObject)
          .map((update) => Reflect.get(update, "id")),
      ).size !== request.outgoingUpdates.length
    ) {
      context.addIssue({
        code: "custom",
        message: "outgoing update ids must be unique",
        path: ["outgoingUpdates"],
      });
    }
  }),
  [
    ...documentSyncRequestEnvelopeRefinements,
    ...documentSyncRequestPullRefinements,
  ],
);

export type DocumentSyncRequest = z.infer<typeof DocumentSyncRequestSchema>;
