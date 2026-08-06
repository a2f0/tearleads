import { z } from "zod";
import {
  containerParentLaneRequestPageTotalRefinement,
  containerParentLaneRequestUniqueIdsRefinement,
} from "../containerReadRefinements";
import { ContainerParentLaneIdSchema } from "../containerReadSchemas";
import {
  registerJsonSchemaFragment,
  registerJsonSchemaRuntimeRefinements,
  registerJsonSchemaView,
} from "../jsonSchema";
import {
  boundedNonEmptyArraySchema,
  boundedPositiveIntegerSchema,
  uuidV4StringSchema,
} from "../schema";

const DEFAULT_CONTAINER_PARENT_LANE_PAGE_LIMIT = 100;
const MAX_CONTAINER_PARENT_LANE_BATCH_PAGE_TOTAL = 500;

const ContainerParentLaneWatermarkSchema = z.strictObject({
  id: z.string().min(1),
  updatedAt: registerJsonSchemaFragment(
    z
      .string()
      .refine(
        (value) => !Number.isNaN(new Date(value).getTime()),
        "Invalid watermark date",
      ),
    { minLength: 1, type: "string" },
  ),
});

const ContainerParentLaneRequestSchema = z.strictObject({
  laneId: ContainerParentLaneIdSchema,
  limit: boundedPositiveIntegerSchema(500).optional(),
  parentId: uuidV4StringSchema.nullable(),
  watermark: ContainerParentLaneWatermarkSchema.nullable(),
});

const ListContainerParentLanesRequestViewSchema = z.strictObject({
  lanes: boundedNonEmptyArraySchema(ContainerParentLaneRequestSchema, 4),
});

export const ListContainerParentLanesRequestSchema =
  registerJsonSchemaRuntimeRefinements(
    registerJsonSchemaView(
      ListContainerParentLanesRequestViewSchema.superRefine(
        ({ lanes }, context) => {
          const laneIds = new Set<string>();
          let requestedPageTotal = 0;

          lanes.forEach((lane, index) => {
            if (laneIds.has(lane.laneId)) {
              context.addIssue({
                code: "custom",
                message: "Container parent lane id is duplicated",
                path: ["lanes", index, "laneId"],
              });
            }
            laneIds.add(lane.laneId);
            requestedPageTotal +=
              lane.limit ?? DEFAULT_CONTAINER_PARENT_LANE_PAGE_LIMIT;
          });

          if (requestedPageTotal > MAX_CONTAINER_PARENT_LANE_BATCH_PAGE_TOTAL) {
            context.addIssue({
              code: "custom",
              message: "Container parent lane batch page total exceeds 500",
              path: ["lanes"],
            });
          }
        },
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
