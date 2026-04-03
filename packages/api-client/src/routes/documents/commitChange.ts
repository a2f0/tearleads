import type { CommitDocumentChangeRequest } from "@tearleads/validators/request";
import { isCommitDocumentChangeResponse } from "@tearleads/validators/response";
import type { RequestFn } from "../../types";

export function commitDocumentChange(
  request: RequestFn,
  documentId: string,
  input: CommitDocumentChangeRequest,
) {
  return request(
    `/documents/${documentId}/commit-change`,
    isCommitDocumentChangeResponse,
    "POST",
    JSON.stringify(input),
  );
}
