import { expect, test } from "bun:test";
import { createTestExecSql } from "@tearleads/test-utils";
import type { OrganizationReadModelDirectoryResponse } from "@tearleads/validators/response";
import {
  organizationReadModelDelta as delta,
  organizationReadModelDirectory as directory,
  organizationReadModelDirectoryUser as directoryUser,
  organizationReadModelSnapshot as snapshot,
} from "../../../../test/helpers/data/organizationReadModelPersistenceFixtures";
import type { SqlRow } from "../../sqlite/sqlExec";
import { createExecSql, type ExecSql } from "../../sqlite/sqlSchema";
import { OrganizationReadModelRepository } from "./organizationReadModelRepository";

const ORGANIZATION_ID = "organization-directory-diff";
const USER_COUNT = 200;
// A write to the directory table itself, not the prunes that read it.
const DIRECTORY_WRITE_SQL =
  /^\s*(insert into|delete from) "organization_read_model_directory_users"/i;
const DIRECTORY_ROWS_SQL =
  "SELECT * FROM organization_read_model_directory_users ORDER BY user_id";

function wideDirectory(
  users: ReadonlyArray<string>,
  changes: Record<string, Partial<{ status: "active" | "disabled" }>> = {},
): OrganizationReadModelDirectoryResponse {
  return directory(ORGANIZATION_ID, {
    users: users.map((userId) =>
      directoryUser(userId, {
        isSelf: userId === "user-0",
        ...(changes[userId] ?? {}),
      }),
    ),
  });
}

interface CapturedWrite {
  readonly bindCount: number;
  readonly sql: string;
}

async function withCapturingRepository(
  key: string,
  run: (input: {
    readonly execSql: ExecSql;
    readonly repository: OrganizationReadModelRepository;
    readonly writes: CapturedWrite[];
  }) => Promise<void>,
): Promise<void> {
  const f = await createTestExecSql(key);
  const writes: CapturedWrite[] = [];
  const execSql = createExecSql({
    exec: async ({ sql, bind, rowMode }) => {
      if (DIRECTORY_WRITE_SQL.test(sql)) {
        writes.push({ bindCount: Array.isArray(bind) ? bind.length : 0, sql });
      }
      return {
        rows: await f.execSql(sql, bind, rowMode ? { rowMode } : undefined),
      };
    },
  });
  try {
    await run({
      execSql,
      repository: new OrganizationReadModelRepository(execSql),
      writes,
    });
  } finally {
    f.close();
  }
}

/** The rows a fresh device stores when the same lane arrives in a snapshot. */
async function snapshotRows(
  lane: OrganizationReadModelDirectoryResponse,
): Promise<SqlRow[]> {
  let rows: SqlRow[] = [];
  await withCapturingRepository(
    "organization-directory-diff-reference",
    async ({ execSql, repository }) => {
      const base = snapshot(ORGANIZATION_ID, "cursor-reference");
      await repository.applyOrganizationReadModelResponse({
        currentUserId: "user-0",
        requestedCursor: null,
        response: { ...base, lanes: { ...base.lanes, directory: lane } },
      });
      rows = await execSql(DIRECTORY_ROWS_SQL);
    },
  );
  return rows;
}

test("a directory delta writes only the rows that differ", async () => {
  const users = Array.from({ length: USER_COUNT }, (_, i) => `user-${i}`);
  await withCapturingRepository(
    "organization-directory-diff",
    async ({ execSql, repository, writes }) => {
      const base = snapshot(ORGANIZATION_ID, "cursor-1");
      await repository.applyOrganizationReadModelResponse({
        currentUserId: "user-0",
        requestedCursor: null,
        response: {
          ...base,
          lanes: { ...base.lanes, directory: wideDirectory(users) },
        },
      });

      // One member disabled and one appended: two rows, one statement.
      const changed = wideDirectory([...users, "user-new"], {
        "user-5": { status: "disabled" },
      });
      writes.length = 0;
      await repository.applyOrganizationReadModelResponse({
        currentUserId: "user-0",
        requestedCursor: "cursor-1",
        response: delta({
          directory: changed,
          nextCursor: "cursor-2",
          organizationId: ORGANIZATION_ID,
        }),
      });
      const changedWrites = writes.filter((write) =>
        /^\s*insert/i.test(write.sql),
      );
      expect(changedWrites).toHaveLength(1);
      expect(writes.filter((write) => /^\s*delete/i.test(write.sql))).toEqual(
        [],
      );
      const columnCount = Object.keys(
        (await execSql(DIRECTORY_ROWS_SQL))[0] ?? {},
      ).length;
      expect(changedWrites[0]?.bindCount).toBe(2 * columnCount);
      expect(await execSql(DIRECTORY_ROWS_SQL)).toEqual(
        await snapshotRows(changed),
      );

      // An unchanged lane writes nothing; a removed member is deleted.
      writes.length = 0;
      await repository.applyOrganizationReadModelResponse({
        currentUserId: "user-0",
        requestedCursor: "cursor-2",
        response: delta({
          directory: changed,
          nextCursor: "cursor-3",
          organizationId: ORGANIZATION_ID,
        }),
      });
      expect(writes).toEqual([]);

      const removed = wideDirectory(
        [...users, "user-new"].filter((userId) => userId !== "user-150"),
        { "user-5": { status: "disabled" } },
      );
      await repository.applyOrganizationReadModelResponse({
        currentUserId: "user-0",
        requestedCursor: "cursor-3",
        response: delta({
          directory: removed,
          nextCursor: "cursor-4",
          organizationId: ORGANIZATION_ID,
        }),
      });
      // Removing a member shifts the sort order of everyone after it.
      expect(writes.filter((write) => /^\s*delete/i.test(write.sql))).toEqual([
        expect.objectContaining({ bindCount: 2 }),
      ]);
      expect(await execSql(DIRECTORY_ROWS_SQL)).toEqual(
        await snapshotRows(removed),
      );
    },
  );
});
