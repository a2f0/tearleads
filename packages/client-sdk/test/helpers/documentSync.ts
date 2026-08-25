import type { IncomingDocumentSyncUpdateValidator } from "../../src/data/documents/shared/documentSyncUpdateIsolation";
import type { SyncRemoteDocumentInput } from "../../src/workflows/documents/readOnlySync";
import { syncRemoteDocument } from "../../src/workflows/documents/sync";

type TestSyncRemoteDocumentInput = Omit<
  SyncRemoteDocumentInput,
  "validateIncomingUpdates"
> & {
  validateIncomingUpdates?: IncomingDocumentSyncUpdateValidator | undefined;
};

/** Keeps non-import tests explicit about bypassing scratch Loro validation. */
export function syncRemoteDocumentWithoutImportValidationForTest(
  input: TestSyncRemoteDocumentInput,
) {
  const { validateIncomingUpdates = () => undefined, ...syncInput } = input;
  return syncRemoteDocument({
    ...syncInput,
    validateIncomingUpdates,
  });
}
