import type { StoredDocumentKind } from "../../data/documents/documentKinds";

export type BlobInfoAttachmentKind = "local" | "pending";
export type BlobInfoSortDirection = "asc" | "desc";
export type BlobInfoSortKey = "byteLength" | "mimeType" | "updated";

export interface BlobInfoSort {
  readonly direction: BlobInfoSortDirection;
  readonly key: BlobInfoSortKey;
}

export interface BlobInfoDocumentReference {
  readonly attachmentKind: BlobInfoAttachmentKind;
  readonly blobId: string | null;
  readonly byteLength: number;
  readonly containerId: string | null;
  readonly createdAt: string | null;
  readonly documentId: string | null;
  readonly documentKind: StoredDocumentKind | null;
  readonly documentTitle: string | null;
  readonly localId: string;
  readonly mimeType: string | null;
  readonly name: string | null;
  readonly slotId: string;
  readonly storageKey: string;
  readonly updatedAt: string | null;
}

export interface BlobInfo {
  readonly blobId: string | null;
  readonly byteLength: number;
  readonly createdAt: string | null;
  readonly documentCount: number;
  readonly key: string;
  readonly mimeType: string | null;
  readonly name: string | null;
  readonly referenceCount: number;
  readonly references: ReadonlyArray<BlobInfoDocumentReference>;
  readonly storageKey: string;
  readonly updatedAt: string | null;
}

export interface BlobInfoList {
  readonly rows: ReadonlyArray<BlobInfo>;
  readonly totalCount: number;
}

export interface BlobInfoInput {
  readonly limit?: number | undefined;
  readonly offset?: number | undefined;
  readonly query?: string | undefined;
  readonly sort?: BlobInfoSort | undefined;
}
