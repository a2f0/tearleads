import type { DocumentCreateRequest } from "@tearleads/validators/request";
import {
  DOCUMENT_SYNC_ERROR_CODES,
  type DocumentCreateResponse,
} from "@tearleads/validators/response";
import type { DocumentCreateApi } from "../../../data/documents/shared/types";

export type DocumentCreateSubmission =
  | {
      readonly data: DocumentCreateResponse;
      readonly ok: true;
    }
  | {
      readonly code?: string | undefined;
      readonly message: string;
      readonly ok: false;
      readonly report?: (() => void) | undefined;
      readonly status: number | null;
    };

export function isStaleDocumentCreateTargetConflict(
  submission: DocumentCreateSubmission,
): boolean {
  return (
    !submission.ok &&
    submission.status === 409 &&
    submission.code === DOCUMENT_SYNC_ERROR_CODES.stateStale
  );
}

export async function submitDocumentCreate(
  apiClient: DocumentCreateApi,
  request: DocumentCreateRequest,
  expectedOrganizationId: string,
  stillCurrent: (() => boolean) | undefined,
): Promise<DocumentCreateSubmission> {
  return apiClient.createDocumentResult(request, {
    expectedPaymentRequiredOrganizationId: expectedOrganizationId,
    ...(stillCurrent ? { stillCurrent } : {}),
    reportErrors: false,
  });
}
