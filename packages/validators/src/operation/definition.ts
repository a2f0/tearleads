import type { z } from "zod";
import { isPlainObject } from "../isPlainObject";

export type HttpOperationMethod = "DELETE" | "GET" | "PATCH" | "POST" | "PUT";
export type JsonOperationMethod = HttpOperationMethod;
export type HttpOperationMediaType =
  | "application/json"
  | "application/octet-stream";

export interface RuntimeRefinement {
  readonly description: string;
  readonly id: string;
}

export interface HttpOperation {
  readonly auth: "none" | "session";
  readonly body?: z.ZodType;
  readonly emptyResponseStatuses?: readonly number[];
  readonly failureResponses?: Readonly<Record<number, z.ZodType>>;
  readonly failureStatuses: readonly number[];
  readonly headers?: z.ZodType;
  readonly id: string;
  readonly method: HttpOperationMethod;
  readonly params: z.ZodType;
  readonly path: `/${string}`;
  readonly query?: z.ZodType;
  readonly requestMediaType?: HttpOperationMediaType;
  readonly responseHeaders?: Readonly<Record<number, z.ZodType>>;
  readonly responseMediaTypes?: Readonly<
    Record<number, HttpOperationMediaType>
  >;
  readonly responseDescriptions?: Readonly<Record<number, string>>;
  readonly responses: Readonly<Record<number, z.ZodType>>;
  readonly runtimeRefinements?: readonly RuntimeRefinement[];
}

export interface JsonOperation extends HttpOperation {
  readonly requestMediaType?: "application/json";
  readonly responseMediaTypes?: Readonly<Record<number, "application/json">>;
}

export type OperationSchemaInput<Schema extends z.ZodType> = z.input<Schema>;
export type OperationSchemaOutput<Schema extends z.ZodType> = z.output<Schema>;

export function defineHttpOperation<const Operation extends HttpOperation>(
  operation: Operation,
): Operation {
  return operation;
}

export function defineJsonOperation<const Operation extends JsonOperation>(
  operation: Operation,
): Operation {
  return operation;
}

const PATH_PARAMETER_PATTERN = /\{([^/{}]+)\}/g;

export function operationRoutePath(
  operation: Pick<HttpOperation, "path">,
): string {
  return operation.path.replace(PATH_PARAMETER_PATTERN, ":$1");
}

export function operationRequestPath<
  Operation extends Pick<HttpOperation, "id" | "params" | "path">,
>(operation: Operation, params: z.input<Operation["params"]>): string {
  const result = operation.params.safeParse(params);
  if (!result.success) {
    throw new TypeError(`Invalid path parameters for ${operation.id}`);
  }
  const values = result.data;
  if (!isPlainObject(values)) {
    throw new TypeError(`Invalid path parameters for ${operation.id}`);
  }

  return operation.path.replace(PATH_PARAMETER_PATTERN, (_, name: string) => {
    const value = values[name];
    if (typeof value !== "string" && typeof value !== "number") {
      throw new TypeError(
        `Invalid path parameter "${name}" for ${operation.id}`,
      );
    }

    return encodeURIComponent(String(value));
  });
}

export function operationRequestPathWithQuery<
  QuerySchema extends z.ZodType,
  Operation extends Pick<HttpOperation, "id" | "params" | "path"> & {
    readonly query: QuerySchema;
  },
>(
  operation: Operation,
  params: z.input<Operation["params"]>,
  query: z.input<QuerySchema>,
): string {
  const path = operationRequestPath(operation, params);
  return appendOperationQuery(operation.id, operation.query, path, query);
}

export function operationRequestPathForInput<
  Operation extends Pick<HttpOperation, "id" | "params" | "path" | "query">,
>(
  operation: Operation,
  params: z.input<Operation["params"]>,
  query: unknown,
): string {
  const path = operationRequestPath(operation, params);
  if (!operation.query) {
    if (query !== undefined) {
      throw new TypeError(`Invalid query parameters for ${operation.id}`);
    }
    return path;
  }

  return appendOperationQuery(operation.id, operation.query, path, query);
}

function appendOperationQuery(
  operationId: string,
  querySchema: NonNullable<HttpOperation["query"]>,
  path: string,
  query: unknown,
): string {
  const result = querySchema.safeParse(query);
  if (!result.success || !isPlainObject(result.data)) {
    throw new TypeError(`Invalid query parameters for ${operationId}`);
  }

  const searchParams = new URLSearchParams();
  for (const [name, value] of Object.entries(result.data)) {
    if (value === undefined) {
      continue;
    }
    if (
      typeof value !== "string" &&
      typeof value !== "number" &&
      typeof value !== "boolean"
    ) {
      throw new TypeError(
        `Invalid query parameter "${name}" for ${operationId}`,
      );
    }
    searchParams.set(name, String(value));
  }

  const queryString = searchParams.toString();
  return queryString.length === 0 ? path : `${path}?${queryString}`;
}
