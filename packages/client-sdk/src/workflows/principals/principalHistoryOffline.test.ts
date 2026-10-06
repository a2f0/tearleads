import { beforeAll, expect, test } from "bun:test";
import {
  createAuthorityRecoveryFixture,
  signedAuthorityRecoveryHistory,
} from "../../../test/helpers/principalAuthorityRecovery";
import { principalPolicyHead } from "../../../test/helpers/principalPolicyFixtures";
import {
  principalHistoryNodes,
  principalHistoryPrefixes,
} from "../../data/sqlite/principalHistoryEvidenceSchema";
import { principalHistoryStages } from "../../data/sqlite/principalHistoryStageSchema";
import { principalPolicyCheckpoints } from "../../data/sqlite/principalPolicySchema";
import { recoverScopedPrincipalPolicyHistory } from "./recoverScopedPrincipalPolicyHistory";

let history: Awaited<ReturnType<typeof signedAuthorityRecoveryHistory>>;
beforeAll(async () => {
  history = await signedAuthorityRecoveryHistory();
});

async function cachedFixture() {
  const fixture = await createAuthorityRecoveryFixture(history);
  try {
    await recoverScopedPrincipalPolicyHistory(fixture.options);
    await fixture.db.delete(principalHistoryStages).run();
    fixture.requests.length = 0;
    return fixture;
  } catch (error) {
    fixture.close();
    throw error;
  }
}

test("offline recovery restores completed directory, Admins and group prefixes for a new citation", async () => {
  const fixture = await cachedFixture();
  try {
    const key = new Uint8Array(fixture.options.protection.localKey);
    const result = await recoverScopedPrincipalPolicyHistory({
      ...fixture.options,
      offline: true,
      reference: principalPolicyHead(history.created),
    });
    expect(
      result.policy.retainedHistory.map(({ state }) => state.version),
    ).toEqual([1, 66]);
    expect(result.dependencies.map((policy) => policy.stateHash)).toEqual([
      history.directory.currentState.stateHash,
      history.admin.currentState.stateHash,
    ]);
    expect(fixture.requests).toEqual([]);
    expect(fixture.options.protection.localKey).toEqual(key);
    expect(await fixture.db.select().from(principalPolicyCheckpoints)).toEqual(
      [],
    );
  } finally {
    fixture.close();
  }
});

test("cold offline recovery fails without making a request", async () => {
  const fixture = await createAuthorityRecoveryFixture(history);
  try {
    await expect(
      recoverScopedPrincipalPolicyHistory({
        ...fixture.options,
        offline: true,
      }),
    ).rejects.toMatchObject({ code: "missing_dependency" });
    expect(fixture.requests).toEqual([]);
  } finally {
    fixture.close();
  }
});

test("a citation newer than the offline directory reports unavailable evidence", async () => {
  const fixture = await cachedFixture();
  try {
    await expect(
      recoverScopedPrincipalPolicyHistory({
        ...fixture.options,
        offline: true,
        reference: { ...fixture.options.reference, version: 67 },
      }),
    ).rejects.toMatchObject({ code: "missing_dependency" });
    expect(fixture.requests).toEqual([]);
  } finally {
    fixture.close();
  }
});

test.each(["key", "context", "current", "proof"] as const)(
  "offline recovery refuses unavailable %s evidence without a network fallback",
  async (damage) => {
    const fixture = await cachedFixture();
    try {
      const protection = { ...fixture.options.protection };
      if (damage === "key") protection.localKey = new Uint8Array(32).fill(8);
      if (damage === "context") protection.context += ":retired";
      if (damage === "current")
        await fixture.db
          .update(principalHistoryPrefixes)
          .set({ currentJson: "{}" })
          .run();
      if (damage === "proof")
        await fixture.db.delete(principalHistoryNodes).run();
      await expect(
        recoverScopedPrincipalPolicyHistory({
          ...fixture.options,
          protection,
          offline: true,
          reference: principalPolicyHead(history.created),
        }),
      ).rejects.toMatchObject({ code: "missing_dependency" });
      expect(fixture.requests).toEqual([]);
      expect(
        await fixture.db.select().from(principalPolicyCheckpoints),
      ).toEqual([]);
    } finally {
      fixture.close();
    }
  },
);

test("offline recovery still refuses a newer durable checkpoint", async () => {
  const fixture = await cachedFixture();
  try {
    await fixture.db
      .insert(principalPolicyCheckpoints)
      .values({
        principalType: "group",
        principalId: history.group.currentState.principalId,
        version: 67,
        stateHash: "f".repeat(64),
        updatedAt: history.group.currentState.createdAt,
      })
      .run();
    await expect(
      recoverScopedPrincipalPolicyHistory({
        ...fixture.options,
        offline: true,
      }),
    ).rejects.toMatchObject({ code: "rollback" });
    expect(fixture.requests).toEqual([]);
    expect(
      (await fixture.db.select().from(principalPolicyCheckpoints))[0]?.version,
    ).toBe(67);
  } finally {
    fixture.close();
  }
});
