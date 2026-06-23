import type { DocumentSummary } from "../../data/documentSummary";
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
  queueBaselineAfterRelink?: boolean | undefined;
}

export interface DocumentStructuralMutationLocalStore<TRuntime> {
  ensureInitialized: () => Promise<boolean>;
  relink: (
    input: DocumentStructuralMutationRelinkInput,
  ) => Promise<DocumentSummary | null>;
  requestSync: () => void;
  updateRuntime: (runtime: TRuntime) => void;
}

export interface DocumentStructuralMutationHost<TRuntime> {
  documentWorkflowRuntime: (containerId: string) => TRuntime;
  mergeDocumentSummary: MergeDocumentSummary;
  openDocumentStore: (input: {
    containerId: string;
    documentId: string | null;
    localId: string;
  }) => DocumentStructuralMutationLocalStore<TRuntime>;
}
