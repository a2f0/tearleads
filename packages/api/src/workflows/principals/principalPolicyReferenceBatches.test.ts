import { expect, test } from "bun:test";
import { db } from "@tearleads/api-shared/postgres";
import { principalPolicyMatchesReference } from "@tearleads/crypto";
import { principalHistoryPreparationFixture } from "../../../test/helpers/principalHistoryPreparation";
import { getCurrentPrincipalState } from "../../access/read/principalStateStore";
import { loadPrincipalPolicyReferenceBatches } from "./principalPolicyReferenceBatches";

test("more retained citations than one batch still connect to the exact current head", async () => {
  const { entries, head } = await principalHistoryPreparationFixture({
    versions: 130,
    currentArtifacts: true,
  });
  const stored = await getCurrentPrincipalState("group", head.principalId, db);
  if (!stored) throw new Error("Missing current fixture");
  const references = entries.slice(0, -1).map(({ state }) => state);
  const batches = await loadPrincipalPolicyReferenceBatches(
    db,
    stored,
    references,
  );
  expect(batches).toHaveLength(2);
  for (const { policy } of batches) {
    expect(policy.stateHash).toBe(head.stateHash);
    expect(policy.retainedHistory.length).toBeLessThanOrEqual(129);
  }
  for (const reference of references) {
    expect(
      batches.some(({ policy }) =>
        principalPolicyMatchesReference({ policy, reference }),
      ),
    ).toBe(true);
  }
  const first = references[0];
  if (!first) throw new Error("Missing first fixture");
  await expect(
    loadPrincipalPolicyReferenceBatches(db, stored, [
      { ...first, stateHash: head.stateHash },
    ]),
  ).rejects.toThrow("integrity verification");
}, 30_000);
