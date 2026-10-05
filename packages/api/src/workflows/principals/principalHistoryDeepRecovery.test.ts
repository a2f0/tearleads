import { expect, test } from "bun:test";
import { db } from "@tearleads/api-shared/postgres";
import { principalHistoryIndexNodes } from "@tearleads/api-shared/schema";
import { eq } from "drizzle-orm";
import { principalHistoryPreparationFixture } from "../../../test/helpers/principalHistoryPreparation";
import { getCurrentPrincipalState } from "../../access/read/principalStateStore";
import { getVerifiedPrincipalPolicyForStateWithExecutor } from "./getCurrentPrincipalPolicy";
import {
  preparePrincipalHistory,
  principalHistoryPreparationBudget,
} from "./preparePrincipalHistory";
import {
  PrincipalHistoryContinuation,
  runPrincipalHistoryTransaction,
} from "./principalHistoryTransaction";

async function damagedHistory() {
  const { head, entries } = await principalHistoryPreparationFixture({
    versions: 65,
    currentArtifacts: true,
  });
  const first = entries[0]?.state;
  if (!first) throw new Error("Missing genesis");
  let rootHash = "";
  for (let version = 1; version <= head.version; version += 1) {
    const prepared = await preparePrincipalHistory(db, {
      head,
      budget: { ...principalHistoryPreparationBudget(), remainingEntries: 1 },
    });
    if (prepared.complete) rootHash = prepared.history.indexRootHash;
  }
  const node = async (hash: string) => {
    const [row] = await db
      .select()
      .from(principalHistoryIndexNodes)
      .where(eq(principalHistoryIndexNodes.hash, hash));
    if (!row) throw new Error("Missing index node");
    return row;
  };
  // Damage [1..32], below the root and wholly inside a surviving 33-entry prefix.
  const subtree64 = await node((await node(rootHash)).leftHash);
  await db
    .delete(principalHistoryIndexNodes)
    .where(eq(principalHistoryIndexNodes.hash, subtree64.leftHash));
  return { head, first, rootHash };
}

test("deep index damage with more than 32 saved prefixes eventually rebuilds", async () => {
  const { head, first, rootHash } = await damagedHistory();
  let recovered = false;
  for (let attempt = 0; attempt < 80; attempt += 1) {
    // A large state can consume the preferred byte/time budget by itself.
    const budget = {
      ...principalHistoryPreparationBudget(),
      remainingEntries: 1,
    };
    const result = await preparePrincipalHistory(db, {
      head,
      budget,
      retainedReferences: [first],
    });
    expect(budget.acceptedEntries).toBeLessThanOrEqual(1);
    if (result.complete) {
      expect(result.history.indexRootHash).toBe(rootHash);
      expect(
        result.history.retainedEntries.map((entry) => entry.state.version),
      ).toEqual([1, 65]);
      recovered = true;
      break;
    }
  }
  expect(recovered).toBe(true);
}, 30_000);

test("HTTP continuations recognize progress while stale prefix hints drain", async () => {
  const { head, first } = await damagedHistory();
  const state = await getCurrentPrincipalState("group", head.principalId, db);
  if (!state) throw new Error("Missing prepared state");
  const tokens = new Set<string>();
  let recovered = false;
  for (let attempt = 0; attempt < 8; attempt += 1) {
    try {
      const result = await runPrincipalHistoryTransaction(db, (tx) =>
        getVerifiedPrincipalPolicyForStateWithExecutor(tx, state, [first]),
      );
      expect(result.policy.stateHash).toBe(head.stateHash);
      recovered = true;
      break;
    } catch (error) {
      expect(error).toBeInstanceOf(PrincipalHistoryContinuation);
      if (!(error instanceof PrincipalHistoryContinuation)) throw error;
      expect(tokens.has(error.progressToken)).toBe(false);
      tokens.add(error.progressToken);
    }
  }
  expect(recovered).toBe(true);
  expect(tokens.size).toBeGreaterThan(0);
}, 30_000);
