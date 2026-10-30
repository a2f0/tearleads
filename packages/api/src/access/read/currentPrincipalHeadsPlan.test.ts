import { expect, test } from "bun:test";
import { db } from "@tearleads/api-shared/postgres";
import { sql } from "drizzle-orm";
import { isSqliteApiDatabase } from "../../utils/sqlDialect";
import { selectCurrentPrincipalHeads } from "../shared/internal/principalStateStore";

const principals = [
  { principalType: "group", principalId: crypto.randomUUID() },
  { principalType: "organization", principalId: crypto.randomUUID() },
] as const;

// A head must be a top-1 search of its principal's versions, never a grouping
// of every version: a `max(version) GROUP BY` join read whole histories (2
// heads over 1,024 versions each cost 548 buffers on Postgres, 12 this way).
test.skipIf(!isSqliteApiDatabase())(
  "each current head is an index search on SQLite",
  async () => {
    const plan = await db.execute(
      sql`explain query plan ${selectCurrentPrincipalHeads(db, principals).getSQL()}`,
    );
    const details = plan.rows.map(({ detail }) => String(detail));
    expect(details).toContain("MULTI-INDEX OR");
    const searches = details.filter((detail) =>
      detail.includes(
        "USING INDEX principal_states_principal_version_idx (principal_type=? AND principal_id=? AND version=?)",
      ),
    );
    expect(searches).toHaveLength(principals.length);
    expect(details.some((detail) => detail.startsWith("SCAN"))).toBe(false);
    expect(details.some((detail) => detail.includes("TEMP B-TREE"))).toBe(
      false,
    );
  },
);

// The planner's choice on a tiny test table says nothing at scale, so on
// Postgres this checks the statement shape the index search depends on.
test.skipIf(isSqliteApiDatabase())(
  "each current head compares its version with a per-principal max on Postgres",
  () => {
    const { sql: text, params } = selectCurrentPrincipalHeads(
      db,
      principals,
    ).toSQL();
    expect(text.toLowerCase()).not.toContain("group by");
    expect(text.match(/= \(\s*select max\(/g)).toHaveLength(principals.length);
    expect(params).toHaveLength(principals.length * 4);
  },
);
