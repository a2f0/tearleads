import { z } from "zod";
import { containerParentLaneResponseUniqueIdsRefinement } from "../containerReadRefinements";
import {
  ContainerReadLaneIdSchema,
  MAX_CONTAINER_PARENT_LANES,
  refineContainerReadLaneResults,
} from "../containerReadSchemas";
import { ContainerSystemSlotSchema } from "../containerSystemSlot";
import {
  registerJsonSchemaRuntimeRefinements,
  registerJsonSchemaView,
} from "../jsonSchema";
import { arraySchema, boundedNonEmptyArraySchema } from "../schema";
import { EffectiveAccessLevelSchema } from "./accessLevel";
import { ListContainersResponseSchema } from "./container";
import { CONTAINER_NOT_FOUND_ERROR_CODE } from "./containerNotFoundError";
import { SyncWatermarkSchema } from "./syncWatermark";

const ContainerParentLaneIdItemSchema = z.strictObject({
  directAccessLevel: EffectiveAccessLevelSchema,
  id: z.string(),
  organizationId: z.string(),
  parentId: z.string().nullable(),
  systemSlot: ContainerSystemSlotSchema.nullable().optional(),
});

/**
 * Compact root-lane membership page returned when `idsOnly: true` is
 * requested: ids, placement metadata, and direct grant level without manifest
 * verification or container summaries.
 */
const ContainerParentLaneIdsPageSchema = z.strictObject({
  hasMore: z.boolean(),
  items: arraySchema(ContainerParentLaneIdItemSchema),
  nextWatermark: SyncWatermarkSchema.nullable(),
});

export type ContainerParentLaneIdsPage = z.infer<
  typeof ContainerParentLaneIdsPageSchema
>;

/**
 * A lane whose listing failed with a lane-local access or consistency error.
 * Other lanes in the same batch still list. Only a positive absence proof
 * (404) carries `container_not_found`.
 */
const ContainerParentLaneFailureSchema = z.strictObject({
  code: z.literal(CONTAINER_NOT_FOUND_ERROR_CODE).optional(),
  error: z.string().min(1),
  status: z.literal([403, 404, 409]),
});

const ContainerParentLaneResultSchema = z.union([
  z.strictObject({
    laneId: ContainerReadLaneIdSchema,
    page: ListContainersResponseSchema,
  }),
  z.strictObject({
    idsPage: ContainerParentLaneIdsPageSchema,
    laneId: ContainerReadLaneIdSchema,
  }),
  z.strictObject({
    failure: ContainerParentLaneFailureSchema,
    laneId: ContainerReadLaneIdSchema,
  }),
]);

const ListContainerParentLanesResponseViewSchema = z.strictObject({
  results: boundedNonEmptyArraySchema(
    ContainerParentLaneResultSchema,
    MAX_CONTAINER_PARENT_LANES,
  ),
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
