import { beforeAll, expect, test } from "bun:test";
import {
  createRecoveryFixture,
  signedRecoveryHistory,
} from "../../../test/helpers/principalHistoryRecovery";
import { principalPolicyHead } from "../../../test/helpers/principalPolicyFixtures";
import { createPublicHistoryFixture } from "../../../test/helpers/publicPrincipalHistory";
import { loadRecoveredPrincipalHistoryPage } from "../../workflows/principals/loadRecoveredPrincipalHistoryPage";
import { recoverPrincipalPolicyHistory } from "../../workflows/principals/recoverPrincipalPolicyHistory";
import { recoverPublicPrincipalHistory } from "../../workflows/principals/recoverPublicPrincipalHistory";
import {
  principalHistoryEntries,
  principalHistoryNodes,
} from "../sqlite/principalHistoryEvidenceSchema";
import { principalHistoryRootOwners } from "../sqlite/principalHistoryNodeRetentionSchema";

let history: Awaited<ReturnType<typeof signedRecoveryHistory>>;
beforeAll(async () => {
  history = await signedRecoveryHistory(128);
}, 30_000);

function earlierBundles() {
  return history.bundle.previousStates.map((entry, index) => ({
    ...history.bundle,
    currentState: entry.state,
    currentProjection: entry.projection,
    currentGrants: entry.grants,
    currentPayload: {
      ...history.bundle.currentPayload,
      stateHash: entry.state.stateHash,
    },
    currentMemberEnvelopes: {
      ...history.bundle.currentMemberEnvelopes,
      stateHash: entry.state.stateHash,
    },
    previousStates: history.bundle.previousStates.slice(0, index),
  }));
}

test("128 private heads retain a linear proof graph and every authenticated historical page offline", async () => {
  const bundles = [...earlierBundles(), history.bundle];
  const f = await createRecoveryFixture(history, bundles);
  try {
    for (const bundle of bundles)
      await recoverPrincipalPolicyHistory({
        ...f.options,
        expectedHead: principalPolicyHead(bundle),
      });
    expect(await f.db.select().from(principalHistoryNodes)).toHaveLength(133);
    expect(await f.db.select().from(principalHistoryEntries)).toHaveLength(128);
    expect(await f.db.select().from(principalHistoryRootOwners)).toHaveLength(
      3,
    );
    const requests = f.requests.length;
    for (const bundle of bundles.slice(-2)) {
      const recovered = await recoverPrincipalPolicyHistory({
        ...f.options,
        expectedHead: principalPolicyHead(bundle),
        offline: true,
      });
      expect(recovered.policy.stateHash).toBe(bundle.currentState.stateHash);
    }
    const versions: number[] = [];
    let cursor: number | null = 129;
    while (cursor !== null) {
      const page = await loadRecoveredPrincipalHistoryPage(f.options, cursor);
      versions.push(...page.entries.map((entry) => entry.state.version));
      cursor = page.nextBeforeVersion;
    }
    expect(versions.sort((a, b) => a - b)).toEqual(
      Array.from({ length: 128 }, (_, index) => index + 1),
    );
    expect(f.requests).toHaveLength(requests);
  } finally {
    f.close();
  }
}, 30_000);

test("public prefix replacement releases obsolete roots while preserving old-head proofs", async () => {
  const bundles = [...earlierBundles(), history.bundle];
  const f = await createPublicHistoryFixture(history, bundles);
  try {
    for (const bundle of bundles)
      await recoverPublicPrincipalHistory({
        ...f.options,
        source: f.source(bundle),
      });
    expect(await f.db.select().from(principalHistoryNodes)).toHaveLength(127);
    expect(await f.db.select().from(principalHistoryEntries)).toHaveLength(128);
    expect(await f.db.select().from(principalHistoryRootOwners)).toHaveLength(
      1,
    );
    const requests = f.requests.length;
    for (const bundle of bundles) {
      const recovered = await recoverPublicPrincipalHistory({
        ...f.options,
        source: f.source(bundle),
        offline: true,
      });
      expect(recovered.history.currentEntry.state.version).toBe(128);
    }
    expect(f.requests).toHaveLength(requests);
  } finally {
    f.close();
  }
}, 30_000);
