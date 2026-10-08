import { beforeAll, expect, test } from "bun:test";
import { eq } from "drizzle-orm";
import {
  createAuthorityRecoveryFixture,
  signedAuthorityRecoveryHistory,
} from "../../../test/helpers/principalAuthorityRecovery";
import { principalPolicyHead } from "../../../test/helpers/principalPolicyFixtures";
import { principalHistoryEntries } from "../../data/sqlite/principalHistoryEvidenceSchema";
import { principalPolicyCheckpoints } from "../../data/sqlite/principalPolicySchema";
import { createRuntimePrincipalPolicyCurrentResolver } from "./runtimePolicyRecovery";

let history: Awaited<ReturnType<typeof signedAuthorityRecoveryHistory>>;
beforeAll(async () => {
  history = await signedAuthorityRecoveryHistory();
}, 30_000);

async function fixture() {
  const f = await createAuthorityRecoveryFixture(history);
  const state = { online: true, current: true };
  const keys: Uint8Array[] = [];
  const resolve = createRuntimePrincipalPolicyCurrentResolver({
    apiClient: f.options.apiClient,
    infra: { execSql: f.options.execSql },
    state,
    resolveTrustedUserIdentity: f.options.resolveTrustedUserIdentity,
    util: { reportSecurityIncident: async () => {} },
    withPrincipalHistoryProtection: async (work) => {
      const localKey = new Uint8Array(f.options.protection.localKey);
      keys.push(localKey);
      try {
        return await work({
          protection: { ...f.options.protection, localKey },
          stillCurrent: () => state.current,
        });
      } finally {
        localKey.fill(0);
      }
    },
  });
  if (!resolve) throw new Error("Missing runtime recovery capability");
  return { ...f, resolve, state, keys };
}

test.each(["directory", "admin", "group"] as const)(
  "runtime reads bounded %s history in its authenticated scope and continues offline",
  async (principal) => {
    const f = await fixture();
    try {
      const request = {
        organizationId: history.organizationId,
        reference: principalPolicyHead(history[principal]),
        historyPage: {},
      };
      const first = await f.resolve(request);
      expect(first.historyPage?.entries).toHaveLength(32);
      expect(first.historyPage?.predecessor?.state.version).toBe(34);
      expect(first.historyPage?.nextBeforeVersion).toBe(35);
      expect(first.policy.retainedHistory.length).toBeLessThanOrEqual(2);
      f.state.online = false;
      f.requests.length = 0;
      const older = await f.resolve({
        ...request,
        historyPage: { beforeVersion: 35 },
      });
      expect(older.historyPage?.entries).toHaveLength(32);
      expect(older.historyPage?.entries[0]?.state.version).toBe(3);
      expect(older.historyPage?.predecessor?.state.version).toBe(2);
      expect(f.requests).toEqual([]);
      expect(f.keys.every((key) => key.every((byte) => byte === 0))).toBe(true);
    } finally {
      f.close();
    }
  },
);

test("an older projected head limits display history without treating its missing prefix as empty", async () => {
  const f = await fixture();
  try {
    const result = await f.resolve({
      organizationId: history.organizationId,
      reference: principalPolicyHead(history.created),
      historyPage: {},
    });
    expect(result.policy.version).toBe(66);
    expect(
      result.historyPage?.entries.map(({ state }) => state.version),
    ).toEqual([1]);
    expect(result.historyPage?.predecessor).toBeNull();
    expect(result.historyPage?.nextBeforeVersion).toBeNull();
    const reads = f.requests.length;
    await f.resolve({
      organizationId: history.organizationId,
      reference: principalPolicyHead(history.created),
      historyPage: {},
      preferLocalCurrent: true,
    });
    expect(f.requests).toHaveLength(reads);
  } finally {
    f.close();
  }
});

test("runtime refuses an unselected or out-of-range history cursor before HTTP", async () => {
  const f = await fixture();
  try {
    await expect(
      f.resolve({ organizationId: history.organizationId, historyPage: {} }),
    ).rejects.toMatchObject({ code: "invalid_shape" });
    await expect(
      f.resolve({
        organizationId: history.organizationId,
        reference: principalPolicyHead(history.created),
        historyPage: { beforeVersion: 67 },
      }),
    ).rejects.toMatchObject({ code: "invalid_shape" });
    expect(f.requests).toEqual([]);
  } finally {
    f.close();
  }
});

test.each(["missing", "substituted"] as const)(
  "%s historical display evidence fails offline and rebuilds signed pages online without moving pins",
  async (damage) => {
    const f = await fixture();
    const reference = principalPolicyHead(history.group);
    const request = {
      organizationId: history.organizationId,
      reference,
      historyPage: {},
      preferLocalCurrent: true,
    };
    try {
      await f.resolve(request);
      await f.db
        .insert(principalPolicyCheckpoints)
        .values({
          principalType: reference.principalType,
          principalId: reference.principalId,
          version: reference.version,
          stateHash: reference.stateHash,
          updatedAt: history.group.currentState.createdAt,
        })
        .run();
      const pins = await f.db.select().from(principalPolicyCheckpoints);
      const rows = await f.db.select().from(principalHistoryEntries);
      const lost = rows.find((row) => {
        const entry = JSON.parse(row.entryJson);
        return (
          entry.state.principalId === reference.principalId &&
          entry.state.version === 40
        );
      });
      if (!lost) throw new Error("Missing historical fixture entry");
      if (damage === "missing") {
        await f.db
          .delete(principalHistoryEntries)
          .where(eq(principalHistoryEntries.leafHash, lost.leafHash))
          .run();
      } else {
        await f.db
          .update(principalHistoryEntries)
          .set({ entryJson: JSON.stringify(history.group.previousStates[38]) })
          .where(eq(principalHistoryEntries.leafHash, lost.leafHash))
          .run();
      }
      f.state.online = false;
      f.requests.length = 0;
      await expect(f.resolve(request)).rejects.toMatchObject({
        name: "ProjectionDependencyUnavailableError",
      });
      expect(f.requests).toEqual([]);
      f.state.online = true;
      const repaired = await f.resolve(request);
      expect(repaired.historyPage?.entries).toHaveLength(32);
      expect(
        f.requests.some(
          (read) =>
            read.principalId === reference.principalId &&
            read.afterVersion === 0,
        ),
      ).toBe(true);
      expect(f.requests.every((read) => read.count <= 32)).toBe(true);
      expect(await f.db.select().from(principalPolicyCheckpoints)).toEqual(
        pins,
      );
    } finally {
      f.close();
    }
  },
);
