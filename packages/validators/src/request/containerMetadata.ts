import type { z } from "zod";
import { ContainerSystemSlotSchema } from "../containerSystemSlot";
import { loosePlainObject } from "../schema";
import { ContainerMutationRequestSchema } from "./container";
import { DocumentCreateRequestSchema } from "./document";

export const containerCreateWithMetadataDocumentRequestShape = {
  container: ContainerMutationRequestSchema,
  metadataDocument: DocumentCreateRequestSchema,
  systemSlot: ContainerSystemSlotSchema.nullable().optional(),
};

export const ContainerCreateWithMetadataDocumentRequestSchema =
  loosePlainObject(containerCreateWithMetadataDocumentRequestShape);

export type ContainerCreateWithMetadataDocumentRequest = z.infer<
  typeof ContainerCreateWithMetadataDocumentRequestSchema
>;

export function isContainerCreateWithMetadataDocumentRequest(
  value: unknown,
): value is ContainerCreateWithMetadataDocumentRequest {
  return ContainerCreateWithMetadataDocumentRequestSchema.safeParse(value)
    .success;
}
