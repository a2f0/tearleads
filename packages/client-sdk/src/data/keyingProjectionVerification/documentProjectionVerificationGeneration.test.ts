import { expect, test } from "bun:test";
import { createTestExecSql } from "@tearleads/test-utils";
import { createMaterializedSyncFixture } from "../../../test/helpers/documentFixtures";
import type { ExecSql } from "../sqlite/sqlSchema";
import {
  verifyDocumentWriterProjection,
  verifyDocumentWriterProjectionAuthorization,
} from "./documentProjectionVerification";
import { ProjectionVerificationCancelledError } from "./types";

const verificationEntries = [
  ["head", verifyDocumentWriterProjection],
  ["authorization", verifyDocumentWriterProjectionAuthorization],
] as const;

for (const [entry, verify] of verificationEntries) {
  test(`document ${entry} verification rejects a refused checkpoint commit`, async () => {
    const fixture = await createMaterializedSyncFixture({
      documentId: `refused-document-${entry}`,
    });
    const database = await createTestExecSql(
      `refused-document-verification-${entry}`,
    );
    let transactionStarted = false;
    const guardedExecSql = (async (...args: Parameters<ExecSql>) => {
      const rows = await database.execSql(...args);
      if (args[0].trim().toUpperCase().startsWith("BEGIN")) {
        transactionStarted = true;
      }
      return rows;
    }) as ExecSql;

    try {
      await expect(
        verify({
          execSql: guardedExecSql,
          projection: fixture.writerProjection,
          resolveUserKey: fixture.resolveProjectionUserKey,
          stillCurrent: () => !transactionStarted,
        }),
      ).rejects.toBeInstanceOf(ProjectionVerificationCancelledError);
      expect(transactionStarted).toBe(true);
    } finally {
      database.close();
    }
  });
}
