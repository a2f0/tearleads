import { expect, test } from "bun:test";
import { unwrapDek, wrapDekForRecipients } from "@tearleads/crypto";
import { base64ToBytes } from "@tearleads/encoding";
import { rotatingCompletedHistory } from "../../../test/helpers/principalCompletedHistory";
import { createRecoveryFixture } from "../../../test/helpers/principalHistoryRecovery";
import { principalPolicyHead } from "../../../test/helpers/principalPolicyFixtures";
import { recoverPrincipalPolicyHistory } from "../../workflows/principals/recoverPrincipalPolicyHistory";
import {
  principalHistoryEntries,
  principalHistoryNodes,
  principalHistoryPrefixes,
} from "../sqlite/principalHistoryEvidenceSchema";
import {
  principalHistoryStageScopes,
  principalKeyEnvelopeArchive,
} from "../sqlite/principalHistoryRetentionSchema";
import { principalHistoryStages } from "../sqlite/principalHistoryStageSchema";
import { principalPolicyCheckpoints } from "../sqlite/principalPolicySchema";
import { createExecSql } from "../sqlite/sqlSchema";
import { loadPrincipalKeyEnvelopeCandidates } from "./principalKeyEnvelopeCandidates";

test("invalid current artifacts cannot accumulate completed attempts or erase published offline evidence and old keys", async () => {
  const { history, bundles, keys, latest } = await rotatingCompletedHistory(12);
  const old = bundles[2];
  const oldKey = keys.get(3);
  if (!old || !oldKey) throw new Error("Missing historical key fixture");
  const objectKey = new Uint8Array(32).fill(43);
  const objectEnvelope = await wrapDekForRecipients(objectKey, [
    oldKey.publicKey,
  ]);
  const f = await createRecoveryFixture(
    { ...history, bundle: latest, expectedHead: principalPolicyHead(latest) },
    bundles,
  );
  try {
    f.controls.mutate = (page) => {
      if (page.currentState.version > 2)
        page.currentPayload.ciphertext += "changed";
    };
    for (const bundle of bundles) {
      const recovery = recoverPrincipalPolicyHistory({
        ...f.options,
        expectedHead: principalPolicyHead(bundle),
      });
      if (bundle.currentState.version <= 2) await recovery;
      else
        await expect(recovery).rejects.toThrow(
          "payload hash does not match ciphertext",
        );
    }
    const stages = await f.db.select().from(principalHistoryStages);
    expect(
      stages.map((stage) => stage.afterVersion + 1).sort((a, b) => a - b),
    ).toEqual([1, 2, 7, 8, 9, 10, 11, 12]);
    expect(await f.db.select().from(principalHistoryPrefixes)).toMatchObject([
      { version: 2 },
    ]);
    expect(await f.db.select().from(principalPolicyCheckpoints)).toEqual([]);
    const before = f.requests.length;
    for (const bundle of bundles.slice(0, 2))
      expect(
        (
          await recoverPrincipalPolicyHistory({
            ...f.options,
            expectedHead: principalPolicyHead(bundle),
            offline: true,
          })
        ).policy.stateHash,
      ).toBe(bundle.currentState.stateHash);
    expect(f.requests).toHaveLength(before);
    const candidates = await loadPrincipalKeyEnvelopeCandidates(
      f.options.execSql,
      [old.currentState.keyFingerprint],
    );
    expect(candidates).toHaveLength(1);
    const restored = await unwrapDek(
      candidates.flatMap((candidate) =>
        candidate.currentMemberEnvelopes.envelopes.map((envelope) => ({
          keyFingerprint: envelope.memberKeyFingerprint,
          kemCipherText: base64ToBytes(envelope.kemCipherText),
          wrappedKey: base64ToBytes(envelope.wrappedKey),
        })),
      ),
      history.memberKey.secretKey,
    );
    expect(restored).toEqual(oldKey.secretKey);
    expect(await unwrapDek(objectEnvelope, restored)).toEqual(objectKey);
  } finally {
    f.close();
  }
}, 15_000);

test("cancellation after key archival rolls back completed eviction and proof publication", async () => {
  const { history, bundles, latest } = await rotatingCompletedHistory(9);
  const f = await createRecoveryFixture(
    { ...history, bundle: latest, expectedHead: principalPolicyHead(latest) },
    bundles,
  );
  let current = true;
  let archives = 0;
  const execSql = createExecSql({
    exec: async ({ sql, bind, rowMode }) => {
      const rows = await f.options.execSql(
        sql,
        bind,
        rowMode ? { rowMode } : undefined,
      );
      if (sql.startsWith('insert into "principal_key_envelope_archive"')) {
        archives += 1;
        current = false;
      }
      return { rows };
    },
  });
  const snapshot = async () => ({
    stages: await f.db.select().from(principalHistoryStages),
    hints: await f.db.select().from(principalHistoryStageScopes),
    archive: await f.db.select().from(principalKeyEnvelopeArchive),
    prefixes: await f.db.select().from(principalHistoryPrefixes),
    entries: await f.db.select().from(principalHistoryEntries),
    nodes: await f.db.select().from(principalHistoryNodes),
  });
  try {
    f.controls.mutate = (page) => {
      if (page.currentState.version > 2)
        page.currentPayload.ciphertext += "changed";
    };
    for (const bundle of bundles.slice(0, 8)) {
      const recovery = recoverPrincipalPolicyHistory({
        ...f.options,
        expectedHead: principalPolicyHead(bundle),
      });
      if (bundle.currentState.version <= 2) await recovery;
      else
        await expect(recovery).rejects.toThrow(
          "payload hash does not match ciphertext",
        );
    }
    const before = await snapshot();
    expect(before.stages).toHaveLength(8);
    await expect(
      recoverPrincipalPolicyHistory({
        ...f.options,
        execSql,
        stillCurrent: () => current,
      }),
    ).rejects.toMatchObject({ name: "ProjectionVerificationCancelledError" });
    expect(archives).toBe(1);
    expect(await snapshot()).toEqual(before);
    current = true;
    await expect(recoverPrincipalPolicyHistory(f.options)).rejects.toThrow(
      "payload hash does not match ciphertext",
    );
    const after = await snapshot();
    expect(after.stages).toHaveLength(8);
    expect(after.stages.some((stage) => stage.afterVersion === 2)).toBe(false);
    expect(after.archive.some((row) => row.version === 3)).toBe(true);
    expect(after.prefixes).toEqual(before.prefixes);
  } finally {
    f.close();
  }
}, 15_000);
