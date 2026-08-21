import type { z } from "zod";
import { toJsonSchemaProjection } from "../jsonSchema";
import type { HttpOperation, HttpOperationMediaType } from "./definition";
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
  readonly parameters: readonly object[];
  readonly requestBody?: {
    readonly content: OpenApiContent;
    readonly required: true;
  };
  readonly responses: Readonly<Record<string, OpenApiResponse>>;
  readonly security: readonly object[];
  readonly "x-symcrypt-runtime-refinements"?: readonly object[];
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
  operation: HttpOperation,
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

function openApiQueryParameters(
  operation: HttpOperation,
  runtimeRefinementIds: Set<string>,
): object[] {
  if (operation.query === undefined) {
    return [];
  }

  const parameterSchema = openApiSchema(operation.query, runtimeRefinementIds);
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
  runtimeRefinementIds: Set<string>,
): object[] {
  if (operation.headers === undefined) {
    return [];
  }

  const parameterSchema = openApiSchema(
    operation.headers,
    runtimeRefinementIds,
  );
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
  runtimeRefinementIds: Set<string>,
): Readonly<Record<string, object>> | undefined {
  const headerSchema = operation.responseHeaders?.[status];
  if (headerSchema === undefined) {
    return undefined;
  }

  const projected = openApiSchema(headerSchema, runtimeRefinementIds);
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

function responseDescription(
  successful: boolean,
  mediaType: HttpOperationMediaType,
): string {
  if (mediaType === "application/json") {
    return successful ? "Successful JSON response" : "Failure JSON response";
  }
  return successful ? "Successful binary response" : "Failure binary response";
}

function openApiContent(
  mediaType: HttpOperationMediaType,
  schema: z.core.JSONSchema.BaseSchema,
): OpenApiContent {
  return { [mediaType]: { schema } };
}

function hasRegisteredResponseStatus(
  status: number,
  successResponses: ReadonlyMap<number, z.ZodType>,
  emptySuccessStatuses: ReadonlySet<number>,
  failureStatuses: ReadonlySet<number>,
): boolean {
  return (
    successResponses.has(status) ||
    emptySuccessStatuses.has(status) ||
    failureStatuses.has(status)
  );
}

function assertResponseMetadata(
  operation: HttpOperation,
  successResponses: ReadonlyMap<number, z.ZodType>,
  emptySuccessStatuses: ReadonlySet<number>,
  failureStatuses: ReadonlySet<number>,
  failureResponses: ReadonlyMap<number, z.ZodType>,
): void {
  for (const status of successResponses.keys()) {
    if (emptySuccessStatuses.has(status) || failureStatuses.has(status)) {
      throw new Error(`${operation.id} declares status ${status} twice`);
    }
  }
  for (const status of emptySuccessStatuses) {
    if (failureStatuses.has(status)) {
      throw new Error(`${operation.id} declares status ${status} twice`);
    }
  }
  if (
    emptySuccessStatuses.size !== (operation.emptyResponseStatuses?.length ?? 0)
  ) {
    throw new Error(`${operation.id} repeats an empty response status`);
  }
  for (const status of failureResponses.keys()) {
    if (!failureStatuses.has(status)) {
      throw new Error(
        `${operation.id} declares a body for unregistered failure status ${status}`,
      );
    }
  }
  for (const status of Object.keys(operation.responseMediaTypes ?? {})) {
    if (!successResponses.has(Number(status))) {
      throw new Error(
        `${operation.id} declares a media type for unregistered response status ${status}`,
      );
    }
  }
  for (const status of Object.keys(operation.responseHeaders ?? {})) {
    const numericStatus = Number(status);
    if (
      !hasRegisteredResponseStatus(
        numericStatus,
        successResponses,
        emptySuccessStatuses,
        failureStatuses,
      )
    ) {
      throw new Error(
        `${operation.id} declares headers for unregistered response status ${status}`,
      );
    }
  }
}

function openApiResponse(
  operation: HttpOperation,
  status: number,
  successful: boolean,
  successSchema: z.ZodType | undefined,
  failureSchema: z.ZodType | undefined,
  runtimeRefinementIds: Set<string>,
): OpenApiResponse {
  const schema = successSchema ?? failureSchema;
  const mediaType =
    successSchema === undefined
      ? "application/json"
      : (operation.responseMediaTypes?.[status] ?? "application/json");
  const headers = openApiResponseHeaders(
    operation,
    status,
    runtimeRefinementIds,
  );
  if (schema === undefined) {
    return {
      description: "Response without a declared body",
      ...(headers === undefined ? {} : { headers }),
    };
  }

  return {
    content: openApiContent(
      mediaType,
      openApiSchema(schema, runtimeRefinementIds),
    ),
    description: responseDescription(successful, mediaType),
    ...(headers === undefined ? {} : { headers }),
  };
}

function openApiResponses(
  operation: HttpOperation,
  runtimeRefinementIds: Set<string>,
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
      successResponses.has(status) || emptySuccessStatuses.has(status),
      successResponses.get(status),
      failureResponses.get(status),
      runtimeRefinementIds,
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

function openApiOperation(operation: HttpOperation): OpenApiOperation {
  const runtimeRefinementIds = new Set<string>();
  const parameters = [
    ...openApiPathParameters(operation, runtimeRefinementIds),
    ...openApiQueryParameters(operation, runtimeRefinementIds),
    ...openApiHeaderParameters(operation, runtimeRefinementIds),
  ];
  const requestSchema =
    operation.body === undefined
      ? undefined
      : openApiSchema(operation.body, runtimeRefinementIds);
  const responses = openApiResponses(operation, runtimeRefinementIds);
  const requestMediaType = operation.requestMediaType ?? "application/json";
  assertRuntimeRefinements(operation, runtimeRefinementIds);

  return {
    operationId: operation.id,
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
          "x-symcrypt-runtime-refinements": operation.runtimeRefinements,
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

export function createOpenApiDocument(
  operations: readonly HttpOperation[],
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
      title: "SymCrypt Protocol API",
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
