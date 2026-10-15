import { z } from "zod";
import {
  containerDocumentLaneRequestPageTotalRefinement,
  containerDocumentLaneRequestUniqueIdsRefinement,
} from "../containerReadRefinements";
import {
  ContainerReadLaneIdSchema,
  ContainerReadLaneWatermarkSchema,
  MAX_CONTAINER_DOCUMENT_LANES,
  MAX_CONTAINER_READ_LANE_BATCH_PAGE_TOTAL,
  refineContainerReadLaneRequests,
} from "../containerReadSchemas";
import {
  registerJsonSchemaRuntimeRefinements,
  registerJsonSchemaView,
} from "../jsonSchema";
import {
  boundedNonEmptyArraySchema,
  boundedPositiveIntegerSchema,
  uuidV4StringSchema,
} from "../schema";

export {
  DEFAULT_CONTAINER_READ_LANE_PAGE_LIMIT as DEFAULT_CONTAINER_DOCUMENT_LANE_PAGE_LIMIT,
  MAX_CONTAINER_DOCUMENT_LANES,
  MAX_CONTAINER_READ_LANE_BATCH_PAGE_TOTAL as MAX_CONTAINER_DOCUMENT_LANE_PAGE_TOTAL,
} from "../containerReadSchemas";

const ContainerDocumentLaneRequestSchema = z.strictObject({
  containerId: uuidV4StringSchema,
  laneId: ContainerReadLaneIdSchema,
  limit: boundedPositiveIntegerSchema(
    MAX_CONTAINER_READ_LANE_BATCH_PAGE_TOTAL,
  ).optional(),
  watermark: ContainerReadLaneWatermarkSchema.nullable(),
});

const ListContainerDocumentLanesRequestViewSchema = z.strictObject({
  lanes: boundedNonEmptyArraySchema(
    ContainerDocumentLaneRequestSchema,
    MAX_CONTAINER_DOCUMENT_LANES,
  ),
});

export const ListContainerDocumentLanesRequestSchema =
  registerJsonSchemaRuntimeRefinements(
    registerJsonSchemaView(
      ListContainerDocumentLanesRequestViewSchema.superRefine(
        refineContainerReadLaneRequests("Container document lane"),
      ),
      ListContainerDocumentLanesRequestViewSchema,
    ),
    [
      containerDocumentLaneRequestUniqueIdsRefinement,
      containerDocumentLaneRequestPageTotalRefinement,
    ],
  );

export type ListContainerDocumentLanesRequest = z.infer<
  typeof ListContainerDocumentLanesRequestSchema
>;

export function isListContainerDocumentLanesRequest(
  value: unknown,
): value is ListContainerDocumentLanesRequest {
  return ListContainerDocumentLanesRequestSchema.safeParse(value).success;
}
