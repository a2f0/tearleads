import type { z } from "zod";
import { ContainerSystemSlotSchema } from "../containerSystemSlot";
import { containerCreateMetadataSeedRefinement } from "../documentCreateSeedRefinements";
import { registerJsonSchemaRuntimeRefinements } from "../jsonSchema";
import { loosePlainObject } from "../schema";
import { ContainerMutationRequestSchema } from "./container";
import {
  DocumentCreateBaseRequestSchema,
  DocumentSyncRequestSchema,
} from "./document";
import {
  refineSeedWithinSyncRequestLimit,
  refineSingleUpdateSeed,
} from "./documentCreateSeed";

export const containerCreateWithMetadataDocumentRequestShape = {
  container: ContainerMutationRequestSchema,
  metadataDocument: DocumentCreateBaseRequestSchema,
  systemSlot: ContainerSystemSlotSchema.nullable().optional(),
};

/**
 * The optional seed is the metadata document's first queued update, committed
 * in the create transaction exactly as organization provisioning commits a
 * system container's metadata seed.
 */
export const ContainerCreateWithMetadataDocumentRequestSchema =
  registerJsonSchemaRuntimeRefinements(
    loosePlainObject({
      ...containerCreateWithMetadataDocumentRequestShape,
      initialMetadataSync: DocumentSyncRequestSchema.optional(),
    }).superRefine((value, context) => {
      refineSingleUpdateSeed(value.initialMetadataSync, context, {
        message:
          "container create metadata seed requires one update and no container rekeys",
        path: "initialMetadataSync",
      });
      refineSeedWithinSyncRequestLimit(
        value.initialMetadataSync,
        context,
        "initialMetadataSync",
      );
    }),
    [containerCreateMetadataSeedRefinement],
  );

export type ContainerCreateWithMetadataDocumentRequest = z.infer<
  typeof ContainerCreateWithMetadataDocumentRequestSchema
>;

export function isContainerCreateWithMetadataDocumentRequest(
  value: unknown,
): value is ContainerCreateWithMetadataDocumentRequest {
  return ContainerCreateWithMetadataDocumentRequestSchema.safeParse(value)
    .success;
}
