import { MULTIPART_BLOB_STAGE_ERROR_CODES } from "@tearleads/validators/response";
import type { BlobAttachmentApi } from "../../data/documents/blob/shared/types";

type RequestFailureInput = Parameters<
  NonNullable<BlobAttachmentApi["getRequestFailure"]>
>[0];
type RequestFailure = ReturnType<
  NonNullable<BlobAttachmentApi["getRequestFailure"]>
>;

export function multipartStagePath(stageId: string): string {
  return `/blobs/stages/multipart/${encodeURIComponent(stageId)}`;
}

export function multipartApiFailureMessage(input: {
  readonly apiClient: BlobAttachmentApi;
  readonly fallback: string;
  readonly request: RequestFailureInput;
}): string {
  const failure = input.apiClient.getRequestFailure?.(input.request)?.message;
  return failure
    ? `${input.fallback} Last API failure: ${failure}`
    : input.fallback;
}

function provesMultipartStageReplacement(
  failure: RequestFailure | undefined,
): boolean {
  return (
    failure?.kind === "http" &&
    ((failure.status === 404 &&
      failure.code === MULTIPART_BLOB_STAGE_ERROR_CODES.notFound) ||
      (failure.status === 409 &&
        failure.code === MULTIPART_BLOB_STAGE_ERROR_CODES.expired))
  );
}

export async function assertMultipartStageReplaceable(input: {
  readonly apiClient: BlobAttachmentApi;
  readonly onStageUnavailable?:
    | ((stageId: string) => Promise<void>)
    | undefined;
  readonly stageId: string;
}): Promise<void> {
  const request = {
    method: "GET" as const,
    path: multipartStagePath(input.stageId),
  };
  const failure = input.apiClient.getRequestFailure?.(request);
  if (!provesMultipartStageReplacement(failure)) {
    throw new Error(
      multipartApiFailureMessage({
        apiClient: input.apiClient,
        fallback: `Multipart blob resume stage lookup failed for stage ${input.stageId}.`,
        request,
      }),
    );
  }
  if (input.onStageUnavailable) {
    await input.onStageUnavailable(input.stageId);
    throw new Error(
      "Multipart stage is unavailable; upload identity must be renewed.",
    );
  }
}
