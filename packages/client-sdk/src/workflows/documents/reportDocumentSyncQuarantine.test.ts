import { expect, mock, test } from "bun:test";
import { DocumentSyncUpdateIsolationError } from "../../data/documents/shared/documentSyncUpdateIsolation";
import { reportDocumentSyncQuarantine } from "./reportDocumentSyncQuarantine";

function quarantine(updateId = "private-update") {
  return new DocumentSyncUpdateIsolationError({
    batchUpdateIds: [updateId],
    cause: new Error("private payload"),
    stage: "loro_import",
    updateId: null,
  });
}

test("retries with fresh errors cannot flood host logs or breadcrumbs", () => {
  const scope = {};
  const logError = mock(() => undefined);
  for (let attempt = 0; attempt < 50; attempt += 1) {
    reportDocumentSyncQuarantine(scope, logError, quarantine());
  }
  expect(logError).toHaveBeenCalledTimes(1);

  // An equally sized batch with different updates is a new failure.
  reportDocumentSyncQuarantine(scope, logError, quarantine("other-update"));
  expect(logError).toHaveBeenCalledTimes(2);

  // Another live document must still report its own copy of the same error.
  reportDocumentSyncQuarantine({}, logError, quarantine());
  expect(logError).toHaveBeenCalledTimes(3);
});

test("a host without a reporter does not consume the first report", () => {
  const scope = {};
  const logError = mock(() => undefined);
  reportDocumentSyncQuarantine(scope, undefined, quarantine());
  reportDocumentSyncQuarantine(scope, logError, quarantine());
  expect(logError).toHaveBeenCalledTimes(1);
});
