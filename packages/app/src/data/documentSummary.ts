import type { StoredDocumentKind } from "./documents/documentKinds";

export interface DocumentSummary {
  accessStateHash?: string | null;
  id: string;
  containerId: string | null;
  documentKind?: StoredDocumentKind;
  documentId: string | null;
  title: string;
  updatedAt: string;
}

export interface DiscoveredDocumentInput {
  accessEpoch: number;
  accessStateHash?: string | null;
  containerId: string;
  createdAt: string;
  documentId: string;
  linkedContainerIds: ReadonlyArray<string>;
}
