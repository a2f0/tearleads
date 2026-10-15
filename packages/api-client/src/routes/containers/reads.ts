import {
  getContainerKekLogOperation,
  isGetContainerKekLogOperationResponse,
  isListContainerDocumentLanesOperationResponse,
  isListContainerParentLanesOperationResponse,
  listContainerDocumentLanesOperation,
  listContainerParentLanesOperation,
  operationRequestPath,
  operationRequestPathWithQuery,
} from "@tearleads/validators/operation";
import type {
  ListContainerDocumentLanesRequest,
  ListContainerParentLanesRequest,
} from "@tearleads/validators/request";
import {
  CONTAINER_NOT_FOUND_ERROR_CODE,
  type ListContainerDocumentLanesResponse,
  type ListContainerParentLanesResponse,
} from "@tearleads/validators/response";
import type { RequestResult } from "../../types";

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

function resultsMatchLanes(
  lanes: ReadonlyArray<{ readonly laneId: string }>,
  results: ReadonlyArray<{ readonly laneId: string }>,
): boolean {
  const expectedLaneIds = new Set(lanes.map((lane) => lane.laneId));
  return (
    results.length === lanes.length &&
    results.every((result) => expectedLaneIds.has(result.laneId))
  );
}

export const containerDocumentLanes = {
  isResponseForRequest: (
    input: ListContainerDocumentLanesRequest,
    value: unknown,
  ): value is ListContainerDocumentLanesResponse =>
    isListContainerDocumentLanesOperationResponse(value) &&
    resultsMatchLanes(input.lanes, value.results),
  method: listContainerDocumentLanesOperation.method,
  path: operationRequestPath(listContainerDocumentLanesOperation, {}),
  /**
   * Identical concurrent batches share one silent fetch; each caller then
   * applies its own reporting policy. A lane rejected for anything but a
   * positive absence proof is reported like the failed request it replaces.
   */
  settle: (
    result: RequestResult<ListContainerDocumentLanesResponse> | null,
    reportErrors: boolean,
    reportError: (message: string) => void,
  ): ListContainerDocumentLanesResponse | null => {
    if (result?.ok !== true) {
      if (reportErrors) result?.report();
      return null;
    }
    if (reportErrors) {
      for (const lane of result.data.results) {
        // Only the exact 404 + absence-code pair proves the container is gone.
        if (
          "failure" in lane &&
          !(
            lane.failure.status === 404 &&
            lane.failure.code === CONTAINER_NOT_FOUND_ERROR_CODE
          )
        )
          reportError(
            `${listContainerDocumentLanesOperation.method} ${listContainerDocumentLanesOperation.path}: ${lane.failure.status} ${lane.failure.error}`,
          );
      }
    }
    return result.data;
  },
} as const;

export const containerParentLanes = {
  isResponseForRequest: (
    input: ListContainerParentLanesRequest,
    value: unknown,
  ): value is ListContainerParentLanesResponse => {
    return (
      isListContainerParentLanesOperationResponse(value) &&
      resultsMatchLanes(input.lanes, value.results)
    );
  },
  method: listContainerParentLanesOperation.method,
  path: operationRequestPath(listContainerParentLanesOperation, {}),
} as const;
