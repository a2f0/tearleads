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
  summary: "Health check",
  description:
    "Returns `ok` when the API process is serving requests; load balancers and clients use it as a liveness probe. It needs no session, and a request that carries a body is refused with 413.",
  method: "GET",
  params: HealthPathParamsSchema,
  path: "/",
  responses: {
    200: HealthResponseSchema,
  },
});

export const isGetHealthOperationResponse = isHealthResponse;
