import type { HttpOperation } from "@tearleads/validators/operation";
import {
  type BinaryResponseOperationTransport,
  createBinaryResponseOperationTransport,
  supportsBinaryResponseOperationTransport,
} from "./binaryResponseOperationTransport";
import {
  createJsonOperationTransport,
  type JsonOperationTransport,
  supportsJsonOperationTransport,
} from "./operationTransport";
import type { ResponseRequestFn } from "./types";

export type OperationTransport = JsonOperationTransport &
  BinaryResponseOperationTransport;

export function supportsOperationTransport(operation: HttpOperation): boolean {
  return (
    supportsJsonOperationTransport(operation) ||
    supportsBinaryResponseOperationTransport(operation)
  );
}

export function createOperationTransport(
  responseRequest: ResponseRequestFn,
): OperationTransport {
  return {
    ...createJsonOperationTransport(responseRequest),
    ...createBinaryResponseOperationTransport(responseRequest),
  };
}
