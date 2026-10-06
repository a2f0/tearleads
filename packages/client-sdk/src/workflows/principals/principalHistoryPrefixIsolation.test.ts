import { beforeAll, expect, test } from "bun:test";
import {
  createRecoveryFixture,
  signedRecoveryHistory,
} from "../../../test/helpers/principalHistoryRecovery";
import { principalHistoryPrefixes } from "../../data/sqlite/principalHistoryEvidenceSchema";
import { principalHistoryStages } from "../../data/sqlite/principalHistoryStageSchema";
import { recoverPrincipalPolicyHistory } from "./recoverPrincipalPolicyHistory";

let history: Awaited<ReturnType<typeof signedRecoveryHistory>>;
beforeAll(async () => {
  history = await signedRecoveryHistory();
});

async function cachedFixture() {
  const fixture = await createRecoveryFixture(history);
  try {
    await recoverPrincipalPolicyHistory(fixture.options);
    // Exercise the shared prefix independently of the exact-head stage.
    await fixture.db.delete(principalHistoryStages).run();
    fixture.requests.length = 0;
    return fixture;
  } catch (error) {
    fixture.close();
    throw error;
  }
}

test.each(["ciphertext", "head", "version", "organization"] as const)(
  "a completed prefix with changed %s replays signed history",
  async (field) => {
    const fixture = await cachedFixture();
    try {
      const mutation =
        field === "ciphertext"
          ? { progress: "corrupted" }
          : field === "head"
            ? {
                headJson: JSON.stringify({
                  ...history.expectedHead,
                  stateHash: "f".repeat(64),
                }),
              }
            : field === "version"
              ? { version: 65 }
              : { organizationId: "org-2" };
      await fixture.db.update(principalHistoryPrefixes).set(mutation).run();
      const recovered = await recoverPrincipalPolicyHistory(fixture.options);
      expect(recovered.policy.stateHash).toBe(history.expectedHead.stateHash);
      expect(fixture.requests).toEqual([0, 32, 64]);
    } finally {
      fixture.close();
    }
  },
);

test.each(["key", "context", "organization"] as const)(
  "a changed %s cannot reuse another verification scope",
  async (field) => {
    const fixture = await cachedFixture();
    try {
      const options = {
        ...fixture.options,
        organizationId: field === "organization" ? "org-2" : "org-1",
        protection: {
          context:
            field === "context"
              ? "different-trust-domain"
              : fixture.options.protection.context,
          localKey:
            field === "key"
              ? new Uint8Array(32).fill(8)
              : fixture.options.protection.localKey,
        },
      };
      const recovered = await recoverPrincipalPolicyHistory(options);
      expect(recovered.policy.stateHash).toBe(history.expectedHead.stateHash);
      expect(fixture.requests).toEqual([0, 32, 64]);
      expect(
        await fixture.db.select().from(principalHistoryPrefixes),
      ).toHaveLength(field === "key" ? 1 : 2);
    } finally {
      fixture.close();
    }
  },
);

test("a shared completed prefix still requires a successful pinned HTTP read", async () => {
  const fixture = await cachedFixture();
  try {
    fixture.controls.failAfterVersion = 65;
    await expect(
      recoverPrincipalPolicyHistory(fixture.options),
    ).rejects.toMatchObject({ failure: { status: 503 } });
    expect(fixture.requests).toEqual([65]);
    expect(
      await fixture.db.select().from(principalHistoryPrefixes),
    ).toHaveLength(1);
  } finally {
    fixture.close();
  }
});

test("a different same-version target cannot discard an authenticated completed prefix", async () => {
  const fixture = await cachedFixture();
  try {
    const prefixes = await fixture.db.select().from(principalHistoryPrefixes);
    await expect(
      recoverPrincipalPolicyHistory({
        ...fixture.options,
        expectedHead: { ...history.expectedHead, stateHash: "f".repeat(64) },
      }),
    ).rejects.toMatchObject({ failure: { kind: "shape" } });
    expect(await fixture.db.select().from(principalHistoryPrefixes)).toEqual(
      prefixes,
    );
  } finally {
    fixture.close();
  }
});
