import type {
  BlobAttachmentBindResponse,
  BlobAttachmentDetachResponse,
} from "@tearleads/validators/response";
import {
  type BindBlobAttachmentInput,
  type DetachBlobAttachmentInput,
  runBindBlobAttachmentWorkflow,
  runDetachBlobAttachmentWorkflow,
} from "../../workflows/blobs/mutations";
import type { ApiServiceRuntime } from "../runtime";

export { BlobMutationError } from "../../workflows/blobs/mutations";

export async function bindBlobAttachment(
  runtime: ApiServiceRuntime,
  input: BindBlobAttachmentInput,
): Promise<BlobAttachmentBindResponse> {
  return runBindBlobAttachmentWorkflow(runtime.db, input);
}

export async function detachBlobAttachment(
  runtime: ApiServiceRuntime,
  input: DetachBlobAttachmentInput,
): Promise<BlobAttachmentDetachResponse> {
  return runDetachBlobAttachmentWorkflow(runtime.db, input);
}
