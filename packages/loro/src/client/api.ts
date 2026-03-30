import {
  type CreateDocumentResponse,
  isCreateDocumentResponse,
  isSyncDocumentResponse,
  type SyncDocumentOutgoingUpdate,
  type SyncDocumentResponse,
} from "../shared";

export type LoroRequestFn = <T>(
  path: string,
  validator: (value: unknown) => value is T,
  method: "GET" | "POST",
  body?: string,
) => Promise<T | null>;

export function createDocument(
  request: LoroRequestFn,
): Promise<CreateDocumentResponse | null> {
  return request("/documents", isCreateDocumentResponse, "POST");
}

export function syncDocument(
  request: LoroRequestFn,
  documentId: string,
  accessEpoch: number,
  localVersionVector: string | null,
  outgoingUpdates: SyncDocumentOutgoingUpdate[],
): Promise<SyncDocumentResponse | null> {
  return request(
    `/documents/${documentId}/sync`,
    isSyncDocumentResponse,
    "POST",
    JSON.stringify({
      accessEpoch,
      localVersionVector,
      outgoingUpdates,
    }),
  );
}
