import {
  getContainerWriterProjectionOperation,
  getDocumentWriterProjectionOperation,
} from "@tearleads/validators/operation";
import type { ApiRequestRuntime } from "./apiRequestRuntime";
import { principalHistoryRequest } from "./principalHistoryRequest";
import type { OperationRequestFn, OperationRequestResultFn } from "./types";

/** Preparation and body deadlines sit inside projection-history negotiation. */
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
    if (
      method === "GET" &&
      (operation.id === "containers.writerProjection.get" ||
        operation.id === "documents.writerProjection.get")
    )
      return principalHistoryRequest(runtime, {
        path,
        validator,
        method,
        options: options ?? {},
        operation:
          operation.id === "containers.writerProjection.get"
            ? getContainerWriterProjectionOperation
            : getDocumentWriterProjectionOperation,
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
