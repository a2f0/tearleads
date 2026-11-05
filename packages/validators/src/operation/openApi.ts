import type { z } from "zod";
import "../schemaDescriptions";
import { toJsonSchemaProjection } from "../jsonSchema";
import type { HttpOperation, HttpOperationMediaType } from "./definition";
import {
  collectOpenApiComponentNames,
  referenceOpenApiComponents,
} from "./openApiComponents";
import {
  httpStatusDescription,
  OPEN_API_DESCRIPTION,
  openApiOperationTag,
} from "./openApiPresentation";
import { assertResponseMetadata } from "./openApiResponseMetadata";
import { protocolOperations } from "./registry";

const JSON_SCHEMA_DIALECT =
  "https://json-schema.org/draft/2020-12/schema" as const;
const PATH_PARAMETER_PATTERN = /\{([^/{}]+)\}/g;

interface OpenApiMediaType {
  readonly schema: z.core.JSONSchema.BaseSchema;
}

type OpenApiContent = Readonly<
  Partial<Record<HttpOperationMediaType, OpenApiMediaType>>
>;

interface OpenApiResponse {
  readonly content?: OpenApiContent;
  readonly description: string;
  readonly headers?: Readonly<Record<string, object>>;
}

interface OpenApiOperation {
  readonly operationId: string;
  readonly summary: string;
  readonly description: string;
  readonly tags: readonly string[];
  readonly parameters: readonly object[];
  readonly requestBody?: {
    readonly content: OpenApiContent;
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
    readonly description: string;
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

interface OperationProjection {
  readonly componentNames: ReadonlyMap<z.core.$ZodType, string>;
  readonly runtimeRefinementIds: Set<string>;
}

function openApiSchema(
  schema: z.core.$ZodType,
  projection: OperationProjection,
): z.core.JSONSchema.BaseSchema {
  const result = toJsonSchemaProjection(schema, projection.componentNames);
  for (const id of result.runtimeRefinementIds) {
    projection.runtimeRefinementIds.add(id);
  }
  return result.jsonSchema;
}

function openApiPathParameters(
  operation: HttpOperation,
  projection: OperationProjection,
): object[] {
  const parameterSchema = openApiSchema(operation.params, projection);
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

function openApiQueryParameters(
  operation: HttpOperation,
  projection: OperationProjection,
): object[] {
  if (operation.query === undefined) {
    return [];
  }

  const parameterSchema = openApiSchema(operation.query, projection);
  if (
    parameterSchema.type !== "object" ||
    parameterSchema.properties === undefined
  ) {
    throw new Error(
      `${operation.id} query parameters must be an object schema`,
    );
  }

  const requiredNames = new Set(parameterSchema.required ?? []);
  return Object.entries(parameterSchema.properties).map(([name, schema]) => ({
    explode: true,
    in: "query",
    name,
    required: requiredNames.has(name),
    schema,
    style: "form",
  }));
}

function openApiHeaderParameters(
  operation: HttpOperation,
  projection: OperationProjection,
): object[] {
  if (operation.headers === undefined) {
    return [];
  }

  const parameterSchema = openApiSchema(operation.headers, projection);
  if (
    parameterSchema.type !== "object" ||
    parameterSchema.properties === undefined
  ) {
    throw new Error(`${operation.id} headers must be an object schema`);
  }

  const requiredNames = new Set(parameterSchema.required ?? []);
  return Object.entries(parameterSchema.properties).map(([name, schema]) => ({
    explode: false,
    in: "header",
    name,
    required: requiredNames.has(name),
    schema,
    style: "simple",
  }));
}

function openApiResponseHeaders(
  operation: HttpOperation,
  status: number,
  projection: OperationProjection,
): Readonly<Record<string, object>> | undefined {
  const headerSchema = operation.responseHeaders?.[status];
  if (headerSchema === undefined) {
    return undefined;
  }

  const projected = openApiSchema(headerSchema, projection);
  if (projected.type !== "object" || projected.properties === undefined) {
    throw new Error(
      `${operation.id} response ${status} headers must be an object schema`,
    );
  }

  const requiredNames = new Set(projected.required ?? []);
  return Object.fromEntries(
    Object.entries(projected.properties).map(([name, schema]) => [
      name,
      { required: requiredNames.has(name), schema },
    ]),
  );
}

function openApiContent(
  mediaType: HttpOperationMediaType,
  schema: z.core.JSONSchema.BaseSchema,
): OpenApiContent {
  return { [mediaType]: { schema } };
}

function openApiResponse(
  operation: HttpOperation,
  status: number,
  successSchema: z.ZodType | undefined,
  failureSchema: z.ZodType | undefined,
  projection: OperationProjection,
  description?: string,
): OpenApiResponse {
  const schema = successSchema ?? failureSchema;
  const mediaType =
    successSchema === undefined
      ? "application/json"
      : (operation.responseMediaTypes?.[status] ?? "application/json");
  const headers = openApiResponseHeaders(operation, status, projection);
  if (schema === undefined) {
    return {
      description: description ?? httpStatusDescription(status),
      ...(headers === undefined ? {} : { headers }),
    };
  }

  return {
    content: openApiContent(mediaType, openApiSchema(schema, projection)),
    description: description ?? httpStatusDescription(status),
    ...(headers === undefined ? {} : { headers }),
  };
}

function openApiResponses(
  operation: HttpOperation,
  projection: OperationProjection,
): Record<string, OpenApiResponse> {
  const successResponses = new Map(
    Object.entries(operation.responses).map(([status, schema]) => [
      Number(status),
      schema,
    ]),
  );
  const emptySuccessStatuses = new Set(operation.emptyResponseStatuses ?? []);
  const failureStatuses = new Set(operation.failureStatuses);
  const failureResponses = new Map(
    Object.entries(operation.failureResponses ?? {}).map(([status, schema]) => [
      Number(status),
      schema,
    ]),
  );

  assertResponseMetadata(
    operation,
    successResponses,
    emptySuccessStatuses,
    failureStatuses,
    failureResponses,
  );

  const statuses = Array.from(
    new Set([
      ...successResponses.keys(),
      ...emptySuccessStatuses,
      ...failureStatuses,
    ]),
  ).sort((left, right) => left - right);
  const responses: Record<string, OpenApiResponse> = {};
  for (const status of statuses) {
    responses[String(status)] = openApiResponse(
      operation,
      status,
      successResponses.get(status),
      failureResponses.get(status),
      projection,
      operation.responseDescriptions?.[status],
    );
  }

  return responses;
}

function assertRuntimeRefinements(
  operation: HttpOperation,
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

function openApiOperation(
  operation: HttpOperation,
  componentNames: ReadonlyMap<z.core.$ZodType, string>,
): OpenApiOperation {
  const projection: OperationProjection = {
    componentNames,
    runtimeRefinementIds: new Set(),
  };
  const parameters = [
    ...openApiPathParameters(operation, projection),
    ...openApiQueryParameters(operation, projection),
    ...openApiHeaderParameters(operation, projection),
  ];
  const requestSchema =
    operation.body === undefined
      ? undefined
      : openApiSchema(operation.body, projection);
  const responses = openApiResponses(operation, projection);
  const requestMediaType = operation.requestMediaType ?? "application/json";
  assertRuntimeRefinements(operation, projection.runtimeRefinementIds);

  return {
    operationId: operation.id,
    summary: operation.summary,
    description: operation.description,
    tags: [openApiOperationTag(operation)],
    parameters,
    ...(requestSchema === undefined
      ? {}
      : {
          requestBody: {
            content: openApiContent(requestMediaType, requestSchema),
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

function compareOperations(left: HttpOperation, right: HttpOperation): number {
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

/**
 * Builds the document with every schema inline. With `componentNames`, named
 * schemas carry a marker that referenceOpenApiComponents turns into `$ref`s.
 */
export function createOpenApiDocument(
  operations: readonly HttpOperation[],
  componentNames: ReadonlyMap<z.core.$ZodType, string> = new Map(),
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

    pathItem[method] = openApiOperation(operation, componentNames);
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
      description: OPEN_API_DESCRIPTION,
      title: "Tearleads Protocol API",
      version: "0.1.0",
    },
    jsonSchemaDialect: JSON_SCHEMA_DIALECT,
    openapi: "3.1.0",
    paths,
  };
}

/** Every schema inline; tests validate against these schemas directly. */
export const openApiDocument = createOpenApiDocument(protocolOperations);

/** The checked-in document: named schemas defined once under components. */
export const publishedOpenApiDocument = referenceOpenApiComponents(
  createOpenApiDocument(protocolOperations, collectOpenApiComponentNames()),
);

export function renderOpenApi(): string {
  return `${JSON.stringify(publishedOpenApiDocument, null, 2)}\n`;
}
