import { z } from "zod";
import {
  ErrorResponseSchema,
  HealthResponseSchema,
  isHealthResponse,
} from "../response";
import { defineJsonOperation } from "./definition";

const HealthPathParamsSchema = z.strictObject({});

export const getHealthOperation = defineJsonOperation({
  auth: "none",
  failureResponses: {
    413: ErrorResponseSchema,
    500: ErrorResponseSchema,
  },
  failureStatuses: [413, 500],
  id: "health.get",
  method: "GET",
  params: HealthPathParamsSchema,
  path: "/",
  responses: {
    200: HealthResponseSchema,
  },
});

export const isGetHealthOperationResponse = isHealthResponse;
