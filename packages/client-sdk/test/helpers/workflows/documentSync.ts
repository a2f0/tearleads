import type { IncomingDocumentSyncUpdateValidator } from "../../../src/data/documents/shared/sync/documentSyncUpdateIsolation";
import type { RemoteDocumentSyncPass } from "../../../src/workflows/documents/sync/remoteDocumentSyncPass";
import { syncRemoteDocumentForTest } from "./remoteDocumentServiceFixture";

type TestRemoteDocumentSyncPass = Omit<
  RemoteDocumentSyncPass,
  "validateIncomingUpdates"
> & {
  validateIncomingUpdates?: IncomingDocumentSyncUpdateValidator | undefined;
};

/** Keeps non-import tests explicit about bypassing scratch Loro validation. */
export function syncRemoteDocumentWithoutImportValidationForTest(
  input: TestRemoteDocumentSyncPass,
) {
  const { validateIncomingUpdates = () => undefined, ...syncInput } = input;
  return syncRemoteDocumentForTest({
    ...syncInput,
    validateIncomingUpdates,
  });
}
