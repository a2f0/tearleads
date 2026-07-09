import { createContext, type PropsWithChildren, useContext } from "react";

export interface DocumentBlobOpenRequest {
  blobId?: string | null | undefined;
  storageKey: string;
}

interface DocumentBlobOpenContextValue {
  openBlob: (request: DocumentBlobOpenRequest) => void;
}

const DocumentBlobOpenContext =
  createContext<DocumentBlobOpenContextValue | null>(null);

export function DocumentBlobOpenProvider(
  params: PropsWithChildren<{ value: DocumentBlobOpenContextValue }>,
) {
  return (
    <DocumentBlobOpenContext.Provider value={params.value}>
      {params.children}
    </DocumentBlobOpenContext.Provider>
  );
}

export function useDocumentBlobOpen(): DocumentBlobOpenContextValue | null {
  return useContext(DocumentBlobOpenContext);
}
