import { expect, spyOn, test } from "bun:test";
import {
  createDocument,
  exportUpdatesSince,
  getUpdateVersionVectors,
} from "@tearleads/loro";
import type { DecryptedDocumentSyncUpdate } from "../../../../data/documents/shared/sync/documentSyncTypes";
import { processLoroRuntimeFailures } from "../../../../data/documents/shared/sync/loroRuntimeFailureLedger";
import { importSyncedDocumentUpdates } from "./syncUpdateImport";

async function updateFailingWith(
  failure: Error,
): Promise<DecryptedDocumentSyncUpdate> {
  const source = await createDocument("live-import-source");
  source.getText("text").update("judged");
  source.commit();
  const data = exportUpdatesSince(source, undefined);
  source.free();
  return {
    id: crypto.randomUUID(),
    ...getUpdateVersionVectors(data),
    get updateData(): Uint8Array {
      throw failure;
    },
  };
}

test("a runtime failure applying a judged page marks the process as failed", async () => {
  const noted = spyOn(
    processLoroRuntimeFailures,
    "noteUnattributedFailure",
  ).mockImplementation(() => undefined);
  const document = await createDocument("live-import-reader");
  try {
    const trap = new WebAssembly.RuntimeError("unreachable");
    const trapped = await updateFailingWith(trap);
    expect(() => importSyncedDocumentUpdates(document, [trapped])).toThrow(
      trap,
    );
    expect(noted).toHaveBeenCalledTimes(1);

    // Any other failure says nothing about the module.
    const other = new Error("not the runtime");
    const failing = await updateFailingWith(other);
    expect(() => importSyncedDocumentUpdates(document, [failing])).toThrow(
      other,
    );
    expect(noted).toHaveBeenCalledTimes(1);
  } finally {
    noted.mockRestore();
    document.free();
  }
});
