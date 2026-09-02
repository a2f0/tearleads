import type { DatabaseTransaction } from "@tearleads/api-shared/postgres";
import type { DocumentSyncRequest } from "@tearleads/validators/request";
import { resolveCurrentDocumentKekTargets } from "../../../access/read/documentKekTargets";
import { ensureDocumentExists } from "./shared/documentRows";
import { assertSyncContentKeyBundleMatchesRequest } from "./shared/records";
import { ensureSyncDocumentAccess } from "./syncAccess";
import { reserveInlineRekeyCommit } from "./syncInlineRekeyCommit";

export async function prepareSyncDocumentTransaction(input: {
  readonly documentId: string;
  readonly request: DocumentSyncRequest;
  readonly tx: DatabaseTransaction;
  readonly userId: string;
}): Promise<void> {
  await ensureDocumentExists({
    documentId: input.documentId,
    executor: input.tx,
  });
  assertSyncContentKeyBundleMatchesRequest(input.request);
  // Authorize against the currently committed projection before probing the
  // durable replay marker. Inline requests carry successor path refs that are
  // not stored until their rekeys apply, so this preflight intentionally uses
  // the server-resolved current targets rather than request path material.
  const preRekeyTargets = await resolveCurrentDocumentKekTargets(
    input.documentId,
    input.tx,
  );
  await ensureSyncDocumentAccess({
    currentTargets: preRekeyTargets,
    executor: input.tx,
    request: input.request,
    userId: input.userId,
  });
  await reserveInlineRekeyCommit({
    documentId: input.documentId,
    executor: input.tx,
    request: input.request,
  });
}
