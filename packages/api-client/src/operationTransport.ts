import {
  type HttpOperation,
  type JsonOperation,
  type OperationSchemaInput,
  operationRequestPathForInput,
} from "@tearleads/validators/operation";
import {
  additionalOperationSuccessStatuses,
  decodeJsonOperationResponse,
  type JsonOperationResponse,
  type JsonOperationResponseEnvelope,
} from "./operationResponse";
import type {
  RequestResult,
  RequestResultOptions,
  ResponseRequestFn,
} from "./types";

interface RuntimeOperationRequestInput {
  readonly body?: unknown;
  readonly headers?: unknown;
  readonly query?: unknown;
}

interface RuntimeJsonOperationRequestInput
  extends RuntimeOperationRequestInput {
  readonly params: unknown;
}

type SchemaInputProperty<Operation, Key extends "body" | "headers" | "query"> =
  Operation extends Record<Key, infer Schema>
    ? {
        readonly [Property in Key]: OperationSchemaInput<
          Extract<Schema, HttpOperation["params"]>
        >;
      }
    : { readonly [Property in Key]?: never };

export type JsonOperationRequestInput<Operation extends JsonOperation> = {
  readonly params: OperationSchemaInput<Operation["params"]>;
} & SchemaInputProperty<Operation, "body"> &
  SchemaInputProperty<Operation, "headers"> &
  SchemaInputProperty<Operation, "query">;

export type {
  JsonOperationResponse,
  JsonOperationResponseEnvelope,
} from "./operationResponse";

interface JsonOperationRequest {
  readonly body?: BodyInit | undefined;
  readonly headers?: Record<string, string> | undefined;
  readonly method: JsonOperation["method"];
  readonly path: string;
}

export interface JsonOperationTransport {
  request<Operation extends JsonOperation>(
    operation: Operation,
    input: JsonOperationRequestInput<Operation>,
    options?: RequestResultOptions,
  ): Promise<JsonOperationResponse<Operation> | null>;
  requestResult<Operation extends JsonOperation>(
    operation: Operation,
    input: JsonOperationRequestInput<Operation>,
    options?: RequestResultOptions,
  ): Promise<RequestResult<JsonOperationResponse<Operation>>>;
  requestResponse<Operation extends JsonOperation>(
    operation: Operation,
    input: JsonOperationRequestInput<Operation>,
    options?: RequestResultOptions,
  ): Promise<JsonOperationResponseEnvelope<Operation> | null>;
  requestResponseResult<Operation extends JsonOperation>(
    operation: Operation,
    input: JsonOperationRequestInput<Operation>,
    options?: RequestResultOptions,
  ): Promise<RequestResult<JsonOperationResponseEnvelope<Operation>>>;
}

function invalidRequest(operation: JsonOperation, component: string): never {
  throw new TypeError(`Invalid ${component} for ${operation.id}`);
}

function requestHeaders(
  operation: JsonOperation,
  input: RuntimeOperationRequestInput,
): Record<string, string> | undefined {
  const supplied = input.headers;
  if (!operation.headers) {
    if (supplied !== undefined) {
      invalidRequest(operation, "request headers");
    }
    return undefined;
  }

  const parsed = operation.headers.safeParse(supplied);
  if (!parsed.success || typeof parsed.data !== "object" || !parsed.data) {
    invalidRequest(operation, "request headers");
  }

  const headers: Record<string, string> = {};
  for (const [name, value] of Object.entries(parsed.data)) {
    if (value === undefined) {
      continue;
    }
    if (typeof value !== "string") {
      invalidRequest(operation, `request header "${name}"`);
    }
    headers[name] = value;
  }
  return headers;
}

function requestBody(
  operation: JsonOperation,
  input: RuntimeOperationRequestInput,
): string | undefined {
  const supplied = input.body;
  if (!operation.body) {
    if (supplied !== undefined) {
      invalidRequest(operation, "request body");
    }
    return undefined;
  }

  const parsed = operation.body.safeParse(supplied);
  if (!parsed.success) {
    invalidRequest(operation, "request body");
  }
  const encoded = JSON.stringify(parsed.data);
  if (encoded === undefined) {
    invalidRequest(operation, "request body");
  }
  return encoded;
}

