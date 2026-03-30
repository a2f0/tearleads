import {
  type AppendDocumentUpdateResponse,
  type CreateDocumentResponse,
  type GetDocumentUpdatesResponse,
  isAppendDocumentUpdateResponse,
  isCreateDocumentResponse,
  isGetDocumentUpdatesResponse,
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

export function appendDocumentUpdate(
  request: LoroRequestFn,
  documentId: string,
  encryptedData: string,
): Promise<AppendDocumentUpdateResponse | null> {
  return request(
    `/documents/${documentId}/updates`,
    isAppendDocumentUpdateResponse,
    "POST",
    JSON.stringify({ encryptedData }),
  );
}

export function getDocumentUpdates(
  request: LoroRequestFn,
  documentId: string,
  since?: number,
): Promise<GetDocumentUpdatesResponse | null> {
  const query = since === undefined ? "" : `?since=${since}`;
  return request(
    `/documents/${documentId}/updates${query}`,
    isGetDocumentUpdatesResponse,
    "GET",
  );
}
