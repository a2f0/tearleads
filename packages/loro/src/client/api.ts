import {
  type CreateDocumentRequest,
  type CreateDocumentResponse,
  isCreateDocumentRequest,
  isCreateDocumentResponse,
  isSyncDocumentResponse,
  type SerializedRecipientEnvelope,
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
  linkedContainerIds: string[],
  expectedLinkedContainerAccessStateHashes: Record<string, string>,
): Promise<CreateDocumentResponse | null> {
  const body: CreateDocumentRequest = {
    expectedLinkedContainerAccessStateHashes,
    linkedContainerIds,
  };

  if (!isCreateDocumentRequest(body)) {
    return Promise.resolve(null);
  }

  return request(
    "/documents",
    isCreateDocumentResponse,
    "POST",
    JSON.stringify(body),
  );
}

export function syncDocument(
  request: LoroRequestFn,
  documentId: string,
  accessEpoch: number,
  localVersionVector: string | null,
  outgoingUpdates: SyncDocumentOutgoingUpdate[],
  documentRecipientEnvelopes?: SerializedRecipientEnvelope[],
  minLsn?: string,
  expectedAccessStateHash?: string,
): Promise<SyncDocumentResponse | null> {
  return request(
    `/documents/${documentId}/sync`,
    isSyncDocumentResponse,
    "POST",
    JSON.stringify({
      accessEpoch,
      expectedAccessStateHash,
      documentRecipientEnvelopes,
      localVersionVector,
      minLsn,
      outgoingUpdates,
    }),
  );
}
