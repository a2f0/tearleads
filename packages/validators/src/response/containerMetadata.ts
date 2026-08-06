import type { z } from "zod";
import { loosePlainObject } from "../schema";
import { ContainerMutationResponseSchema } from "./container";
import { DocumentCreateResponseSchema } from "./documentMutation";

export const ContainerCreateWithMetadataDocumentResponseSchema =
  loosePlainObject({
    container: ContainerMutationResponseSchema,
    metadataDocument: DocumentCreateResponseSchema,
  });

export type ContainerCreateWithMetadataDocumentResponse = z.infer<
  typeof ContainerCreateWithMetadataDocumentResponseSchema
>;

export function isContainerCreateWithMetadataDocumentResponse(
  value: unknown,
): value is ContainerCreateWithMetadataDocumentResponse {
  return ContainerCreateWithMetadataDocumentResponseSchema.safeParse(value)
    .success;
}
