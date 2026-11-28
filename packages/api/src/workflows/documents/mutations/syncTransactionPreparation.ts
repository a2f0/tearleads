import type { DatabaseTransaction } from "@tearleads/api-shared/postgres";
import type { DocumentSyncRequest } from "@tearleads/validators/request";
import {
  type DocumentLinkSetFrontier,
  getDocumentWithCurrentHeadAndLinks,
  readDocumentLinkSetFrontier,
} from "../../../access/read/documentKekTargets";
import { documentNotFound } from "./errors";
import { assertSyncContentKeyBundleMatchesRequest } from "./shared/records";
import {
  ensureSyncDocumentAccess,
  type VerifiedDocumentAccessResult,
} from "./syncAccess";
import { reserveInlineRekeyCommit } from "./syncInlineRekeyCommit";

export async function prepareSyncDocumentTransaction(input: {
  readonly documentId: string;
  /** A create's seed: the transaction itself just inserted the row. */
  readonly documentInsertedInTransaction: boolean;
  readonly createdFrontier?: DocumentLinkSetFrontier | undefined;
  readonly request: DocumentSyncRequest;
  readonly tx: DatabaseTransaction;
  readonly userId: string;
}): Promise<{
  readonly frontier: DocumentLinkSetFrontier;
  readonly prelockAccess?: VerifiedDocumentAccessResult | undefined;
}> {
  const stored = input.documentInsertedInTransaction
    ? undefined
    : await getDocumentWithCurrentHeadAndLinks(input.documentId, input.tx);
  if (stored && !stored.exists) throw documentNotFound();
  assertSyncContentKeyBundleMatchesRequest(input.request);
  // Authorize against the currently committed link set before taking locks or
  // probing the durable replay marker, so an unauthorized caller who only knows
  // a document UUID cannot serialize writers or probe replay state.
  const frontier =
    input.createdFrontier ??
    (await readDocumentLinkSetFrontier(input.documentId, input.tx, stored));
  const prelockAccess = input.documentInsertedInTransaction
    ? undefined
    : await ensureSyncDocumentAccess({
        containerIds: frontier.linkedContainerIds,
        executor: input.tx,
        request: input.request,
        userId: input.userId,
      });
  await reserveInlineRekeyCommit({
    documentId: input.documentId,
    executor: input.tx,
    request: input.request,
  });
  return { frontier, prelockAccess };
}
