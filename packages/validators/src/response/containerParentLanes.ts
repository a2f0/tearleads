import { z } from "zod";
import { containerParentLaneResponseUniqueIdsRefinement } from "../containerReadRefinements";
import {
  ContainerReadLaneIdSchema,
  refineContainerReadLaneResults,
} from "../containerReadSchemas";
import {
  registerJsonSchemaRuntimeRefinements,
  registerJsonSchemaView,
} from "../jsonSchema";
import { boundedNonEmptyArraySchema } from "../schema";
import { ListContainersResponseSchema } from "./container";

const ContainerParentLaneResultSchema = z.strictObject({
  laneId: ContainerReadLaneIdSchema,
  page: ListContainersResponseSchema,
});

const ListContainerParentLanesResponseViewSchema = z.strictObject({
  results: boundedNonEmptyArraySchema(ContainerParentLaneResultSchema, 4),
});

export const ListContainerParentLanesResponseSchema =
  registerJsonSchemaRuntimeRefinements(
    registerJsonSchemaView(
      ListContainerParentLanesResponseViewSchema.superRefine(
        refineContainerReadLaneResults("Container parent lane"),
      ),
      ListContainerParentLanesResponseViewSchema,
    ),
    [containerParentLaneResponseUniqueIdsRefinement],
  );

export type ListContainerParentLanesResponse = z.infer<
  typeof ListContainerParentLanesResponseSchema
>;

export function isListContainerParentLanesResponse(
  value: unknown,
): value is ListContainerParentLanesResponse {
  return ListContainerParentLanesResponseSchema.safeParse(value).success;
}
