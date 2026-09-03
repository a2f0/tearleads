import {
  type HttpOperation,
  type OperationSchemaOutput,
  operationResponseHeaderNames,
} from "@tearleads/validators/operation";
import { errorMessage } from "./requestInternals";
import type {
  RequestResult,
  RequestResultOptions,
  ResponseRequestFn,
} from "./types";

export interface JsonResponseOperation extends HttpOperation {
  readonly responseMediaTypes?: Readonly<Record<number, "application/json">>;
}

type BodyResponseStatus<Operation extends JsonResponseOperation> = Extract<
  keyof Operation["responses"],
  number
>;

type EmptyResponseStatus<Operation extends JsonResponseOperation> =
  Operation extends {
    readonly emptyResponseStatuses: readonly (infer Status)[];
  }
    ? Extract<Status, number>
    : never;

type SuccessStatus<Operation extends JsonResponseOperation> =
  | BodyResponseStatus<Operation>
  | EmptyResponseStatus<Operation>;

type ResponseBodyForStatus<
  Operation extends JsonResponseOperation,
  Status extends number,
> = Status extends keyof Operation["responses"]
  ? OperationSchemaOutput<
      Extract<Operation["responses"][Status], HttpOperation["params"]>
    >
  : undefined;

export type OperationResponseHeadersForStatus<
  Operation extends HttpOperation,
  Status extends number,
> = Operation extends {
  readonly responseHeaders: infer Headers extends Readonly<
    Record<number, HttpOperation["params"]>
  >;
}
  ? Status extends keyof Headers
    ? OperationSchemaOutput<Extract<Headers[Status], HttpOperation["params"]>>
    : undefined
  : undefined;

export type JsonOperationResponseEnvelope<
  Operation extends JsonResponseOperation,
> = {
  [Status in SuccessStatus<Operation>]: {
    readonly data: ResponseBodyForStatus<Operation, Status>;
    readonly headers: OperationResponseHeadersForStatus<Operation, Status>;
    readonly status: Status;
  };
}[SuccessStatus<Operation>];

export type JsonOperationResponse<Operation extends JsonResponseOperation> = {
  [Status in SuccessStatus<Operation>]: ResponseBodyForStatus<
    Operation,
    Status
  >;
}[SuccessStatus<Operation>];

export function additionalOperationSuccessStatuses(
  operation: HttpOperation,
): readonly number[] {
  return [
    ...Object.keys(operation.responses).map(Number),
    ...(operation.emptyResponseStatuses ?? []),
  ].filter((status) => status < 200 || status >= 300);
}

interface RuntimeJsonOperationResponseEnvelope {
  readonly data: unknown;
  readonly headers: unknown;
  readonly status: number;
}

export function operationResponseFailure(
  request: ResponseRequestFn,
  operation: HttpOperation,
  response: Response,
  path: string,
  options: RequestResultOptions,
  message: string,
) {
  return request.reportFailure({
    kind: "shape",
    message,
    method: operation.method,
    options,
    path,
    status: response.status,
    statusText: response.statusText,
  });
}

export function decodeOperationResponseHeaders(
  operation: HttpOperation,
  response: Response,
): { readonly data: unknown; readonly ok: true } | { readonly ok: false } {
  const schema = operation.responseHeaders?.[response.status];
  if (!schema) {
    return { data: undefined, ok: true };
  }

  const values: Record<string, string> = {};
  for (const name of operationResponseHeaderNames(operation, response.status)) {
    const value = response.headers.get(name);
    if (value !== null) {
      values[name] = value;
    }
  }

  const parsed = schema.safeParse(values);
  return parsed.success ? { data: parsed.data, ok: true } : { ok: false };
}

export async function decodeJsonOperationResponse(
  request: ResponseRequestFn,
  operation: JsonResponseOperation,
  response: Response,
  path: string,
  options: RequestResultOptions,
): Promise<RequestResult<RuntimeJsonOperationResponseEnvelope>> {
  const schema = operation.responses[response.status];
  const isEmpty =
    operation.emptyResponseStatuses?.includes(response.status) ?? false;
  if (!schema && !isEmpty) {
    return operationResponseFailure(
      request,
      operation,
      response,
      path,
      options,
      `Invalid response status ${response.status} for ${path}`,
    );
  }

  const headers = decodeOperationResponseHeaders(operation, response);
  if (!headers.ok) {
    return operationResponseFailure(
      request,
      operation,
      response,
      path,
      options,
      `Invalid response headers for ${path}`,
    );
  }

  let data: unknown;
  if (!isEmpty && schema) {
    let value: unknown;
    try {
      value = await response.json();
    } catch (error) {
      const message = errorMessage(error);
      return request.reportFailure({
        kind: "json",
        message: `${operation.method} ${path}: failed to parse JSON: ${message}`,
        method: operation.method,
        options,
        path,
        status: response.status,
        statusText: response.statusText,
      });
    }

    const parsed = schema.safeParse(value);
    if (!parsed.success) {
      return operationResponseFailure(
        request,
        operation,
        response,
        path,
        options,
        `Invalid response shape for ${path}`,
      );
    }
    data = parsed.data;
  }

  return {
    data: { data, headers: headers.data, status: response.status },
    ok: true,
  };
}
