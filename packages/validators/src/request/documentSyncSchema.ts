import { z } from "zod";
import { isPlainObject } from "../isPlainObject";
import {
  arraySchema,
  loosePlainObject,
  nonEmptyArraySchema,
  nonEmptyStringSchema,
  plainObjectSchema,
  positiveIntegerSchema,
} from "../schema";
import { isUuidV4String, isWalLsnString } from "../util";
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

export const DocumentOutgoingUpdateSchema = loosePlainObject({
  checkpointKind: z.literal("rotate_baseline").optional(),
  checkpointPayloadKind: z.literal("full_history_snapshot").optional(),
  encryptedData: nonEmptyStringSchema,
  id: z.string().refine(isUuidV4String),
  partialEndVersionVector: nonEmptyStringSchema,
  partialStartVersionVector: nonEmptyStringSchema,
  sourceVersionVector: nonEmptyStringSchema.optional(),
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

export type DocumentOutgoingUpdate = z.infer<
  typeof DocumentOutgoingUpdateSchema
>;

const ContainerMutationRequestSchema = z.custom<ContainerMutationRequest>(
  isContainerMutationRequest,
);

export const DocumentSyncRequestSchema = loosePlainObject({
  authorizingContainerPathRefs: ContainerManifestRefArrayArraySchema.optional(),
  containerRekeys: arraySchema(ContainerMutationRequestSchema).optional(),
  contentKeyBundle: DocumentContentKeyBundleRequestSchema.optional(),
  contentKeyEpoch: positiveIntegerSchema,
  expectedLinkSetManifestHash: nonEmptyStringSchema,
  expectedTargetHash: nonEmptyStringSchema,
  localVersionVector: z.string().nullable(),
  minLsn: z.string().refine(isWalLsnString).optional(),
  outgoingUpdates: arraySchema(DocumentOutgoingUpdateSchema),
}).superRefine((request, context) => {
  if (!Array.isArray(request.outgoingUpdates)) {
    return;
  }

  const hasOutgoingUpdates = request.outgoingUpdates.length > 0;

  if (
    request.authorizingContainerPathRefs === undefined &&
    hasOutgoingUpdates
  ) {
    context.addIssue({
      code: "custom",
      message: "authorizing container paths are required for outgoing updates",
      path: ["authorizingContainerPathRefs"],
    });
  }

  if ((request.containerRekeys?.length ?? 0) > 0 && !hasOutgoingUpdates) {
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
});

export type DocumentSyncRequest = z.infer<typeof DocumentSyncRequestSchema>;
