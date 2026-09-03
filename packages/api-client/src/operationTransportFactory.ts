import {
  type BinaryRequestOperationTransport,
  createBinaryRequestOperationTransport,
} from "./binaryRequestOperationTransport";
import {
  type BinaryResponseOperationTransport,
  createBinaryResponseOperationTransport,
} from "./binaryResponseOperationTransport";
import {
  createJsonOperationTransport,
  type JsonOperationTransport,
} from "./operationTransport";
import type { OperationResponseRequestFn } from "./types";

export type OperationTransport = BinaryRequestOperationTransport &
  JsonOperationTransport &
  BinaryResponseOperationTransport;

export function createOperationTransport(
  responseRequest: OperationResponseRequestFn,
): OperationTransport {
  return {
    ...createBinaryRequestOperationTransport(responseRequest),
    ...createJsonOperationTransport(responseRequest),
    ...createBinaryResponseOperationTransport(responseRequest),
  };
}
