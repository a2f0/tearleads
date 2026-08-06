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
