import { beforeAll, expect, test } from "bun:test";
import {
  computePrincipalStateHash,
  signPrincipalState,
} from "@tearleads/crypto";
import {
  createRecoveryFixture,
  signedRecoveryHistory,
} from "../../../test/helpers/principalHistoryRecovery";
import { principalHistoryPrefixes } from "../../data/sqlite/principalHistoryEvidenceSchema";
import { recoverPrincipalPolicyHistory } from "./recoverPrincipalPolicyHistory";

let history: Awaited<ReturnType<typeof signedRecoveryHistory>>;
let shorterFork: typeof history;
beforeAll(async () => {
  history = await signedRecoveryHistory();
  shorterFork = await signedRecoveryHistory(32);
});

test("a disconnected cached prefix permits exactly one genesis replay", async () => {
  const fixture = await createRecoveryFixture(history, [shorterFork.bundle]);
  try {
    await recoverPrincipalPolicyHistory({
      ...fixture.options,
      expectedHead: shorterFork.expectedHead,
      resolveTrustedUserIdentity: shorterFork.resolveTrustedUserIdentity,
    });
    fixture.requests.length = 0;
    const recovered = await recoverPrincipalPolicyHistory(fixture.options);
    expect(recovered.policy.checkpoint.stateHash).toBe(
      history.expectedHead.stateHash,
    );
    expect(fixture.requests).toEqual([32, 0, 32, 64]);
    const prefixes = await fixture.db.select().from(principalHistoryPrefixes);
    expect(prefixes).toHaveLength(1);
    expect(prefixes[0]?.version).toBe(66);
    expect(JSON.parse(prefixes[0]?.headJson ?? "null")).toEqual(
      history.expectedHead,
    );
  } finally {
    fixture.close();
  }
});

test("a fresh stage with a disconnected page fails without replay", async () => {
  const fixture = await createRecoveryFixture(history);
  try {
    const entry = history.bundle.previousStates[32];
    if (!entry) throw new Error("Missing page entry");
    const signed = await signPrincipalState(
      { ...entry.state, prevStateHash: "f".repeat(64) },
      history.signingPrivateKey,
    );
    const disconnected = {
      ...entry,
      state: {
        ...signed,
        stateHash: await computePrincipalStateHash(signed),
        createdAt: entry.state.createdAt,
      },
    };
    fixture.controls.mutate = (page) => {
      if (page.historyPage.afterVersion === 32)
        page.previousStates[0] = disconnected;
    };
    await expect(
      recoverPrincipalPolicyHistory(fixture.options),
    ).rejects.toMatchObject({ code: "stale_predecessor" });
    expect(fixture.requests).toEqual([0, 32]);
    expect(await fixture.db.select().from(principalHistoryPrefixes)).toEqual(
      [],
    );
  } finally {
    fixture.close();
  }
});
