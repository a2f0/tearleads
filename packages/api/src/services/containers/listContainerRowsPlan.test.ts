import { expect, test } from "bun:test";
import { db } from "@tearleads/api-shared/postgres";
import type { SyncWatermark } from "@tearleads/validators/response";
import { type SQL, sql } from "drizzle-orm";
import { isSqliteApiDatabase } from "../../utils/sqlDialect";
import type { ApiServiceRuntime } from "../runtime";
import { listAccessibleContainersForUser } from "./listContainerRows";

// A listing must not grow with the whole table. SQLite drove these joins from
// every container head or every grant row, so each listing cost time in
// proportion to all containers stored, for every user. Each join now starts
// from the listing's own rows: the user's grant subjects, the parent's
// children, or the parent path.
async function listingPlan(
  parentId: string | null,
  watermark: SyncWatermark | null = null,
): Promise<string[]> {
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
    watermark,
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

// Reading every grant the user holds, through the subject index. A parent
// listing used to build that whole set to test its children against it.
const everyGrantOfTheUser =
  "SEARCH grant_projection USING COVERING INDEX access_manifest_container_grant_subject_manifest_idx (subject_type=? AND subject_id=?)";

test.skipIf(!isSqliteApiDatabase())(
  "a child listing resumes inside the parent's index and checks each child's grant",
  async () => {
    const plan = await listingPlan(crypto.randomUUID(), {
      id: crypto.randomUUID(),
      updatedAt: new Date().toISOString(),
    });
    // The watermark bounds the children's index range, so an incremental
    // poll reads only rows after it, already in page order.
    expect(plan).toContain(
      "SEARCH c USING INDEX containers_parent_updated_idx (parent_id=? AND (updated_at,id)>(?,?))",
    );
    expect(plan).not.toContain("USE TEMP B-TREE FOR ORDER BY");
    // Each child's direct grant is a lookup on its own manifest hash.
    expect(plan).toContain(
      "SEARCH grant_projection USING COVERING INDEX access_manifest_container_grant_unique_idx (manifest_hash=?)",
    );
    expect(plan).not.toContain(everyGrantOfTheUser);
  },
);
