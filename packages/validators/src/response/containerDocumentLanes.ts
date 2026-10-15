import { z } from "zod";
import { containerDocumentLaneResponseUniqueIdsRefinement } from "../containerReadRefinements";
import {
  ContainerReadLaneIdSchema,
  MAX_CONTAINER_DOCUMENT_LANES,
  refineContainerReadLaneResults,
} from "../containerReadSchemas";
import {
  registerJsonSchemaRuntimeRefinements,
  registerJsonSchemaView,
} from "../jsonSchema";
import { boundedNonEmptyArraySchema } from "../schema";
import { CONTAINER_NOT_FOUND_ERROR_CODE } from "./containerNotFoundError";
import { ListContainerDocumentsResponseSchema } from "./document";

/**
 * A lane the readable-container gate rejected. The other lanes still list, so
 * one unreadable or inconsistent container cannot block discovery of the rest.
 * Only a positive absence proof (404) carries `container_not_found`.
 */
const ContainerDocumentLaneFailureSchema = z.strictObject({
  code: z.literal(CONTAINER_NOT_FOUND_ERROR_CODE).optional(),
  error: z.string().min(1),
  status: z.literal([403, 404, 409]),
});

const ContainerDocumentLaneResultSchema = z.union([
  z.strictObject({
    laneId: ContainerReadLaneIdSchema,
    page: ListContainerDocumentsResponseSchema,
  }),
  z.strictObject({
    failure: ContainerDocumentLaneFailureSchema,
    laneId: ContainerReadLaneIdSchema,
  }),
]);

const ListContainerDocumentLanesResponseViewSchema = z.strictObject({
  results: boundedNonEmptyArraySchema(
    ContainerDocumentLaneResultSchema,
    MAX_CONTAINER_DOCUMENT_LANES,
  ),
});

export const ListContainerDocumentLanesResponseSchema =
  registerJsonSchemaRuntimeRefinements(
    registerJsonSchemaView(
      ListContainerDocumentLanesResponseViewSchema.superRefine(
        refineContainerReadLaneResults("Container document lane"),
      ),
      ListContainerDocumentLanesResponseViewSchema,
    ),
    [containerDocumentLaneResponseUniqueIdsRefinement],
  );

export type ListContainerDocumentLanesResponse = z.infer<
  typeof ListContainerDocumentLanesResponseSchema
>;

export function isListContainerDocumentLanesResponse(
  value: unknown,
): value is ListContainerDocumentLanesResponse {
  return ListContainerDocumentLanesResponseSchema.safeParse(value).success;
}
