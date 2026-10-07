import { expect, test } from "bun:test";
import { base64ToBytes, bytesToBase64 } from "@tearleads/encoding";
import { createTestExecSql } from "@tearleads/test-utils";
import { signedRecoveryHistory } from "../../../test/helpers/principalHistoryRecovery";
import {
  principalHistoryRetentionTables,
  principalKeyEnvelopeArchive,
} from "../sqlite/principalHistoryRetentionSchema";
import { getClientSQLitePersistenceRuntime } from "../sqlite/sqlitePersistenceRuntime";
import { ensureSqlTables } from "../sqlite/sqlSchema";
import { archivePrincipalHistoryKeyEnvelopes } from "./principalKeyEnvelopeArchivePersistence";

test("a corrupt staged envelope cannot replace the archived candidate for its signed key", async () => {
  const history = await signedRecoveryHistory(1);
  const f = await createTestExecSql("principal-envelope-archive-binding");
  const current = {
    currentState: history.bundle.currentState,
    currentProjection: history.bundle.currentProjection,
    currentGrants: history.bundle.currentGrants,
    currentPayload: history.bundle.currentPayload,
    currentMemberEnvelopes: history.bundle.currentMemberEnvelopes,
  };
  try {
    await ensureSqlTables(f.execSql, principalHistoryRetentionTables);
    const runtime = getClientSQLitePersistenceRuntime(f.execSql);
    const archive = (currentJson: string) =>
      runtime.guardedTransaction(
        (tx) =>
          archivePrincipalHistoryKeyEnvelopes(tx, {
            organizationId: "org-1",
            version: 1,
            currentJson,
          }),
        () => true,
      );
    await archive(JSON.stringify(current));
    const before = await runtime.db.select().from(principalKeyEnvelopeArchive);
    expect(before).toHaveLength(1);
    const corrupt = structuredClone(current);
    const envelope = corrupt.currentMemberEnvelopes.envelopes[0];
    if (!envelope) throw new Error("Missing signed envelope fixture");
    const bytes = base64ToBytes(envelope.wrappedKey);
    bytes[0] = (bytes[0] ?? 0) ^ 1;
    envelope.wrappedKey = bytesToBase64(bytes);
    await archive(JSON.stringify(corrupt));
    expect(await runtime.db.select().from(principalKeyEnvelopeArchive)).toEqual(
      before,
    );
  } finally {
    f.close();
  }
});
