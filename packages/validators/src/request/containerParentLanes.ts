import { z } from "zod";

const DEFAULT_CONTAINER_PARENT_LANE_PAGE_LIMIT = 100;
const MAX_CONTAINER_PARENT_LANE_BATCH_PAGE_TOTAL = 500;

const ContainerParentLaneWatermarkSchema = z.strictObject({
  id: z.string().min(1),
  updatedAt: z
    .string()
    .refine(
      (value) => !Number.isNaN(new Date(value).getTime()),
      "Invalid watermark date",
    ),
});

const ContainerParentLaneRequestSchema = z.strictObject({
  laneId: z.string().min(1).max(64),
  limit: z.number().int().min(1).max(500).optional(),
  parentId: z.uuidv4().nullable(),
  watermark: ContainerParentLaneWatermarkSchema.nullable(),
});

export const ListContainerParentLanesRequestSchema = z
  .strictObject({
    lanes: z.array(ContainerParentLaneRequestSchema).min(1).max(4),
  })
  .superRefine(({ lanes }, context) => {
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
  });

export type ListContainerParentLanesRequest = z.infer<
  typeof ListContainerParentLanesRequestSchema
>;

export function isListContainerParentLanesRequest(
  value: unknown,
): value is ListContainerParentLanesRequest {
  return ListContainerParentLanesRequestSchema.safeParse(value).success;
}
