import { expect, test } from "bun:test";
import { eq } from "drizzle-orm";
import { signedRecoveryHistory } from "../../../../test/helpers/principalHistoryRecovery";
import { retentionBatchFixture } from "../../../../test/helpers/principalRetentionBatch";
import { principalHistoryNodes } from "../../sqlite/schema/principalHistoryEvidenceSchema";
import { principalHistoryStages } from "../../sqlite/schema/principalHistoryStageSchema";

const passes = ["incomplete", "completed", "unpublished"] as const;

test.each(passes)(
  "%s retention preserves mixed root multiplicities, floors and scopes",
  async (pass) => {
    const f = await retentionBatchFixture(pass, 16);
    try {
      const roots = [
        "shared-root",
        "shared-root",
        "floor",
        "floor",
        "zero",
        "zero",
        null,
        "",
        "absent",
        "foreign-org",
        ...Array<string>(6).fill("single"),
      ];
      for (const [index, rootHash] of roots.entries())
        await f.db
          .update(principalHistoryStages)
          .set({ rootHash })
          .where(eq(principalHistoryStages.id, f.rows[index]?.id ?? "missing"));
      await f.db.insert(principalHistoryNodes).values([
        { ...f.scope, hash: "floor", referenceCount: 1, managed: false },
        { ...f.scope, hash: "zero", referenceCount: 0, managed: false },
        { ...f.scope, hash: "single", referenceCount: 9, managed: false },
        {
          ...f.scope,
          hash: "foreign-org",
          organizationId: "org-2",
          referenceCount: 9,
          managed: false,
        },
        {
          ...f.scope,
          hash: "shared-root",
          scopeId: "scope-2",
          referenceCount: 9,
          managed: false,
        },
      ]);
      await f.db.insert(principalHistoryStages).values([
        { ...f.stage, id: "foreign-scope", scopeId: "scope-2", touchedAt: -1 },
        {
          ...f.stage,
          id: "foreign-organization",
          organizationId: "org-2",
          touchedAt: -1,
        },
        {
          ...f.stage,
          id: "opposite-completion",
          complete: !f.stage.complete,
          touchedAt: -1,
        },
      ]);
      const before = await f.snapshot();
      f.statements.length = 0;
      await f.run();
      const measured = [...f.statements];
      const after = await f.snapshot();
      expect(after.stages).toEqual(
        before.stages.filter(
          (row) => !f.rows.slice(0, 16).some((old) => old.id === row.id),
        ),
      );
      expect(after.nodes).toEqual(
        before.nodes.map((row) => {
          if (
            row.scopeId !== f.scope.scopeId ||
            row.organizationId !== f.scope.organizationId
          )
            return row;
          const decrements = roots.filter((root) => root === row.hash).length;
          return {
            ...row,
            referenceCount: Math.max(row.referenceCount - decrements, 0),
          };
        }),
      );
      expect(after.archives).toEqual(before.archives);
      expect(after.prefixes).toEqual(before.prefixes);
      expect(measured.every((entry) => entry.binds <= 999)).toBe(true);
      // Three distinct positive multiplicities (1, 2, 6) need three writes.
      expect(
        measured.filter((entry) =>
          entry.sql.startsWith('update "principal_history_nodes"'),
        ),
      ).toHaveLength(3);
    } finally {
      f.close();
    }
  },
);

const failures = passes.flatMap((pass) => [
  { pass, after: 'update "principal_history_nodes"' },
  ...(pass === "incomplete"
    ? []
    : [{ pass, after: 'insert into "principal_key_envelope_archive"' }]),
  { pass, after: 'delete from "principal_history_stages"' },
]);

test.each(failures)(
  "$pass retention rolls back after $after",
  async ({ pass, after }) => {
    const { bundle } = await signedRecoveryHistory(1);
    const f = await retentionBatchFixture(pass, 16, JSON.stringify(bundle));
    try {
      const before = await f.snapshot();
      let injected = 0;
      f.fault.afterSql = (sql) => {
        if (sql.startsWith(after)) {
          injected++;
          throw new Error("retention crash after durable statement");
        }
      };
      f.statements.length = 0;
      const error = await f.run().then(
        () => null,
        (cause: unknown) => cause,
      );
      expect(error).toBeInstanceOf(Error);
      expect(error).toMatchObject({
        cause: { message: "retention crash after durable statement" },
      });
      expect(injected).toBe(1);
      expect(f.statements[0]?.sql).toBe("BEGIN IMMEDIATE");
      expect(f.statements.at(-1)?.sql).toBe("ROLLBACK");
      f.fault.afterSql = () => {};
      expect(await f.snapshot()).toEqual(before);
      await f.run();
      const afterRetry = await f.snapshot();
      expect(afterRetry.stages).toHaveLength(f.retained);
      expect(afterRetry.nodes[0]?.referenceCount).toBe(f.retained + 1);
      expect(afterRetry.archives).toHaveLength(pass === "incomplete" ? 0 : 1);
    } finally {
      f.close();
    }
  },
);
