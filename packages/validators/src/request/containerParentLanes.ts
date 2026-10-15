import { z } from "zod";
import {
  containerParentLaneRequestPageTotalRefinement,
  containerParentLaneRequestUniqueIdsRefinement,
} from "../containerReadRefinements";
import {
  ContainerReadLaneIdSchema,
  ContainerReadLaneWatermarkSchema,
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

const ContainerParentLaneRequestSchema = z.strictObject({
  laneId: ContainerReadLaneIdSchema,
  limit: boundedPositiveIntegerSchema(500).optional(),
  parentId: uuidV4StringSchema.nullable(),
  watermark: ContainerReadLaneWatermarkSchema.nullable(),
});

const ListContainerParentLanesRequestViewSchema = z.strictObject({
  lanes: boundedNonEmptyArraySchema(ContainerParentLaneRequestSchema, 4),
});

export const ListContainerParentLanesRequestSchema =
  registerJsonSchemaRuntimeRefinements(
    registerJsonSchemaView(
      ListContainerParentLanesRequestViewSchema.superRefine(
        refineContainerReadLaneRequests("Container parent lane"),
      ),
      ListContainerParentLanesRequestViewSchema,
    ),
    [
      containerParentLaneRequestUniqueIdsRefinement,
      containerParentLaneRequestPageTotalRefinement,
    ],
  );

export type ListContainerParentLanesRequest = z.infer<
  typeof ListContainerParentLanesRequestSchema
>;

export function isListContainerParentLanesRequest(
  value: unknown,
): value is ListContainerParentLanesRequest {
  return ListContainerParentLanesRequestSchema.safeParse(value).success;
}
