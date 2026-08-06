import { z } from "zod";
import { containerParentLaneResponseUniqueIdsRefinement } from "../containerReadRefinements";
import { ContainerParentLaneIdSchema } from "../containerReadSchemas";
import {
  registerJsonSchemaRuntimeRefinements,
  registerJsonSchemaView,
} from "../jsonSchema";
import { boundedNonEmptyArraySchema } from "../schema";
import { ListContainersResponseSchema } from "./container";

const ContainerParentLaneResultSchema = z.strictObject({
  laneId: ContainerParentLaneIdSchema,
  page: ListContainersResponseSchema,
});

const ListContainerParentLanesResponseViewSchema = z.strictObject({
  results: boundedNonEmptyArraySchema(ContainerParentLaneResultSchema, 4),
});

export const ListContainerParentLanesResponseSchema =
  registerJsonSchemaRuntimeRefinements(
    registerJsonSchemaView(
      ListContainerParentLanesResponseViewSchema.superRefine(
        ({ results }, context) => {
          const laneIds = new Set<string>();
          results.forEach((result, index) => {
            if (laneIds.has(result.laneId)) {
              context.addIssue({
                code: "custom",
                message: "Container parent lane result id is duplicated",
                path: ["results", index, "laneId"],
              });
            }
            laneIds.add(result.laneId);
          });
        },
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
