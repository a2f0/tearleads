import type { DatabaseTransaction } from "@tearleads/api-shared/postgres";
import type { DocumentSyncRequest } from "@tearleads/validators/request";
import {
  type DocumentLinkSetFrontier,
  readDocumentLinkSetFrontier,
} from "../../../access/read/documentKekTargets";
import { ensureDocumentExists } from "./shared/documentRows";
import { assertSyncContentKeyBundleMatchesRequest } from "./shared/records";
import { ensureSyncDocumentAccess } from "./syncAccess";
import { reserveInlineRekeyCommit } from "./syncInlineRekeyCommit";

export async function prepareSyncDocumentTransaction(input: {
  readonly documentId: string;
  /** A create's seed: the transaction itself just inserted the row. */
  readonly documentInsertedInTransaction: boolean;
  readonly request: DocumentSyncRequest;
  readonly tx: DatabaseTransaction;
  readonly userId: string;
}): Promise<DocumentLinkSetFrontier> {
  if (!input.documentInsertedInTransaction) {
    await ensureDocumentExists({
      documentId: input.documentId,
      executor: input.tx,
    });
  }
  assertSyncContentKeyBundleMatchesRequest(input.request);
  // Authorize against the currently committed link set before probing the
  // durable replay marker. Inline requests carry successor path refs that are
  // not stored until their rekeys apply, so this preflight intentionally uses
  // the server's stored links rather than request path material. Access and
  // the lock plan need only the linked container ids; the KEK targets are
  // resolved once, after the heads are locked.
  const frontier = await readDocumentLinkSetFrontier(
    input.documentId,
    input.tx,
  );
  await ensureSyncDocumentAccess({
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
  return frontier;
}
