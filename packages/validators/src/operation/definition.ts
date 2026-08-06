import type { z } from "zod";
import { isPlainObject } from "../isPlainObject";

export type JsonOperationMethod = "DELETE" | "GET" | "PATCH" | "POST" | "PUT";

export interface RuntimeRefinement {
  readonly description: string;
  readonly id: string;
}

export interface JsonOperation {
  readonly auth: "none" | "session";
  readonly body?: z.ZodType;
  readonly failureResponses?: Readonly<Record<number, z.ZodType>>;
  readonly failureStatuses: readonly number[];
  readonly id: string;
  readonly method: JsonOperationMethod;
  readonly params: z.ZodType;
  readonly path: `/${string}`;
  readonly query?: z.ZodType;
  readonly responses: Readonly<Record<number, z.ZodType>>;
  readonly runtimeRefinements?: readonly RuntimeRefinement[];
}

export function defineJsonOperation<const Operation extends JsonOperation>(
  operation: Operation,
): Operation {
  return operation;
}

const PATH_PARAMETER_PATTERN = /\{([^/{}]+)\}/g;

export function operationRoutePath(
  operation: Pick<JsonOperation, "path">,
): string {
  return operation.path.replace(PATH_PARAMETER_PATTERN, ":$1");
}

export function operationRequestPath<
  Operation extends Pick<JsonOperation, "id" | "params" | "path">,
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
  Operation extends Pick<JsonOperation, "id" | "params" | "path"> & {
    readonly query: QuerySchema;
  },
>(
  operation: Operation,
  params: z.input<Operation["params"]>,
  query: z.input<QuerySchema>,
): string {
  const path = operationRequestPath(operation, params);
  const result = operation.query.safeParse(query);
  if (!result.success || !isPlainObject(result.data)) {
    throw new TypeError(`Invalid query parameters for ${operation.id}`);
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
        `Invalid query parameter "${name}" for ${operation.id}`,
      );
    }
    searchParams.set(name, String(value));
  }

  const queryString = searchParams.toString();
  return queryString.length === 0 ? path : `${path}?${queryString}`;
}
