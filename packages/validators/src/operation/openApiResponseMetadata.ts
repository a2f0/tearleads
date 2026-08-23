import type { z } from "zod";
import type { HttpOperation } from "./definition";

function hasRegisteredResponseStatus(
  status: number,
  successResponses: ReadonlyMap<number, z.ZodType>,
  emptySuccessStatuses: ReadonlySet<number>,
  failureStatuses: ReadonlySet<number>,
): boolean {
  return (
    successResponses.has(status) ||
    emptySuccessStatuses.has(status) ||
    failureStatuses.has(status)
  );
}

function assertRegisteredResponseStatusMetadata(
  operation: HttpOperation,
  metadata: object | undefined,
  metadataLabel: string,
  successResponses: ReadonlyMap<number, z.ZodType>,
  emptySuccessStatuses: ReadonlySet<number>,
  failureStatuses: ReadonlySet<number>,
): void {
  for (const status of Object.keys(metadata ?? {})) {
    if (
      !hasRegisteredResponseStatus(
        Number(status),
        successResponses,
        emptySuccessStatuses,
        failureStatuses,
      )
    ) {
      throw new Error(
        `${operation.id} declares ${metadataLabel} for unregistered response status ${status}`,
      );
    }
  }
}

export function assertResponseMetadata(
  operation: HttpOperation,
  successResponses: ReadonlyMap<number, z.ZodType>,
  emptySuccessStatuses: ReadonlySet<number>,
  failureStatuses: ReadonlySet<number>,
  failureResponses: ReadonlyMap<number, z.ZodType>,
): void {
  for (const status of successResponses.keys()) {
    if (emptySuccessStatuses.has(status) || failureStatuses.has(status)) {
      throw new Error(`${operation.id} declares status ${status} twice`);
    }
  }
  for (const status of emptySuccessStatuses) {
    if (failureStatuses.has(status)) {
      throw new Error(`${operation.id} declares status ${status} twice`);
    }
  }
  if (
    emptySuccessStatuses.size !== (operation.emptyResponseStatuses?.length ?? 0)
  ) {
    throw new Error(`${operation.id} repeats an empty response status`);
  }
  for (const status of failureResponses.keys()) {
    if (!failureStatuses.has(status)) {
      throw new Error(
        `${operation.id} declares a body for unregistered failure status ${status}`,
      );
    }
  }
  for (const status of Object.keys(operation.responseMediaTypes ?? {})) {
    if (!successResponses.has(Number(status))) {
      throw new Error(
        `${operation.id} declares a media type for unregistered response status ${status}`,
      );
    }
  }
  assertRegisteredResponseStatusMetadata(
    operation,
    operation.responseHeaders,
    "headers",
    successResponses,
    emptySuccessStatuses,
    failureStatuses,
  );
  assertRegisteredResponseStatusMetadata(
    operation,
    operation.responseDescriptions,
    "a description",
    successResponses,
    emptySuccessStatuses,
    failureStatuses,
  );
}
