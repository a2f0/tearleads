import type { z } from "zod";
import { toJsonSchemaProjection } from "../jsonSchema";
import type { JsonOperation } from "./definition";
import { protocolOperations } from "./registry";

const JSON_SCHEMA_DIALECT =
  "https://json-schema.org/draft/2020-12/schema" as const;
const PATH_PARAMETER_PATTERN = /\{([^/{}]+)\}/g;

interface OpenApiMediaType {
  readonly schema: z.core.JSONSchema.BaseSchema;
}

interface OpenApiResponse {
  readonly content?: Readonly<Record<"application/json", OpenApiMediaType>>;
  readonly description: string;
}

interface OpenApiOperation {
  readonly operationId: string;
  readonly parameters: readonly object[];
  readonly requestBody?: {
    readonly content: Readonly<Record<"application/json", OpenApiMediaType>>;
    readonly required: true;
  };
  readonly responses: Readonly<Record<string, OpenApiResponse>>;
  readonly security: readonly object[];
  readonly "x-tearleads-runtime-refinements"?: readonly object[];
}

interface OpenApiPathItem {
  readonly delete?: OpenApiOperation;
  readonly get?: OpenApiOperation;
  readonly patch?: OpenApiOperation;
  readonly post?: OpenApiOperation;
  readonly put?: OpenApiOperation;
}

interface OpenApiDocument {
  readonly components: {
    readonly securitySchemes: Readonly<Record<string, object>>;
  };
  readonly info: {
    readonly title: string;
    readonly version: string;
  };
  readonly jsonSchemaDialect: typeof JSON_SCHEMA_DIALECT;
  readonly openapi: "3.1.0";
  readonly paths: Readonly<Record<string, OpenApiPathItem>>;
}

function pathParameterNames(path: string): string[] {
  return Array.from(
    path.matchAll(PATH_PARAMETER_PATTERN),
    (match) => match[1],
  ).filter((name) => name !== undefined);
}

function openApiSchema(
  schema: z.core.$ZodType,
  runtimeRefinementIds: Set<string>,
): z.core.JSONSchema.BaseSchema {
  const projection = toJsonSchemaProjection(schema);
  for (const id of projection.runtimeRefinementIds) {
    runtimeRefinementIds.add(id);
  }
  return projection.jsonSchema;
}

function openApiPathParameters(
  operation: JsonOperation,
  runtimeRefinementIds: Set<string>,
): object[] {
  const parameterSchema = openApiSchema(operation.params, runtimeRefinementIds);
  if (
    parameterSchema.type !== "object" ||
    parameterSchema.properties === undefined
  ) {
    throw new Error(`${operation.id} path parameters must be an object schema`);
  }

  const pathNames = pathParameterNames(operation.path);
  const propertyNames = Object.keys(parameterSchema.properties);
  if (
    pathNames.length !== propertyNames.length ||
    pathNames.some((name) => !propertyNames.includes(name))
  ) {
    throw new Error(
      `${operation.id} path template and parameter schema must match exactly`,
    );
  }

  const requiredNames = new Set(parameterSchema.required ?? []);
  return pathNames.map((name) => {
    if (!requiredNames.has(name)) {
      throw new Error(
        `${operation.id} path parameter ${name} must be required`,
      );
    }

    const schema = parameterSchema.properties?.[name];
    if (schema === undefined) {
      throw new Error(`${operation.id} path parameter ${name} has no schema`);
    }

    return {
      explode: false,
      in: "path",
      name,
      required: true,
      schema,
      style: "simple",
    };
  });
}

