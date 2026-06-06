import type { DocumentSummary } from "../../../data/documentSummary";
import type { StoredDocumentKind } from "../../../data/documents/documentKinds";
import type { ContainerDocumentTombstoneInput } from "../../../data/persistence/documents/documentsPersistence";
import type { ContainerContentsWorkflowSqlRuntime } from "../runtime";
import type { ContainerDocumentObjectSyncState } from "../syncState";

export interface ContainerDocumentLinkInput {
  containerIds: ReadonlyArray<string>;
  documentId: string;
}

export type ContainerDocumentTombstone = ContainerDocumentTombstoneInput;

export type ContainerItemSortKey = "name" | "type" | "created" | "modified";
export type ContainerItemSortDirection = "asc" | "desc";

export interface ContainerItemSort {
  direction: ContainerItemSortDirection;
  key: ContainerItemSortKey;
}

export type ContainerItemRow =
  | {
      createdAt: string | null;
      id: string;
      itemKind: "container";
      name: string;
      syncState: ContainerDocumentObjectSyncState;
      updatedAt: string | null;
    }
  | {
      containerId: string;
      createdAt: string | null;
      documentId: string | null;
      documentKind: StoredDocumentKind;
      itemKind: "document";
      localId: string;
      name: string;
      syncState: ContainerDocumentObjectSyncState;
      updatedAt: string | null;
    };

export interface ContainerItemWindow {
  rows: ReadonlyArray<ContainerItemRow>;
  totalCount: number;
}

export interface ContainerDocumentSidebarRow {
  containerId: string;
  documentId: string | null;
  documentKind: StoredDocumentKind;
  localId: string;
  syncState: ContainerDocumentObjectSyncState;
  title: string;
  updatedAt: string | null;
}

export interface ContainerDocumentSidebarWindow {
  rows: ReadonlyArray<ContainerDocumentSidebarRow>;
  totalCount: number;
}

export interface ContainerContentsDocumentRuntimeTarget {
  documentId: string | null;
  localId: string;
  runtimeContainerId: string;
}

export type ContainerDocumentQueriesRuntime =
  ContainerContentsWorkflowSqlRuntime;

export interface ContainerDocumentPrimeStore {
  getSnapshot?: () => { ready: boolean };
  requestSync: () => void;
}

export interface ContainerDocumentPrimeHost<TRuntime> {
  documentWorkflowRuntime: (containerId: string) => TRuntime;
  openDocumentStore: (input: {
    documentId: string | null;
    localId: string;
    runtime: TRuntime;
  }) => ContainerDocumentPrimeStore;
}

export interface ContainerContentsSharedDocumentSummaries {
  documentSummaries: ReadonlyArray<DocumentSummary>;
  linkedContainerIdsByDocumentId: ReadonlyMap<string, ReadonlyArray<string>>;
}

export interface ContainerContentsContainerSubtreeState {
  container: {
    id: string;
    parentId: string | null;
  };
}
