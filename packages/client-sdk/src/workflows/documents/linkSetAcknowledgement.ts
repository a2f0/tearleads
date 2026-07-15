import type { DocumentLinkSetMutationResponse } from "@tearleads/validators/response";
import { acknowledgeDocumentMutation } from "../../data/documents/shared/mutationAcknowledgement";
import { persistedDocumentLinkSetMutationStateFromResponse } from "../../data/documents/shared/responses";
import type { DocumentLinkSetMutationPlan } from "../../data/documents/shared/types";
import type { ExecSql } from "../../data/sqlite/sqlSchema";

export async function persistAcknowledgedLinkSetState(input: {
  readonly execSql: ExecSql;
  readonly plan: DocumentLinkSetMutationPlan;
  readonly response: DocumentLinkSetMutationResponse;
}) {
  const persistedState = persistedDocumentLinkSetMutationStateFromResponse(
    input.plan,
    input.response,
  );
  await acknowledgeDocumentMutation({
    execSql: input.execSql,
    plan: input.plan,
  });
  return persistedState;
}
