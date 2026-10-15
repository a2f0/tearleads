import { z } from "zod";
import { registerJsonSchemaFragment } from "./jsonSchema";

/** Caller-chosen id that pairs one batched lane request with its result. */
export const ContainerReadLaneIdSchema = registerJsonSchemaFragment(
  z.custom<string>(
    (value) =>
      typeof value === "string" && value.length > 0 && value.length <= 64,
  ),
  { maxLength: 64, minLength: 1, type: "string" },
);

/** Opaque `(updatedAt, id)` cursor returned by an earlier page of the lane. */
export const ContainerReadLaneWatermarkSchema = z.strictObject({
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

/**
 * Containers one document-listing request may name. Each lane runs the same
 * readable-container gate and access resolver as a single listing, so this
 * bounds per-request server work; the page total bounds returned rows.
 */
export const MAX_CONTAINER_DOCUMENT_LANES = 32;

/** Rows one batched lane request may ask for when it omits `limit`. */
export const DEFAULT_CONTAINER_READ_LANE_PAGE_LIMIT = 100;
/** Bound on the sum of every lane's page limit, the single-page maximum. */
export const MAX_CONTAINER_READ_LANE_BATCH_PAGE_TOTAL = 500;

interface ContainerReadLaneRequestShape {
  readonly laneId: string;
  readonly limit?: number | undefined;
}

/**
 * Batched container reads pair results to requests by lane id and bound the
 * rows one request may return to the single-page maximum.
 */
export function refineContainerReadLaneRequests(label: string) {
  return (
    { lanes }: { readonly lanes: ReadonlyArray<ContainerReadLaneRequestShape> },
    context: z.RefinementCtx,
  ): void => {
    const laneIds = new Set<string>();
    let requestedPageTotal = 0;

    lanes.forEach((lane, index) => {
      if (laneIds.has(lane.laneId)) {
        context.addIssue({
          code: "custom",
          message: `${label} id is duplicated`,
          path: ["lanes", index, "laneId"],
        });
      }
      laneIds.add(lane.laneId);
      requestedPageTotal +=
        lane.limit ?? DEFAULT_CONTAINER_READ_LANE_PAGE_LIMIT;
    });

    if (requestedPageTotal > MAX_CONTAINER_READ_LANE_BATCH_PAGE_TOTAL) {
      context.addIssue({
        code: "custom",
        message: `${label} batch page total exceeds ${MAX_CONTAINER_READ_LANE_BATCH_PAGE_TOTAL}`,
        path: ["lanes"],
      });
    }
  };
}

/** Each requested lane id appears at most once among the results. */
export function refineContainerReadLaneResults(label: string) {
  return (
    {
      results,
    }: { readonly results: ReadonlyArray<{ readonly laneId: string }> },
    context: z.RefinementCtx,
  ): void => {
    const laneIds = new Set<string>();
    results.forEach((result, index) => {
      if (laneIds.has(result.laneId)) {
        context.addIssue({
          code: "custom",
          message: `${label} result id is duplicated`,
          path: ["results", index, "laneId"],
        });
      }
      laneIds.add(result.laneId);
    });
  };
}
