import type { HttpOperation } from "@tearleads/validators/operation";
import {
  additionalOperationSuccessStatuses,
  decodeOperationResponseHeaders,
  type OperationResponseHeadersForStatus,
  operationResponseFailure,
} from "./operationResponse";
import {
  deriveRuntimeOperationRequest,
  mergeOperationRequestHeaders,
  type OperationRequestInput,
  type RuntimeOperationRequestInput,
} from "./operationTransport";
import type {
  RequestResult,
  RequestResultOptions,
  ResponseRequestFn,
} from "./types";

export interface BinaryResponseOperation extends HttpOperation {
  readonly requestMediaType?: "application/json";
  readonly responseMediaTypes: Readonly<
    Record<number, "application/octet-stream">
  >;
}

type BinaryResponseStatus<Operation extends BinaryResponseOperation> = Extract<
  keyof Operation["responses"],
  number
>;

export type BinaryOperationResponseEnvelope<
  Operation extends BinaryResponseOperation,
> = {
  [Status in BinaryResponseStatus<Operation>]: {
    readonly headers: OperationResponseHeadersForStatus<Operation, Status>;
    readonly response: Response;
    readonly status: Status;
  };
}[BinaryResponseStatus<Operation>];

interface RuntimeBinaryOperationResponseEnvelope {
  readonly headers: unknown;
  readonly response: Response;
  readonly status: number;
}

export interface BinaryResponseOperationTransport {
  requestBinaryResponse<Operation extends BinaryResponseOperation>(
    operation: Operation,
    input: OperationRequestInput<Operation>,
    options?: RequestResultOptions,
  ): Promise<BinaryOperationResponseEnvelope<Operation> | null>;
  requestBinaryResponseResult<Operation extends BinaryResponseOperation>(
    operation: Operation,
    input: OperationRequestInput<Operation>,
    options?: RequestResultOptions,
  ): Promise<RequestResult<BinaryOperationResponseEnvelope<Operation>>>;
}

export function supportsBinaryResponseOperationTransport(
  operation: HttpOperation,
): boolean {
  const responseStatuses = Object.keys(operation.responses).map(Number);
  return (
    (operation.requestMediaType ?? "application/json") === "application/json" &&
    (operation.emptyResponseStatuses?.length ?? 0) === 0 &&
    responseStatuses.length > 0 &&
    responseStatuses.every(
      (status) =>
        operation.responseMediaTypes?.[status] === "application/octet-stream",
    )
  );
}

async function decodeBinaryOperationResponse(
  request: ResponseRequestFn,
  operation: BinaryResponseOperation,
  response: Response,
  path: string,
  options: RequestResultOptions,
): Promise<RequestResult<RuntimeBinaryOperationResponseEnvelope>> {
  if (
    !operation.responses[response.status] ||
    operation.responseMediaTypes[response.status] !== "application/octet-stream"
  ) {
    return operationResponseFailure(
      request,
      operation,
      response,
      path,
      options,
      `Invalid binary response status ${response.status} for ${path}`,
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

  return {
    data: {
      headers: headers.data,
      response,
      status: response.status,
    },
    ok: true,
  };
}

export function createBinaryResponseOperationTransport(
  responseRequest: ResponseRequestFn,
): BinaryResponseOperationTransport {
  function requestBinaryResponseResult<
    Operation extends BinaryResponseOperation,
  >(
    operation: Operation,
    input: OperationRequestInput<Operation>,
    options?: RequestResultOptions,
  ): Promise<RequestResult<BinaryOperationResponseEnvelope<Operation>>>;
  async function requestBinaryResponseResult(
    operation: BinaryResponseOperation,
    input: RuntimeOperationRequestInput,
    options: RequestResultOptions = {},
  ): Promise<RequestResult<RuntimeBinaryOperationResponseEnvelope>> {
    if (!supportsBinaryResponseOperationTransport(operation)) {
      throw new TypeError(
        `Unsupported binary response transport operation: ${operation.id}`,
      );
    }
    const derived = deriveRuntimeOperationRequest(operation, input);
    const headers = mergeOperationRequestHeaders(
      derived.headers,
      options.headers,
    );
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
    return decodeBinaryOperationResponse(
      responseRequest,
      operation,
      result.data,
      derived.path,
      options,
    );
  }

  return {
    async requestBinaryResponse(operation, input, options) {
      const result = await requestBinaryResponseResult(
        operation,
        input,
        options,
      );
      return result.ok ? result.data : null;
    },
    requestBinaryResponseResult,
  };
}
