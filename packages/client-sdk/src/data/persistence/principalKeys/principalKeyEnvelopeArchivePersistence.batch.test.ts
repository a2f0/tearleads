import { expect, test } from "bun:test";
import { signedRecoveryHistory } from "../../../../test/helpers/principalHistoryRecovery";
import { retentionBatchFixture } from "../../../../test/helpers/principalRetentionBatch";
import { principalKeyEnvelopeArchive } from "../../sqlite/schema/principalHistoryRetentionSchema";
import { archivePrincipalHistoryKeyEnvelopeBatch } from "./principalKeyEnvelopeArchivePersistence";

test("archive batches preserve version precedence, equal-version order and bind bounds", async () => {
  const { bundle } = await signedRecoveryHistory(3);
  const earlier = bundle.previousStates[0];
  if (!earlier) throw new Error("Missing previous state fixture");
  // These are untrusted candidates, not authenticated history. The archive
  // checks structure and envelope binding, not the state signature.
  const candidate = (
    version: number,
    stateHash = bundle.currentState.stateHash,
  ) => ({
    ...bundle,
    currentState: { ...bundle.currentState, version, stateHash },
    currentMemberEnvelopes: { ...bundle.currentMemberEnvelopes, stateHash },
  });
  const input = (
    organizationId: string,
    version: number,
    stateHash = bundle.currentState.stateHash,
  ) => ({
    organizationId,
    version,
    currentJson: JSON.stringify(candidate(version, stateHash)),
  });
  const f = await retentionBatchFixture("completed", 0);
  try {
    const old = {
      organizationId: "already-newer",
      principalType: bundle.currentState.principalType,
      principalId: bundle.currentState.principalId,
      keyFingerprint: bundle.currentState.keyFingerprint,
      version: 9,
      envelopesJson: "retained-newer-candidate",
    };
    await f.db.insert(principalKeyEnvelopeArchive).values(old);
    const corrupt = candidate(4);
    corrupt.currentMemberEnvelopes = {
      ...corrupt.currentMemberEnvelopes,
      envelopes: [],
    };
    const inputs = [
      input("same-key", 3),
      input("same-key", 2),
      input("within-key", 3),
      input("within-key", 3, earlier.state.stateHash),
      ...Array.from({ length: 162 }, (_, index) => input(`unique-${index}`, 1)),
      // The equal-version replacement crosses the 166-row batch boundary.
      input("same-key", 3, earlier.state.stateHash),
      input("same-key", 1),
      input("already-newer", 8),
      {
        organizationId: "same-key",
        version: 4,
        currentJson: JSON.stringify(corrupt),
      },
      { organizationId: "bad-json", version: 1, currentJson: "{" },
      {
        organizationId: "public-hint",
        version: 3,
        currentJson: JSON.stringify({ currentState: bundle.currentState }),
      },
      { ...input("wrong-version", 3), version: 2 },
    ];
    f.statements.length = 0;
    await f.runtime.guardedTransaction(
      (tx) => archivePrincipalHistoryKeyEnvelopeBatch(tx, inputs),
      () => true,
    );
    const measured = [...f.statements];
    expect(Math.max(...measured.map((entry) => entry.binds))).toBe(996);
    expect(
      measured.filter((entry) =>
        entry.sql.startsWith('insert into "principal_key_envelope_archive"'),
      ),
    ).toHaveLength(2);
    const after = await f.db.select().from(principalKeyEnvelopeArchive);
    expect(after).toHaveLength(165);
    expect(after.find((row) => row.organizationId === "already-newer")).toEqual(
      old,
    );
    expect(after.find((row) => row.organizationId === "same-key")).toEqual({
      ...old,
      organizationId: "same-key",
      version: 3,
      envelopesJson: JSON.stringify(
        candidate(3, earlier.state.stateHash).currentMemberEnvelopes,
      ),
    });
    expect(after.find((row) => row.organizationId === "within-key")).toEqual({
      ...old,
      organizationId: "within-key",
      version: 3,
      envelopesJson: JSON.stringify(
        candidate(3, earlier.state.stateHash).currentMemberEnvelopes,
      ),
    });
    expect(
      after
        .filter((row) => row.organizationId.startsWith("unique-"))
        .every((row) => row.version === 1),
    ).toBe(true);
  } finally {
    f.close();
  }
});
