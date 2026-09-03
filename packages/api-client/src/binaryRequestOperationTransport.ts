import {
  BinaryBodySchema,
  type HttpOperation,
} from "@tearleads/validators/operation";
import {
  additionalOperationSuccessStatuses,
  decodeJsonOperationResponse,
  type JsonOperationResponse,
  type JsonOperationResponseEnvelope,
  type JsonResponseOperation,
} from "./operationResponse";
import {
  deriveRuntimeOperationRequestMetadata,
  mergeOperationRequestHeaders,
  type OperationRequestInput,
  type RuntimeOperationRequestInput,
} from "./operationTransport";
import type {
  RequestResult,
  RequestResultOptions,
  ResponseRequestFn,
} from "./types";

export interface BinaryRequestOperation extends JsonResponseOperation {
  readonly body: typeof BinaryBodySchema;
  readonly requestMediaType: "application/octet-stream";
}

export interface BinaryRequestOperationOptions extends RequestResultOptions {
  readonly encodeBody: (body: Blob | BufferSource) => BodyInit;
}

export interface BinaryRequestOperationTransport {
  requestBinaryRequest<Operation extends BinaryRequestOperation>(
    operation: Operation,
    input: OperationRequestInput<Operation>,
    options: BinaryRequestOperationOptions,
  ): Promise<JsonOperationResponse<Operation> | null>;
  requestBinaryRequestResult<Operation extends BinaryRequestOperation>(
    operation: Operation,
    input: OperationRequestInput<Operation>,
    options: BinaryRequestOperationOptions,
  ): Promise<RequestResult<JsonOperationResponse<Operation>>>;
  requestBinaryRequestResponse<Operation extends BinaryRequestOperation>(
    operation: Operation,
    input: OperationRequestInput<Operation>,
    options: BinaryRequestOperationOptions,
  ): Promise<JsonOperationResponseEnvelope<Operation> | null>;
  requestBinaryRequestResponseResult<Operation extends BinaryRequestOperation>(
    operation: Operation,
    input: OperationRequestInput<Operation>,
    options: BinaryRequestOperationOptions,
  ): Promise<RequestResult<JsonOperationResponseEnvelope<Operation>>>;
}

export function supportsBinaryRequestOperationTransport(
  operation: HttpOperation,
): boolean {
  return (
    operation.requestMediaType === "application/octet-stream" &&
    operation.body === BinaryBodySchema &&
    Object.values(operation.responseMediaTypes ?? {}).every(
      (mediaType) => mediaType === "application/json",
    )
  );
}

function binaryRequestBody(
  operation: BinaryRequestOperation,
  input: RuntimeOperationRequestInput,
  encodeBody: BinaryRequestOperationOptions["encodeBody"],
): BodyInit {
  const parsed = operation.body.safeParse(input.body);
  if (!parsed.success) {
    throw new TypeError(`Invalid request body for ${operation.id}`);
  }
  return encodeBody(parsed.data);
}

export function createBinaryRequestOperationTransport(
  responseRequest: ResponseRequestFn,
): BinaryRequestOperationTransport {
  function requestBinaryRequestResponseResult<
    Operation extends BinaryRequestOperation,
  >(
    operation: Operation,
    input: OperationRequestInput<Operation>,
    options: BinaryRequestOperationOptions,
  ): Promise<RequestResult<JsonOperationResponseEnvelope<Operation>>>;
  async function requestBinaryRequestResponseResult(
    operation: BinaryRequestOperation,
    input: RuntimeOperationRequestInput,
    options: BinaryRequestOperationOptions,
  ): Promise<RequestResult<unknown>> {
    if (!supportsBinaryRequestOperationTransport(operation)) {
      throw new TypeError(
        `Unsupported binary request transport operation: ${operation.id}`,
      );
    }
    const { encodeBody, ...requestOptions } = options;
    const derived = deriveRuntimeOperationRequestMetadata(operation, input);
    const body = binaryRequestBody(operation, input, encodeBody);
    const headers = mergeOperationRequestHeaders(
      { "Content-Type": operation.requestMediaType, ...derived.headers },
      requestOptions.headers,
    );
    const result = await responseRequest(
      derived.path,
      derived.method,
      body,
      { ...requestOptions, headers },
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
      requestOptions,
    );
  }

  async function requestBinaryRequestResult<
    Operation extends BinaryRequestOperation,
  >(
    operation: Operation,
    input: OperationRequestInput<Operation>,
    options: BinaryRequestOperationOptions,
  ): Promise<RequestResult<JsonOperationResponse<Operation>>> {
    const result = await requestBinaryRequestResponseResult(
      operation,
      input,
      options,
    );
    return result.ok ? { data: result.data.data, ok: true } : result;
  }

  return {
    async requestBinaryRequest(operation, input, options) {
      const result = await requestBinaryRequestResult(
        operation,
        input,
        options,
      );
      return result.ok ? result.data : null;
    },
    requestBinaryRequestResult,
    async requestBinaryRequestResponse(operation, input, options) {
      const result = await requestBinaryRequestResponseResult(
        operation,
        input,
        options,
      );
      return result.ok ? result.data : null;
    },
    requestBinaryRequestResponseResult,
  };
}
