import type { DatabaseTransaction } from "@tearleads/api-shared/postgres";
import { getLatestDocumentContentKeyEpoch } from "../../../access/read/documentContentKeyStore";
import { hasCommittedDocumentUpdate } from "./committedDocumentUpdates";
import { DocumentMutationError } from "./errors";

/**
 * A link carries no rotation baseline, so it may not advance the content-key
 * epoch of a document with committed updates: members of the new container
 * would hold only the new key and could not open the history. Sync refuses
 * the same advance without a covering baseline (#2365 finding 28). Honest
 * clients link at the current epoch and rotate only on unlink.
 */
export async function assertLinkKeepsCommittedContentKeyEpoch(input: {
  readonly contentKeyEpoch: number;
  readonly documentId: string;
  readonly executor: DatabaseTransaction;
}): Promise<void> {
  const latestEpoch = await getLatestDocumentContentKeyEpoch(
    input.documentId,
    input.executor,
  );
  if (latestEpoch === null || input.contentKeyEpoch <= latestEpoch) return;
  if (await hasCommittedDocumentUpdate(input.executor, input.documentId)) {
    throw new DocumentMutationError(
      "Document link cannot rotate the content key; committed updates need a rotation baseline",
      409,
    );
  }
}
