import type { DatabaseTransaction } from "@tearleads/api-shared/postgres";
import { documentInlineRekeyCommits } from "@tearleads/api-shared/schema";
import type { DocumentSyncRequest } from "@tearleads/validators/request";
import { and, eq } from "drizzle-orm";
import { documentUpdateIdConflict } from "./errors";

function inlineRekeyCommitId(request: DocumentSyncRequest): string | undefined {
  // Optional for rolling compatibility with clients that predate durable
  // inline-rekey replay markers. Current SDK plans always provide it.
  return (request.containerRekeys?.length ?? 0) > 0
    ? request.inlineRekeyCommitId
    : undefined;
}

/** Rejects only a replay of the same logical inline-rekey flush. */
export async function assertInlineRekeyCommitIsNew(input: {
  readonly documentId: string;
  readonly executor: DatabaseTransaction;
  readonly request: DocumentSyncRequest;
}): Promise<void> {
  const commitId = inlineRekeyCommitId(input.request);
  if (!commitId) return;

  const [existing] = await input.executor
    .select({ documentId: documentInlineRekeyCommits.documentId })
    .from(documentInlineRekeyCommits)
    .where(
      and(
        eq(documentInlineRekeyCommits.documentId, input.documentId),
        eq(documentInlineRekeyCommits.commitId, commitId),
      ),
    )
    .limit(1);
  if (existing) {
    throw documentUpdateIdConflict();
  }
}

/** Records the marker in the same transaction as the rekeys and updates. */
export async function recordInlineRekeyCommit(input: {
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
