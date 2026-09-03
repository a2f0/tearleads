import type { HttpOperation } from "@tearleads/validators/operation";
import {
  type BinaryRequestOperationTransport,
  createBinaryRequestOperationTransport,
  supportsBinaryRequestOperationTransport,
} from "./binaryRequestOperationTransport";
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
import type { OperationResponseRequestFn } from "./types";

export type OperationTransport = BinaryRequestOperationTransport &
  JsonOperationTransport &
  BinaryResponseOperationTransport;

export function supportsOperationTransport(operation: HttpOperation): boolean {
  return (
    supportsJsonOperationTransport(operation) ||
    supportsBinaryRequestOperationTransport(operation) ||
    supportsBinaryResponseOperationTransport(operation)
  );
}

export function createOperationTransport(
  responseRequest: OperationResponseRequestFn,
): OperationTransport {
  return {
    ...createBinaryRequestOperationTransport(responseRequest),
    ...createJsonOperationTransport(responseRequest),
    ...createBinaryResponseOperationTransport(responseRequest),
  };
}
