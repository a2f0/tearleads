import { z } from "zod";

/**
 * A container 404 can trigger permanent local teardown or suppress a failed
 * discovery lane. Only a positive server-side container absence proof may
 * carry this code; proxy, route, and dependency 404s must remain uncoded.
 */
export const CONTAINER_NOT_FOUND_ERROR_CODE = "container_not_found";

export const ContainerNotFoundErrorResponseSchema = z.looseObject({
  code: z.literal(CONTAINER_NOT_FOUND_ERROR_CODE),
  error: z.string().min(1),
});

export type ContainerNotFoundErrorResponse = z.infer<
  typeof ContainerNotFoundErrorResponseSchema
>;
