import { expect, test } from "bun:test";
import { createTestExecSql } from "@tearleads/test-utils";
import { hasRecordedTerminalSyncFailures } from "../../../data/sqlite/documentSyncFailurePersistence";
import type { DocumentStoreState } from "./state";
import { documentRevalidationFailureHandler } from "./syncShared";

// Edge-case row 13's durable surface, with row 9's suppression intact: a
// refused read-only revalidation lands on the document's failure row, but a
// read-only 403 records nothing (it must never flag unattempted local edits).
test("revalidation failures record durably except read-only 403s", async () => {
  const { close, execSql } = await createTestExecSql("revalidation-record");
  try {
    const state = {
      localId: "revalidating-doc",
      runtime: { infra: { execSql } },
    } as unknown as DocumentStoreState;
    const handler = documentRevalidationFailureHandler(state);

    await handler({ message: "denied", status: 403 });
    expect(await hasRecordedTerminalSyncFailures(execSql)).toBe(false);

    await handler({
      message: "Container for this document is unavailable",
      status: 409,
    });
    expect(await hasRecordedTerminalSyncFailures(execSql)).toBe(true);
  } finally {
    close();
  }
});
