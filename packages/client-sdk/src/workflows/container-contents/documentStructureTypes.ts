import type { DocumentSummary } from "../../data/documents/documentSummary";
import type { RelinkPersistedDocumentInput } from "../documents";
import type { ContainerContentsProjectionUserKeyResolver } from "./projectionKeys";
import type { ContainerContentsWorkflowRuntime } from "./runtime";

export type MergeDocumentSummary = (nextDocument: DocumentSummary) => void;
export type SetLinkedContainerIdsForDocument = (
  documentId: string,
  linkedContainerIds: ReadonlyArray<string>,
) => void;

export type DocumentStructuralMutationRuntime =
  ContainerContentsWorkflowRuntime & {
    resolveProjectionUserKey: ContainerContentsProjectionUserKeyResolver;
  };

export interface DocumentStructuralMutationRelinkInput
  extends RelinkPersistedDocumentInput {
  contentKeyBundle?: string | null | undefined;
  documentKekTargets?: string | null | undefined;
  documentManifestBundle?: string | null | undefined;
  stillCurrent?: (() => boolean) | undefined;
}

export interface DocumentStructuralMutationLocalStore<TRuntime> {
  assertCanRotateContentKey: () => Promise<Uint8Array>;
  ensureInitialized: () => Promise<boolean>;
  relink: (
    input: DocumentStructuralMutationRelinkInput,
  ) => Promise<DocumentSummary | null>;
  requestSync: () => void;
  updateRuntime: (runtime: TRuntime) => void;
}

export interface DocumentStructuralMutationHost<TRuntime> {
  documentWorkflowRuntime: (containerId: string | null) => TRuntime;
  mergeDocumentSummary: MergeDocumentSummary;
  openDocumentStore: (input: {
    containerId: string | null;
    documentId: string | null;
    localId: string;
  }) => DocumentStructuralMutationLocalStore<TRuntime>;
}
