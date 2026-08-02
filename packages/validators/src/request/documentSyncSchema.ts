import { z } from "zod";
import {
  classifyDocumentSyncCheckpointFields,
  DOCUMENT_SYNC_CHECKPOINT_FIELD_SET_ISSUE_MESSAGE,
  DOCUMENT_SYNC_ROTATION_CHECKPOINT_KIND,
  DOCUMENT_SYNC_ROTATION_CHECKPOINT_PAYLOAD_KIND,
} from "../documentSyncCheckpoint";
import {
  documentSyncRequestEnvelopeRefinements,
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
  loosePlainObject,
  nonEmptyArraySchema,
  nonEmptyStringSchema,
  plainObjectSchema,
  positiveIntegerSchema,
} from "../schema";
import { isUuidV4String, UUID_V4_PATTERN } from "../util/uuid";
import { isWalLsnString, WAL_LSN_PATTERN } from "../util/walLsn";
import {
  type ContainerMutationRequest,
  isContainerMutationRequest,
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

const ContainerManifestPathSchema = nonEmptyArraySchema(
  ContainerManifestRefSchema,
);

export const ContainerManifestRefArrayArraySchema = arraySchema(
  ContainerManifestPathSchema,
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
  targets: arraySchema(DocumentContentKeyTargetEnvelopeSchema),
});

export type DocumentContentKeyBundleRequest = z.infer<
  typeof DocumentContentKeyBundleRequestSchema
>;

export const DocumentOutgoingUpdateSchema =
  registerJsonSchemaRuntimeRefinements(
    loosePlainObject({
      checkpointKind: z
        .literal(DOCUMENT_SYNC_ROTATION_CHECKPOINT_KIND)
        .optional(),
      checkpointPayloadKind: z
        .literal(DOCUMENT_SYNC_ROTATION_CHECKPOINT_PAYLOAD_KIND)
        .optional(),
      encryptedData: nonEmptyStringSchema,
      id: registerJsonSchemaFragment(z.string().refine(isUuidV4String), {
        pattern: UUID_V4_PATTERN.source,
        type: "string",
      }),
      partialEndVersionVector: nonEmptyStringSchema,
      partialStartVersionVector: nonEmptyStringSchema,
      plaintextHash: nonEmptyStringSchema,
      sourceVersionVector: nonEmptyStringSchema.optional(),
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

export type DocumentOutgoingUpdate = z.infer<
  typeof DocumentOutgoingUpdateSchema
>;

const AccessManifestBundleWireViewSchema = loosePlainObject({
  event: plainObjectSchema,
  manifest: plainObjectSchema,
  manifestHash: nonEmptyStringSchema,
  state: plainObjectSchema,
});

const ContainerMutationRequestViewSchema = loosePlainObject({
  body: z.unknown(),
  containerManifestHistory: z
    .array(AccessManifestBundleWireViewSchema)
    .optional(),
  destinationParentContainerPath: z
    .array(AccessManifestBundleWireViewSchema)
    .optional(),
  event: plainObjectSchema,
  expectedManifestHash: nonEmptyStringSchema,
  keyEpoch: plainObjectSchema,
  keyring: plainObjectSchema.nullable(),
  manifest: plainObjectSchema,
  parentContainerPath: z.array(AccessManifestBundleWireViewSchema).optional(),
  parentKekState: plainObjectSchema.nullable().optional(),
  predecessorBridge: plainObjectSchema.nullable(),
  previousContainerPath: z.array(AccessManifestBundleWireViewSchema).optional(),
  previousManifest: AccessManifestBundleWireViewSchema.nullable().optional(),
  principalPolicies: z.array(plainObjectSchema),
  userRecipientKeys: z.array(plainObjectSchema).optional(),
  wraps: z.array(plainObjectSchema),
});

const ContainerMutationRequestSchema = registerJsonSchemaView(
  z.custom<ContainerMutationRequest>(isContainerMutationRequest),
  ContainerMutationRequestViewSchema,
);

const WalLsnSchema = registerJsonSchemaFragment(
  z.string().refine(isWalLsnString),
  { pattern: WAL_LSN_PATTERN.source, type: "string" },
);

export const DocumentSyncRequestSchema = registerJsonSchemaRuntimeRefinements(
  loosePlainObject({
    authorizingContainerPathRefs:
      ContainerManifestRefArrayArraySchema.optional(),
    containerRekeys: arraySchema(ContainerMutationRequestSchema).optional(),
    contentKeyBundle: DocumentContentKeyBundleRequestSchema.optional(),
    contentKeyEpoch: positiveIntegerSchema,
    expectedLinkSetManifestHash: nonEmptyStringSchema,
    expectedTargetHash: nonEmptyStringSchema,
    localVersionVector: z.string().nullable(),
    minLsn: WalLsnSchema.optional(),
    outgoingUpdates: arraySchema(DocumentOutgoingUpdateSchema),
  }).superRefine((request, context) => {
    if (!Array.isArray(request.outgoingUpdates)) {
      return;
    }

    const hasOutgoingUpdates = request.outgoingUpdates.length > 0;
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
  documentSyncRequestEnvelopeRefinements,
);

export type DocumentSyncRequest = z.infer<typeof DocumentSyncRequestSchema>;
