import { beforeAll, expect, test } from "bun:test";
import {
  createRecoveryFixture,
  signedRecoveryHistory,
} from "../../../test/helpers/principalHistoryRecovery";
import { principalHistoryPrefixes } from "../../data/sqlite/principalHistoryEvidenceSchema";
import { recoverPrincipalPolicyHistory } from "./recoverPrincipalPolicyHistory";

let history: Awaited<ReturnType<typeof signedRecoveryHistory>>;
let nonAdminHistory: typeof history;
beforeAll(async () => {
  history = await signedRecoveryHistory();
  nonAdminHistory = await signedRecoveryHistory(66, (version, userId) => [
    { userId, role: "admin" },
    ...(version === 48
      ? [
          {
            userId: "33333333-3333-4333-8333-333333333333",
            role: "member" as const,
          },
        ]
      : []),
  ]);
});

test("strict Admins recovery checks omitted historical projections before caching", async () => {
  const fixture = await createRecoveryFixture(nonAdminHistory);
  try {
    // A genuine, authorized chain with a direct member at an older version
    // is valid general policy history, but never a strict Admins history.
    await recoverPrincipalPolicyHistory(fixture.options);
    fixture.requests.length = 0;
    await expect(
      recoverPrincipalPolicyHistory({
        ...fixture.options,
        historyVerification: "direct-admins",
      }),
    ).rejects.toMatchObject({ code: "invalid_shape" });
    expect(fixture.requests).toEqual([0, 32]);
    fixture.requests.length = 0;
    await expect(
      recoverPrincipalPolicyHistory({
        ...fixture.options,
        historyVerification: "direct-admins",
      }),
    ).rejects.toMatchObject({ code: "invalid_shape" });
    expect(fixture.requests).toEqual([32]);
    expect(
      await fixture.db.select().from(principalHistoryPrefixes),
    ).toHaveLength(1);
  } finally {
    fixture.close();
  }
});

test("strict Admins progress is separate from general history and resumes independently", async () => {
  const fixture = await createRecoveryFixture(history);
  try {
    await recoverPrincipalPolicyHistory(fixture.options);
    fixture.requests.length = 0;
    const options = {
      ...fixture.options,
      historyVerification: "direct-admins" as const,
    };
    const recovered = await recoverPrincipalPolicyHistory(options);
    expect(recovered.policy.stateHash).toBe(history.expectedHead.stateHash);
    expect(fixture.requests).toEqual([0, 32, 64]);
    fixture.requests.length = 0;
    await recoverPrincipalPolicyHistory(options);
    expect(fixture.requests).toEqual([65]);
    expect(
      await fixture.db.select().from(principalHistoryPrefixes),
    ).toHaveLength(2);
  } finally {
    fixture.close();
  }
});

test("strict Admins recovery refuses an external-authority fallback", async () => {
  const fixture = await createRecoveryFixture(history);
  try {
    await expect(
      recoverPrincipalPolicyHistory({
        ...fixture.options,
        historyVerification: "direct-admins",
        loadExternalAuthority: async () => undefined,
      }),
    ).rejects.toMatchObject({ code: "invalid_shape" });
    expect(fixture.requests).toEqual([]);
  } finally {
    fixture.close();
  }
});
