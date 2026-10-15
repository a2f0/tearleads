import { z } from "zod";
import {
  containerDocumentLaneRuntimeRefinements,
  containerKekLogResponseRuntimeRefinements,
  containerParentLaneRuntimeRefinements,
} from "../containerReadRefinements";
import { registerJsonSchemaFragment } from "../jsonSchema";
import {
  isListContainerDocumentLanesRequest,
  isListContainerParentLanesRequest,
  ListContainerDocumentLanesRequestSchema,
  ListContainerParentLanesRequestSchema,
} from "../request";
import {
  ContainerKekLogResponseSchema,
  ErrorResponseSchema,
  isContainerKekLogResponse,
  isListContainerParentLanesResponse,
  ListContainerParentLanesResponseSchema,
  SessionFailureResponseSchema,
} from "../response";
import {
  isListContainerDocumentLanesResponse,
  ListContainerDocumentLanesResponseSchema,
} from "../response/containerDocumentLanes";
import { loosePlainObject } from "../schema";
import { MAX_CONTAINER_KEY_EPOCH } from "../util";
import { defineJsonOperation } from "./definition";

const DIGITS_PATTERN = /^\d+$/u;

function containerKekLogEpochQuerySchema() {
  return registerJsonSchemaFragment(
    z.union([z.number(), z.string()]).refine((value) => {
      if (typeof value === "string" && !DIGITS_PATTERN.test(value))
        return false;
      const parsed = Number(value);
      return (
        Number.isSafeInteger(parsed) &&
        parsed > 0 &&
        parsed <= MAX_CONTAINER_KEY_EPOCH
      );
    }, "Invalid key epoch"),
    {
      maximum: MAX_CONTAINER_KEY_EPOCH,
      minimum: 1,
      type: "integer",
    },
  );
}

export const ContainerReadPathParamsSchema = z.strictObject({
  containerId: z.string(),
});

export const ContainerKekLogQuerySchema = loosePlainObject({
  keyringForEpoch: containerKekLogEpochQuerySchema().optional(),
  afterKeyEpoch: containerKekLogEpochQuerySchema().optional(),
});

export type ContainerReadPathParams = z.infer<
  typeof ContainerReadPathParamsSchema
>;
export type ContainerKekLogQuery = z.infer<typeof ContainerKekLogQuerySchema>;

const containerReadFailureResponses = {
  400: ErrorResponseSchema,
  401: SessionFailureResponseSchema,
  403: ErrorResponseSchema,
  404: ErrorResponseSchema,
  409: ErrorResponseSchema,
  500: ErrorResponseSchema,
} as const;

const containerReadFailureStatuses = [400, 401, 403, 404, 409, 500] as const;

export const getContainerKekLogOperation = defineJsonOperation({
  auth: "session",
  failureResponses: containerReadFailureResponses,
  failureStatuses: containerReadFailureStatuses,
  id: "containers.kekLog.get",
  method: "GET",
  params: ContainerReadPathParamsSchema,
  path: "/containers/{containerId}/kek-log",
  query: ContainerKekLogQuerySchema,
  responses: { 200: ContainerKekLogResponseSchema },
  runtimeRefinements: containerKekLogResponseRuntimeRefinements,
});

export const listContainerDocumentLanesOperation = defineJsonOperation({
  auth: "session",
  body: ListContainerDocumentLanesRequestSchema,
  failureResponses: {
    400: ErrorResponseSchema,
    401: SessionFailureResponseSchema,
    500: ErrorResponseSchema,
  },
  failureStatuses: [400, 401, 500],
  id: "containers.documentLanes.query",
  method: "POST",
  params: z.strictObject({}),
  path: "/containers/documents/query",
  responses: { 200: ListContainerDocumentLanesResponseSchema },
  runtimeRefinements: containerDocumentLaneRuntimeRefinements,
});

export const listContainerParentLanesOperation = defineJsonOperation({
  auth: "session",
  body: ListContainerParentLanesRequestSchema,
  failureResponses: {
    400: ErrorResponseSchema,
    401: SessionFailureResponseSchema,
    500: ErrorResponseSchema,
  },
  failureStatuses: [400, 401, 500],
  id: "containers.parentLanes.query",
  method: "POST",
  params: z.strictObject({}),
  path: "/containers/parent-lanes/query",
  responses: { 200: ListContainerParentLanesResponseSchema },
  runtimeRefinements: containerParentLaneRuntimeRefinements,
});

export const isGetContainerKekLogOperationResponse = isContainerKekLogResponse;
export const isListContainerDocumentLanesOperationRequest =
  isListContainerDocumentLanesRequest;
export const isListContainerDocumentLanesOperationResponse =
  isListContainerDocumentLanesResponse;
export const isListContainerParentLanesOperationRequest =
  isListContainerParentLanesRequest;
export const isListContainerParentLanesOperationResponse =
  isListContainerParentLanesResponse;
