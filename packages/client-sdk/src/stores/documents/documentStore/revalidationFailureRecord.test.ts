import { expect, test } from "bun:test";
import { createTestExecSql } from "@tearleads/test-utils";
import { sqlDocumentsPersistence } from "../../../data/persistence/documents/documentsPersistence";
import { hasRecordedTerminalSyncFailures } from "../../../data/sqlite/documentSyncFailurePersistence";
import type { DocumentRecord } from "../../../workflows/documents/persistence";
import type {
  DocumentState,
  DocumentStoreState,
  EncapsulationKeyPair,
} from "./state";
import {
  documentRevalidationFailureHandler,
  ensureRemoteDocument,
} from "./syncShared";

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

// Row 3's local-only orphan: a null container scope can never create, and
// the lane must leave a durable failure row rather than going silent.
test("a container-less local-only create records a terminal failure", async () => {
  const { close, execSql } = await createTestExecSql("orphan-create-failure");
  try {
    await sqlDocumentsPersistence.ensureSchema(execSql);
    const state = {
      localId: "orphaned-local-only",
      runtime: {
        infra: { execSql },
        state: { containerId: null },
        util: { log: () => undefined },
      },
    } as unknown as DocumentStoreState;
    const record = { documentId: null } as unknown as DocumentRecord;

    const result = await ensureRemoteDocument(
      state,
      {} as unknown as DocumentState,
      record,
      {} as unknown as EncapsulationKeyPair,
    );

    expect(result).toBe(record);
    expect(await hasRecordedTerminalSyncFailures(execSql)).toBe(true);
  } finally {
    close();
  }
});
