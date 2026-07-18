import { z } from "zod";
import {
  isListContainersResponse,
  type ListContainersResponse,
} from "./container";

const ContainerParentLaneResultSchema = z.strictObject({
  laneId: z.string().min(1).max(64),
  page: z.custom<ListContainersResponse>(isListContainersResponse),
});

export const ListContainerParentLanesResponseSchema = z
  .strictObject({
    results: z.array(ContainerParentLaneResultSchema).min(1).max(4),
  })
  .superRefine(({ results }, context) => {
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
  });

export type ListContainerParentLanesResponse = z.infer<
  typeof ListContainerParentLanesResponseSchema
>;

export function isListContainerParentLanesResponse(
  value: unknown,
): value is ListContainerParentLanesResponse {
  return ListContainerParentLanesResponseSchema.safeParse(value).success;
}
