import { z } from "zod";
import {
  containerDocumentRuntimeRefinements,
  containerKekLogResponseRuntimeRefinements,
  containerParentLaneRuntimeRefinements,
} from "../containerReadRefinements";
import {
  registerJsonSchemaFragment,
  registerJsonSchemaRuntimeRefinements,
  registerJsonSchemaView,
} from "../jsonSchema";
import {
  isListContainerParentLanesRequest,
  ListContainerParentLanesRequestSchema,
} from "../request";
import {
  ContainerKekLogResponseSchema,
  ContainerNotFoundErrorResponseSchema,
  ErrorResponseSchema,
  isContainerKekLogResponse,
  isListContainerDocumentsResponse,
  isListContainerParentLanesResponse,
  ListContainerDocumentsResponseSchema,
  ListContainerParentLanesResponseSchema,
  SessionFailureResponseSchema,
} from "../response";
import { loosePlainObject, plainObjectSchema } from "../schema";
import { MAX_CONTAINER_KEY_EPOCH } from "../util";
import { defineJsonOperation } from "./definition";

const DIGITS_PATTERN = /^\d+$/u;

function listPageLimitSchema() {
  const jsonSchema = { minimum: 1, type: "integer" } as const;
  const inputSchema = registerJsonSchemaFragment(
    z.union([z.number(), z.string()]).superRefine((value, context) => {
      if (typeof value === "string" && !DIGITS_PATTERN.test(value)) {
        context.addIssue({ code: "custom", message: "Invalid limit" });
        return;
      }

      const parsed = Number(value);
      if (!Number.isSafeInteger(parsed) || parsed < 1) {
        context.addIssue({ code: "custom", message: "Invalid limit" });
      }
    }),
    jsonSchema,
  );

  return registerJsonSchemaFragment(inputSchema.transform(Number), jsonSchema);
}

/**
 * KEK-log cursors deliberately fail open to epoch zero for compatibility.
 * This includes malformed, non-positive, unsafe, and out-of-domain values.
 */
export function normalizeContainerKekLogEpochQuery(
  value: number | string | undefined,
): number {
  const parsed = Number(value);
  return Number.isSafeInteger(parsed) &&
    parsed > 0 &&
    parsed <= MAX_CONTAINER_KEY_EPOCH
    ? parsed
    : 0;
}

function containerKekLogEpochQuerySchema() {
  return registerJsonSchemaFragment(z.union([z.number(), z.string()]), {
    maximum: MAX_CONTAINER_KEY_EPOCH,
    minimum: 1,
    type: "integer",
  });
}

export const ContainerReadPathParamsSchema = z.strictObject({
  containerId: z.string(),
});

export const ContainerKekLogQuerySchema = loosePlainObject({
  keyringForEpoch: containerKekLogEpochQuerySchema().optional(),
  afterKeyEpoch: containerKekLogEpochQuerySchema().optional(),
});

const listContainerDocumentsQueryShape = {
  watermarkUpdatedAt: z.string().optional(),
  watermarkId: z.string().optional(),
  limit: listPageLimitSchema().optional(),
} as const;
const listContainerDocumentsQueryObjectSchema = z.looseObject(
  listContainerDocumentsQueryShape,
);

export const ListContainerDocumentsQuerySchema =
  registerJsonSchemaRuntimeRefinements(
    registerJsonSchemaView(
      plainObjectSchema
        .pipe(listContainerDocumentsQueryObjectSchema)
        .superRefine(({ watermarkId, watermarkUpdatedAt }, context) => {
          const isValid =
            (watermarkId === undefined && watermarkUpdatedAt === undefined) ||
            (watermarkId !== undefined &&
              watermarkUpdatedAt !== undefined &&
              watermarkId.length > 0 &&
              watermarkUpdatedAt.length > 0 &&
              !Number.isNaN(new Date(watermarkUpdatedAt).getTime()));
          if (!isValid) {
            context.addIssue({
              code: "custom",
              message: "Invalid watermark",
              path: ["watermarkUpdatedAt"],
            });
          }
        }),
      listContainerDocumentsQueryObjectSchema,
    ),
    containerDocumentRuntimeRefinements,
  );

export type ContainerReadPathParams = z.infer<
  typeof ContainerReadPathParamsSchema
>;
export type ContainerKekLogQuery = z.infer<typeof ContainerKekLogQuerySchema>;
export type ListContainerDocumentsQuery = z.infer<
  typeof ListContainerDocumentsQuerySchema
>;

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

export const listContainerDocumentsOperation = defineJsonOperation({
  auth: "session",
  failureResponses: {
    ...containerReadFailureResponses,
    404: ContainerNotFoundErrorResponseSchema,
  },
  failureStatuses: containerReadFailureStatuses,
  id: "containers.documents.list",
  method: "GET",
  params: ContainerReadPathParamsSchema,
  path: "/containers/{containerId}/documents",
  query: ListContainerDocumentsQuerySchema,
  responses: { 200: ListContainerDocumentsResponseSchema },
  runtimeRefinements: containerDocumentRuntimeRefinements,
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
export const isListContainerDocumentsOperationResponse =
  isListContainerDocumentsResponse;
export const isListContainerParentLanesOperationRequest =
  isListContainerParentLanesRequest;
export const isListContainerParentLanesOperationResponse =
  isListContainerParentLanesResponse;
