import type { DatabaseTransaction } from "@tearleads/api-shared/postgres";
import { documentInlineRekeyCommits } from "@tearleads/api-shared/schema";
import type { DocumentSyncRequest } from "@tearleads/validators/request";
import { documentUpdateIdConflict } from "./errors";

function inlineRekeyCommitId(request: DocumentSyncRequest): string | undefined {
  // Optional for rolling compatibility with clients that predate durable
  // inline-rekey replay markers. Current SDK plans always provide it.
  return (request.containerRekeys?.length ?? 0) > 0
    ? request.inlineRekeyCommitId
    : undefined;
}

/**
 * Reserves the marker before applying rekeys. A concurrent twin blocks on the
 * unique row: it takes over after rollback or conflicts after commit without
 * applying another rekey.
 */
export async function reserveInlineRekeyCommit(input: {
  readonly documentId: string;
  readonly executor: DatabaseTransaction;
  readonly request: DocumentSyncRequest;
}): Promise<void> {
  const commitId = inlineRekeyCommitId(input.request);
  if (!commitId) return;

  const [inserted] = await input.executor
    .insert(documentInlineRekeyCommits)
    .values({ commitId, documentId: input.documentId })
    .onConflictDoNothing({
      target: [
        documentInlineRekeyCommits.documentId,
        documentInlineRekeyCommits.commitId,
      ],
    })
    .returning({ commitId: documentInlineRekeyCommits.commitId });
  if (!inserted) {
    throw documentUpdateIdConflict();
  }
}
