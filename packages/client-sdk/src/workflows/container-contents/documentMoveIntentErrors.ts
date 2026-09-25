import { sqlDocumentMoveIntentPersistence } from "../../data/persistence/container-contents/documentMoveIntentPersistence";
import type { ContainerContentsWorkflowRuntime } from "./runtime";

export async function recordPendingDocumentMoveIntentError(input: {
  blocked?: boolean | undefined;
  denied?: boolean | undefined;
  documentId: string;
  expectedIntentId?: string | undefined;
  expectedUpdatedAt?: string | undefined;
  isCurrent: () => boolean;
  message: string;
  state: { runtime: ContainerContentsWorkflowRuntime };
  unavailable?: boolean | undefined;
}): Promise<boolean> {
  if (!input.isCurrent()) return false;
  await sqlDocumentMoveIntentPersistence.recordMoveIntentError(
    input.state.runtime.infra.execSql,
    {
      blocked: input.blocked,
      denied: input.denied,
      documentId: input.documentId,
      expectedIntentId: input.expectedIntentId,
      expectedUpdatedAt: input.expectedUpdatedAt,
      message: input.message,
      stillCurrent: input.isCurrent,
      unavailable: input.unavailable,
    },
  );
  return input.isCurrent();
}
