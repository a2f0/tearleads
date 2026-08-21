import {
  getContainerKekLogOperation,
  isGetContainerKekLogOperationResponse,
  isListContainerDocumentsOperationResponse,
  isListContainerParentLanesOperationResponse,
  listContainerDocumentsOperation,
  listContainerParentLanesOperation,
  operationRequestPath,
  operationRequestPathWithQuery,
} from "@symcrypt/validators/operation";
import type { ListContainerParentLanesRequest } from "@symcrypt/validators/request";
import type { ListContainerParentLanesResponse } from "@symcrypt/validators/response";
import type { ListContainerDocumentsOptions } from "../../types";

export interface ContainerKekLogOptions {
  readonly afterKeyEpoch?: number;
  readonly keyringForEpoch?: number;
}

export const containerKekLog = {
  isResponse: isGetContainerKekLogOperationResponse,
  method: getContainerKekLogOperation.method,
  path: (containerId: string, options: ContainerKekLogOptions = {}) =>
    operationRequestPathWithQuery(
      getContainerKekLogOperation,
      { containerId },
      {
        keyringForEpoch: options.keyringForEpoch,
        afterKeyEpoch: options.afterKeyEpoch,
      },
    ),
} as const;

export const containerDocuments = {
  isResponse: isListContainerDocumentsOperationResponse,
  method: listContainerDocumentsOperation.method,
  path: (containerId: string, options?: ListContainerDocumentsOptions) =>
    operationRequestPathWithQuery(
      listContainerDocumentsOperation,
      { containerId },
      {
        watermarkUpdatedAt: options?.watermark?.updatedAt,
        watermarkId: options?.watermark?.id,
        limit: options?.limit,
      },
    ),
} as const;

export const containerParentLanes = {
  isResponseForRequest: (
    input: ListContainerParentLanesRequest,
    value: unknown,
  ): value is ListContainerParentLanesResponse => {
    if (!isListContainerParentLanesOperationResponse(value)) {
      return false;
    }
    const expectedLaneIds = new Set(input.lanes.map((lane) => lane.laneId));
    return (
      value.results.length === input.lanes.length &&
      value.results.every((result) => expectedLaneIds.has(result.laneId))
    );
  },
  method: listContainerParentLanesOperation.method,
  path: operationRequestPath(listContainerParentLanesOperation, {}),
} as const;
