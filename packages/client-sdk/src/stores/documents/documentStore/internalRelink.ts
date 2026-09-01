import type { ExecSql } from "../../../workflows/documents";
import type { DocumentStore, DocumentStoreRelinkInput } from "../types";

export type DocumentRelinkCommitSideEffect = (
  transactionExecSql: ExecSql,
) => Promise<void>;

type InternalRelink = (
  input: DocumentStoreRelinkInput,
  commitSideEffect: DocumentRelinkCommitSideEffect,
) => Promise<
  ReturnType<DocumentStore["relink"]> extends Promise<infer T> ? T : never
>;

const internalRelinks = new WeakMap<DocumentStore, InternalRelink>();

export function registerInternalDocumentRelink(
  store: DocumentStore,
  relink: InternalRelink,
): void {
  internalRelinks.set(store, relink);
}

export function relinkDocumentStoreWithCommitSideEffect(
  store: DocumentStore,
  input: DocumentStoreRelinkInput,
  commitSideEffect: DocumentRelinkCommitSideEffect,
) {
  const relink = internalRelinks.get(store);
  if (!relink) {
    throw new Error(
      "Document store does not support internal relink settlement",
    );
  }
  return relink(input, commitSideEffect);
}