function openApiResponses(
  operation: JsonOperation,
  runtimeRefinementIds: Set<string>,
): Record<string, OpenApiResponse> {
  const successResponses = new Map(
    Object.entries(operation.responses).map(([status, schema]) => [
      Number(status),
      schema,
    ]),
  );
  const failureStatuses = new Set(operation.failureStatuses);
  const failureResponses = new Map(
    Object.entries(operation.failureResponses ?? {}).map(([status, schema]) => [
      Number(status),
      schema,
    ]),
  );

  for (const status of successResponses.keys()) {
    if (failureStatuses.has(status)) {
      throw new Error(`${operation.id} declares status ${status} twice`);
    }
  }
  for (const status of failureResponses.keys()) {
    if (!failureStatuses.has(status)) {
      throw new Error(
        `${operation.id} declares a body for unregistered failure status ${status}`,
      );
    }
  }

  const statuses = [...successResponses.keys(), ...failureStatuses].sort(
    (left, right) => left - right,
  );
  const responses: Record<string, OpenApiResponse> = {};
  for (const status of statuses) {
    const successSchema = successResponses.get(status);
    const schema = successSchema ?? failureResponses.get(status);
    responses[String(status)] =
      schema === undefined
        ? { description: "Response without a declared JSON body" }
        : {
            content: {
              "application/json": {
                schema: openApiSchema(schema, runtimeRefinementIds),
              },
            },
            description:
              successSchema === undefined
                ? "Failure JSON response"
                : "Successful JSON response",
          };
  }

  return responses;
}

function assertRuntimeRefinements(
  operation: JsonOperation,
  projectedIds: Set<string>,
): void {
  const declaredIds = new Set(
    (operation.runtimeRefinements ?? []).map((refinement) => refinement.id),
  );
  if (declaredIds.size !== (operation.runtimeRefinements?.length ?? 0)) {
    throw new Error(`${operation.id} repeats a runtime refinement id`);
  }

  const missingIds = [...projectedIds].filter((id) => !declaredIds.has(id));
  const extraIds = [...declaredIds].filter((id) => !projectedIds.has(id));
  if (missingIds.length > 0 || extraIds.length > 0) {
    throw new Error(
      `${operation.id} runtime refinement metadata does not match its schemas`,
    );
  }
}

function openApiOperation(operation: JsonOperation): OpenApiOperation {
  const runtimeRefinementIds = new Set<string>();
  const parameters = openApiPathParameters(operation, runtimeRefinementIds);
  const requestSchema =
    operation.body === undefined
      ? undefined
      : openApiSchema(operation.body, runtimeRefinementIds);
  const responses = openApiResponses(operation, runtimeRefinementIds);
  assertRuntimeRefinements(operation, runtimeRefinementIds);

  return {
    operationId: operation.id,
    parameters,
    ...(requestSchema === undefined
      ? {}
      : {
          requestBody: {
            content: {
              "application/json": { schema: requestSchema },
            },
            required: true as const,
          },
        }),
    responses,
    security: operation.auth === "session" ? [{ bearerAuth: [] }] : [],
    ...(operation.runtimeRefinements === undefined
      ? {}
      : {
          "x-tearleads-runtime-refinements": operation.runtimeRefinements,
        }),
  };
}

function compareOperations(left: JsonOperation, right: JsonOperation): number {
  const leftKey = `${left.path}:${left.method}:${left.id}`;
  const rightKey = `${right.path}:${right.method}:${right.id}`;
  if (leftKey < rightKey) {
    return -1;
  }
  if (leftKey > rightKey) {
    return 1;
  }
  return 0;
}

export function createOpenApiDocument(
  operations: readonly JsonOperation[],
): OpenApiDocument {
  const paths: Record<string, Record<string, OpenApiOperation>> = {};
  const operationIds = new Set<string>();
  const sortedOperations = [...operations].sort(compareOperations);

  for (const operation of sortedOperations) {
    if (operationIds.has(operation.id)) {
      throw new Error(`${operation.id} operation id is duplicated`);
    }
    operationIds.add(operation.id);

    const method = operation.method.toLowerCase();
    const pathItem = paths[operation.path] ?? {};
    if (pathItem[method] !== undefined) {
      throw new Error(`${operation.method} ${operation.path} is duplicated`);
    }

    pathItem[method] = openApiOperation(operation);
    paths[operation.path] = pathItem;
  }

  return {
    components: {
      securitySchemes: {
        bearerAuth: {
          bearerFormat: "session token",
          scheme: "bearer",
          type: "http",
        },
      },
    },
    info: {
      title: "Tearleads Protocol API",
      version: "0.1.0",
    },
    jsonSchemaDialect: JSON_SCHEMA_DIALECT,
    openapi: "3.1.0",
    paths,
  };
}

export const openApiDocument = createOpenApiDocument(protocolOperations);

export function renderOpenApi(): string {
  return `${JSON.stringify(openApiDocument, null, 2)}\n`;
}
