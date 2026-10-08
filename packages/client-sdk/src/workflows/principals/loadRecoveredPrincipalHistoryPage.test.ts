import { beforeAll, expect, test } from "bun:test";
import {
  createRecoveryFixture,
  signedRecoveryHistory,
} from "../../../test/helpers/principalHistoryRecovery";
import { principalHistoryEntries } from "../../data/sqlite/principalHistoryEvidenceSchema";
import { principalPolicyCheckpoints } from "../../data/sqlite/principalPolicySchema";
import { createExecSql } from "../../data/sqlite/sqlSchema";
import { buildOrganizationGroupPolicyHistoryPage } from "../organizations/groupPolicyHistoryPage";
import { loadRecoveredPrincipalHistoryPage } from "./loadRecoveredPrincipalHistoryPage";
import { recoverPrincipalPolicyHistory } from "./recoverPrincipalPolicyHistory";

let history: Awaited<ReturnType<typeof signedRecoveryHistory>>;
beforeAll(async () => {
  history = await signedRecoveryHistory();
}, 30_000);

async function recoveredFixture() {
  const f = await createRecoveryFixture(history);
  try {
    await recoverPrincipalPolicyHistory(f.options);
    f.requests.length = 0;
    return f;
  } catch (error) {
    f.close();
    throw error;
  }
}

test("history pages cover all versions with authenticated boundary predecessors and no HTTP", async () => {
  const f = await recoveredFixture();
  try {
    const first = await loadRecoveredPrincipalHistoryPage(f.options);
    expect(first.entries.map(({ state }) => state.version)).toEqual(
      Array.from({ length: 32 }, (_, index) => index + 35),
    );
    expect(first.predecessor?.state).toEqual(
      history.bundle.previousStates[33]?.state,
    );
    expect(first.nextBeforeVersion).toBe(35);
    const second = await loadRecoveredPrincipalHistoryPage(f.options, 35);
    expect(second.entries.map(({ state }) => state.version)).toEqual(
      Array.from({ length: 32 }, (_, index) => index + 3),
    );
    expect(second.predecessor?.state.version).toBe(2);
    expect(second.nextBeforeVersion).toBe(3);
    const last = await loadRecoveredPrincipalHistoryPage(f.options, 3);
    expect(last.entries.map(({ state }) => state.version)).toEqual([1, 2]);
    expect(last.predecessor).toBeNull();
    expect(last.nextBeforeVersion).toBeNull();
    const displayPages = [first, second, last].map((page) =>
      buildOrganizationGroupPolicyHistoryPage({
        page,
        groupId: history.expectedHead.principalId,
        organizationId: f.options.organizationId,
      }),
    );
    expect(
      displayPages.flatMap(({ entries }) =>
        entries
          .filter(({ version }) => version > 1)
          .flatMap(({ changes }) => changes),
      ),
    ).toEqual([]);
    const member = history.bundle.currentProjection[0];
    if (!member) throw new Error("Missing unchanged fixture member");
    expect(displayPages[2]?.entries.at(-1)?.changes).toEqual([
      {
        changeType: "added",
        userId: member.userId,
        nextRole: "admin",
        previousRole: null,
      },
    ]);
    expect(f.requests).toEqual([]);
    expect(f.options.protection.localKey.some((byte) => byte !== 0)).toBe(true);
  } finally {
    f.close();
  }
});

test.each(["entry", "missing", "key", "expired", "rollback", "fork"] as const)(
  "history page refuses %s without presenting unverified rows",
  async (mode) => {
    const f = await recoveredFixture();
    try {
      if (mode === "entry")
        await f.db
          .update(principalHistoryEntries)
          .set({ entryJson: JSON.stringify(history.bundle.previousStates[1]) })
          .run();
      if (mode === "missing") await f.db.delete(principalHistoryEntries).run();
      if (mode === "rollback" || mode === "fork")
        await f.db
          .insert(principalPolicyCheckpoints)
          .values({
            principalType: "group",
            principalId: history.expectedHead.principalId,
            version: mode === "rollback" ? 67 : 66,
            stateHash: "f".repeat(64),
            updatedAt: new Date().toISOString(),
          })
          .run();
      await expect(
        loadRecoveredPrincipalHistoryPage({
          ...f.options,
          stillCurrent: () => mode !== "expired",
          protection:
            mode === "key"
              ? {
                  ...f.options.protection,
                  localKey: new Uint8Array(32).fill(9),
                }
              : f.options.protection,
        }),
      ).rejects.toThrow();
      expect(f.requests).toEqual([]);
    } finally {
      f.close();
    }
  },
);

test.each([0, 1, -1, 68, 2.5, Number.NaN])(
  "history page rejects invalid cursor %s before I/O",
  async (cursor) => {
    const f = await createRecoveryFixture(history);
    try {
      await expect(
        loadRecoveredPrincipalHistoryPage(f.options, cursor),
      ).rejects.toMatchObject({ code: "invalid_shape" });
      expect(f.requests).toEqual([]);
    } finally {
      f.close();
    }
  },
);

test("a pin published while reading history rows invalidates the display result", async () => {
  const f = await recoveredFixture();
  let advanced = false;
  const execSql = createExecSql({
    async exec({ sql, bind, rowMode }) {
      if (!advanced && sql.includes('from "principal_history_entries"')) {
        advanced = true;
        await f.db
          .insert(principalPolicyCheckpoints)
          .values({
            principalType: "group",
            principalId: history.expectedHead.principalId,
            version: history.expectedHead.version,
            stateHash: history.expectedHead.stateHash,
            updatedAt: history.bundle.currentState.createdAt,
          })
          .run();
      }
      const rows =
        rowMode === "array"
          ? await f.options.execSql(sql, bind, { rowMode: "array" })
          : await f.options.execSql(sql, bind);
      return { rows };
    },
  });
  try {
    await expect(
      loadRecoveredPrincipalHistoryPage({ ...f.options, execSql }),
    ).rejects.toMatchObject({ code: "stale_predecessor" });
    expect(advanced).toBe(true);
    expect(await f.db.select().from(principalPolicyCheckpoints)).toHaveLength(
      1,
    );
    expect(f.requests).toEqual([]);
  } finally {
    f.close();
  }
});
