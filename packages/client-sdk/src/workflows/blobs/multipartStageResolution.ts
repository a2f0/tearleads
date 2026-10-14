import type {
  InitiateMultipartBlobStageResponse,
  MultipartBlobStageStatusResponse,
} from "@tearleads/validators/response";
import type { BlobEncryptionPlan } from "../../data/documents/blob/shared/crypto";
import type {
  BlobAttachmentApi,
  UploadDocumentAttachmentInput,
} from "../../data/documents/blob/shared/types";
import {
  type MultipartFirstParts,
  type MultipartPartSources,
  type PreparedFirstPart,
  prepareFirstMultipartParts,
  readIssuedPartSources,
  releasePreparedParts,
} from "./multipartFirstParts";
import {
  assertMultipartStageReplaceable,
  multipartApiFailureMessage,
} from "./multipartStageFailures";

function isMultipartStageStatus(
  stage: InitiateMultipartBlobStageResponse | MultipartBlobStageStatusResponse,
): stage is MultipartBlobStageStatusResponse {
  return "completed" in stage && typeof stage.completed === "boolean";
}

interface ResolveMultipartStageInput {
  readonly apiClient: BlobAttachmentApi;
  readonly concurrency: number;
  readonly encryption: BlobEncryptionPlan;
  readonly multipart: NonNullable<UploadDocumentAttachmentInput["multipart"]>;
  readonly organizationId: string;
  readonly onStageUnavailable?:
    | ((stageId: string) => Promise<void>)
    | undefined;
}

interface ResolvedMultipartStage {
  readonly prepared: Map<number, PreparedFirstPart>;
  readonly sources: MultipartPartSources;
  readonly status: MultipartBlobStageStatusResponse;
}

async function resumeMultipartStage(
  input: ResolveMultipartStageInput,
  resumeStageId: string,
): Promise<MultipartBlobStageStatusResponse | null> {
  const resumed = await input.apiClient.getMultipartBlobStage(resumeStageId);
  if (!resumed) {
    await assertMultipartStageReplaceable({
      apiClient: input.apiClient,
      onStageUnavailable: input.onStageUnavailable,
      stageId: resumeStageId,
    });
    return null;
  }
  if (resumed.stageId !== resumeStageId) {
    throw new Error(
      `Multipart blob resume response does not match stage ${resumeStageId}.`,
    );
  }
  // A successful lookup is authoritative: a metadata mismatch indicates
  // inconsistent persisted state or a bad server response, not proof that
  // the existing stage is safe to abandon.
  if (
    resumed.organizationId !== input.organizationId ||
    resumed.byteLength !== input.encryption.byteLength ||
    resumed.sha256 !== input.encryption.sha256
  ) {
    throw new Error(
      `Multipart blob resume stage ${resumeStageId} does not match the requested organization or bytes.`,
    );
  }
  return resumed;
}

async function initiateWithFirstParts(
  input: ResolveMultipartStageInput,
  firstParts: MultipartFirstParts,
): Promise<ResolvedMultipartStage> {
  const { byteLength, sha256 } = input.encryption;
  const stage = await input.apiClient.initiateMultipartBlobStage({
    organizationId: input.organizationId,
    byteLength,
    firstParts: [...firstParts.descriptors],
    sha256,
  });
  if (!stage) {
    throw new Error(
      multipartApiFailureMessage({
        apiClient: input.apiClient,
        fallback: `Multipart blob stage initiation failed for ${byteLength.toLocaleString()} bytes.`,
        request: { method: "POST", path: "/blobs/stages/multipart" },
      }),
    );
  }
  if (
    stage.organizationId !== input.organizationId ||
    stage.byteLength !== byteLength ||
    stage.sha256 !== sha256
  ) {
    throw new Error(
      "Multipart blob stage initiation response does not match its request.",
    );
  }
  return {
    prepared: firstParts.prepared,
    sources: readIssuedPartSources(firstParts.descriptors, stage),
    status: isMultipartStageStatus(stage)
      ? stage
      : { ...stage, completed: false },
  };
}

// A new stage carries the parts the upload starts with, so their upload
// sources come back with the stage instead of one authorization each. Their
// bytes hold transfer-pool slots until uploaded, or until initiation fails.
async function initiateMultipartStage(
  input: ResolveMultipartStageInput,
): Promise<ResolvedMultipartStage> {
  const firstParts = await prepareFirstMultipartParts(
    input.apiClient,
    input.encryption,
    input.concurrency,
  );
  try {
    return await initiateWithFirstParts(input, firstParts);
  } catch (error) {
    releasePreparedParts(firstParts.prepared);
    throw error;
  }
}

export async function resolveMultipartStage(
  input: ResolveMultipartStageInput,
): Promise<ResolvedMultipartStage> {
  const resumeStageId = input.multipart.resumeStageId;
  const resumed = resumeStageId
    ? await resumeMultipartStage(input, resumeStageId)
    : null;
  return resumed
    ? {
        prepared: new Map(),
        sources: { apiTransport: false, issued: new Map() },
        status: resumed,
      }
    : initiateMultipartStage(input);
}