export function deriveJsonOperationRequest<Operation extends JsonOperation>(
  operation: Operation,
  input: JsonOperationRequestInput<Operation>,
): JsonOperationRequest {
  return deriveRuntimeJsonOperationRequest(operation, input);
}

function deriveRuntimeJsonOperationRequest(
  operation: JsonOperation,
  input: RuntimeJsonOperationRequestInput,
): JsonOperationRequest {
  const path = operationRequestPathForInput(
    operation,
    input.params,
    input.query,
  );

  const body = requestBody(operation, input);
  const declaredHeaders = requestHeaders(operation, input);
  const headers =
    body === undefined && declaredHeaders === undefined
      ? undefined
      : {
          ...(body === undefined ? {} : { "Content-Type": "application/json" }),
          ...declaredHeaders,
        };
  return {
    ...(body === undefined ? {} : { body }),
    ...(headers === undefined ? {} : { headers }),
    method: operation.method,
    path,
  };
}

export function supportsJsonOperationTransport(
  operation: HttpOperation,
): boolean {
  return (
    (operation.requestMediaType ?? "application/json") === "application/json" &&
    Object.values(operation.responseMediaTypes ?? {}).every(
      (mediaType) => mediaType === "application/json",
    )
  );
}

function mergeRequestHeaders(
  derived: Record<string, string> | undefined,
  overrides: Record<string, string> | undefined,
): Record<string, string> {
  const merged = { ...derived };
  for (const [name, value] of Object.entries(overrides ?? {})) {
    const normalizedName = name.toLowerCase();
    for (const existingName of Object.keys(merged)) {
      if (existingName.toLowerCase() === normalizedName) {
        delete merged[existingName];
      }
    }
    merged[name] = value;
  }
  return merged;
}

export function createJsonOperationTransport(
  responseRequest: ResponseRequestFn,
): JsonOperationTransport {
  function requestResponseResult<Operation extends JsonOperation>(
    operation: Operation,
    input: JsonOperationRequestInput<Operation>,
    options?: RequestResultOptions,
  ): Promise<RequestResult<JsonOperationResponseEnvelope<Operation>>>;
  async function requestResponseResult(
    operation: JsonOperation,
    input: RuntimeJsonOperationRequestInput,
    options: RequestResultOptions = {},
  ): Promise<RequestResult<unknown>> {
    if (!supportsJsonOperationTransport(operation)) {
      throw new TypeError(
        `Unsupported JSON transport operation: ${operation.id}`,
      );
    }
    const derived = deriveRuntimeJsonOperationRequest(operation, input);
    const headers = mergeRequestHeaders(derived.headers, options.headers);
    const requestOptions =
      Object.keys(headers).length === 0 ? options : { ...options, headers };
    const result = await responseRequest(
      derived.path,
      derived.method,
      derived.body,
      requestOptions,
      additionalOperationSuccessStatuses(operation),
    );
    if (!result.ok) {
      return result;
    }
    return decodeJsonOperationResponse(
      responseRequest,
      operation,
      result.data,
      derived.path,
      options,
    );
  }

  async function requestResult<Operation extends JsonOperation>(
    operation: Operation,
    input: JsonOperationRequestInput<Operation>,
    options?: RequestResultOptions,
  ): Promise<RequestResult<JsonOperationResponse<Operation>>> {
    const result = await requestResponseResult(operation, input, options);
    return result.ok ? { data: result.data.data, ok: true } : result;
  }

  return {
    async request(operation, input, options) {
      const result = await requestResult(operation, input, options);
      return result.ok ? result.data : null;
    },
    requestResult,
    async requestResponse(operation, input, options) {
      const result = await requestResponseResult(operation, input, options);
      return result.ok ? result.data : null;
    },
    requestResponseResult,
  };
}
