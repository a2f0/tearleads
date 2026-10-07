import { beforeAll, expect, test } from "bun:test";
import { principalPolicyMatchesReference } from "@tearleads/crypto";
import { eq } from "drizzle-orm";
import { signedRecoveryHistory } from "../../../test/helpers/principalHistoryRecovery";
import { createPublicHistoryFixture } from "../../../test/helpers/publicPrincipalHistory";
import { loadPrincipalPolicyCheckpoint } from "../../data/persistence/keyingCheckpointPersistence";
import { principalHistoryEntries } from "../../data/sqlite/principalHistoryEvidenceSchema";
import { PrincipalHistoryEvidenceUnavailableError } from "./principalHistoryRecoveryReferences";
import { recoverPublicPrincipalHistory } from "./recoverPublicPrincipalHistory";
import { selectPublicPrincipalHistory } from "./selectPublicPrincipalHistory";

let history: Awaited<ReturnType<typeof signedRecoveryHistory>>;
beforeAll(async () => {
  history = await signedRecoveryHistory(129);
}, 30_000);

function reference(version: number) {
  const state =
    version === 129
      ? history.bundle.currentState
      : history.bundle.previousStates[version - 1]?.state;
  if (!state) throw new Error("Missing signed history fixture");
  const { principalId, principalType, keyEpoch, keyFingerprint, stateHash } =
    state;
  return {
    principalId,
    principalType,
    version,
    keyEpoch,
    keyFingerprint,
    stateHash,
  };
}

async function fixture() {
  const f = await createPublicHistoryFixture(history);
  try {
    const recovered = await recoverPublicPrincipalHistory(f.options);
    return {
      ...f,
      selection: {
        recovered,
        execSql: f.options.execSql,
        stillCurrent: () => true,
        references: [reference(16)],
        checkpoint: reference(128),
      },
    };
  } catch (error) {
    f.close();
    throw error;
  }
}

test("public selections prove more than one citation batch without advancing pins", async () => {
  const f = await fixture();
  try {
    const references = Array.from({ length: 129 }, (_, index) =>
      reference(index + 1),
    );
    const selected = await selectPublicPrincipalHistory({
      ...f.selection,
      references,
      includeGenesis: true,
    });
    expect(selected).toHaveLength(2);
    for (const head of references)
      expect(
        selected.some((policy) =>
          principalPolicyMatchesReference({ policy, reference: head }),
        ),
      ).toBe(true);
    for (const policy of selected) {
      expect(policy).not.toHaveProperty("history");
      expect(policy).not.toHaveProperty("payload");
      expect(
        policy.retainedHistory.some(({ state }) => state.version === 128),
      ).toBe(true);
    }
    expect(
      await loadPrincipalPolicyCheckpoint(
        f.options.execSql,
        "group",
        history.bundle.currentState.principalId,
      ),
    ).toBeNull();
  } finally {
    f.close();
  }
});

test("public selections distinguish contradictory citations and pins from unavailable newer evidence", async () => {
  const f = await fixture();
  try {
    await expect(
      selectPublicPrincipalHistory({
        ...f.selection,
        references: [{ ...reference(16), stateHash: "0".repeat(64) }],
      }),
    ).rejects.toMatchObject({ code: "object_mismatch" });
    await expect(
      selectPublicPrincipalHistory({
        ...f.selection,
        checkpoint: { ...reference(128), stateHash: "0".repeat(64) },
      }),
    ).rejects.toMatchObject({ code: "stale_predecessor" });
    await expect(
      selectPublicPrincipalHistory({
        ...f.selection,
        checkpoint: { ...reference(129), stateHash: "0".repeat(64) },
      }),
    ).rejects.toMatchObject({ code: "equivocation" });
    await expect(
      selectPublicPrincipalHistory({
        ...f.selection,
        checkpoint: { ...reference(129), version: 130 },
      }),
    ).rejects.toMatchObject({ code: "missing_dependency" });
    const [selected] = await selectPublicPrincipalHistory({
      ...f.selection,
      includeGenesis: true,
    });
    expect(selected?.retainedHistory.map(({ state }) => state.version)).toEqual(
      [1, 16, 128, 129],
    );
  } finally {
    f.close();
  }
});

test("public selections authenticate a damaged citation before comparing its caller pin", async () => {
  const f = await fixture();
  try {
    const rows = await f.db.select().from(principalHistoryEntries);
    const row = rows.find(
      (candidate) => JSON.parse(candidate.entryJson).state.version === 16,
    );
    if (!row) throw new Error("Missing retained entry");
    const entry = JSON.parse(row.entryJson);
    entry.state.signature = history.bundle.currentState.signature;
    await f.db
      .update(principalHistoryEntries)
      .set({ entryJson: JSON.stringify(entry) })
      .where(eq(principalHistoryEntries.leafHash, row.leafHash))
      .run();
    await expect(
      selectPublicPrincipalHistory(f.selection),
    ).rejects.toBeInstanceOf(PrincipalHistoryEvidenceUnavailableError);
    expect(
      await loadPrincipalPolicyCheckpoint(
        f.options.execSql,
        "group",
        history.bundle.currentState.principalId,
      ),
    ).toBeNull();
  } finally {
    f.close();
  }
});
