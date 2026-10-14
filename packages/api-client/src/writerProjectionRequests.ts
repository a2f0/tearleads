import {
  getContainerWriterProjectionOperation,
  getDocumentWriterProjectionOperation,
} from "@tearleads/validators/operation";
import {
  decodeContainerWriterProjection,
  decodeDocumentWriterProjection,
} from "@tearleads/validators/response";
import type { ApiRequestRuntime } from "./apiRequestRuntime";
import { principalHistoryRequest } from "./principalHistoryRequest";
import type { OperationRequestFn, OperationRequestResultFn } from "./types";

/**
 * Preparation and body deadlines sit inside projection-history negotiation.
 * The wire cites each manifest bundle by hash; decoding resolves every
 * citation before any validator, cache, or verifier sees the projection.
 */
export function writerProjectionRequests(runtime: ApiRequestRuntime): {
  request: OperationRequestFn;
  requestResult: OperationRequestResultFn;
} {
  const requestResult: OperationRequestResultFn = (
    path,
    validator,
    method,
    body,
    options,
    operation,
  ) => {
    if (method === "GET" && operation.id === "containers.writerProjection.get")
      return principalHistoryRequest(runtime, {
        path,
        validator,
        decode: decodeContainerWriterProjection,
        method,
        options: options ?? {},
        operation: getContainerWriterProjectionOperation,
      });
    if (method === "GET" && operation.id === "documents.writerProjection.get")
      return principalHistoryRequest(runtime, {
        path,
        validator,
        decode: decodeDocumentWriterProjection,
        method,
        options: options ?? {},
        operation: getDocumentWriterProjectionOperation,
      });
    return runtime.requestResult(
      path,
      validator,
      method,
      body,
      options,
      operation,
    );
  };
  const request: OperationRequestFn = async (...args) => {
    const result = await requestResult(...args);
    return result.ok ? result.data : null;
  };
  return { request, requestResult };
}
