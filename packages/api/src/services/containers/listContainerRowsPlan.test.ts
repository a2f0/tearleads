import { expect, test } from "bun:test";
import { db } from "@tearleads/api-shared/postgres";
import { type SQL, sql } from "drizzle-orm";
import { isSqliteApiDatabase } from "../../utils/sqlDialect";
import type { ApiServiceRuntime } from "../runtime";
import { listAccessibleContainersForUser } from "./listContainerRows";

// A listing must not grow with the whole table. SQLite drove these joins from
// every container head or every grant row, so each listing cost time in
// proportion to all containers stored, for every user. Each join now starts
// from the listing's own rows: the user's grant subjects, the parent's
// children, or the parent path.
async function listingPlan(parentId: string | null): Promise<string[]> {
  let captured: SQL | undefined;
  const runtime = {
    db: {
      execute: (query: SQL) => {
        captured = query;
        return db.execute(query);
      },
    },
  } as unknown as ApiServiceRuntime;
  await listAccessibleContainersForUser({
    limit: 10,
    parentId,
    runtime,
    userId: crypto.randomUUID(),
    watermark: null,
  });
  if (!captured) throw new Error("Expected the listing to run its query");
  const plan = await db.execute(sql`explain query plan ${captured}`);
  return plan.rows.map(({ detail }) => String(detail));
}

// The lookup that let SQLite start from every container head.
const everyContainerHead =
  "SEARCH h USING INDEX access_manifest_heads_object_idx (object_kind=?)";

test.skipIf(!isSqliteApiDatabase())(
  "a root listing reaches grants through the user's subjects",
  async () => {
    const plan = await listingPlan(null);
    expect(plan).toContain(
      "SEARCH grant_projection USING COVERING INDEX access_manifest_container_grant_subject_manifest_idx (subject_type=? AND subject_id=?)",
    );
    expect(plan).not.toContain(everyContainerHead);
  },
);

test.skipIf(!isSqliteApiDatabase())(
  "a child listing starts from the parent's children and path",
  async () => {
    const plan = await listingPlan(crypto.randomUUID());
    expect(
      plan.some((line) =>
        /^SEARCH c USING (COVERING )?INDEX containers_parent_\w+ \(parent_id=\?/u.test(
          line,
        ),
      ),
    ).toBe(true);
    expect(
      plan.some((line) =>
        /^SEARCH grant_projection USING COVERING INDEX \w+ \(manifest_hash=\?\)$/u.test(
          line,
        ),
      ),
    ).toBe(true);
    expect(plan).not.toContain(everyContainerHead);
  },
);
