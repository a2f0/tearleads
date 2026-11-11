import { expect, test } from "bun:test";
import { db } from "@tearleads/api-shared/postgres";
import { selectCurrentPrincipalHeads } from "../shared/internal/principalCurrentStates";

const principals = [
  { principalType: "group", principalId: crypto.randomUUID() },
  { principalType: "organization", principalId: crypto.randomUUID() },
] as const;

// A head must be a top-1 search of its principal's versions, never a grouping
// of every version: a `max(version) GROUP BY` join read whole histories (2
// heads over 1,024 versions each cost 548 buffers on Postgres, 12 this way).
// The planner's choice on a tiny test table says nothing at scale, so this
// checks the statement shape the index search depends on.
test("each current head compares its version with a per-principal max on Postgres", () => {
  const { sql: text, params } = selectCurrentPrincipalHeads(
    db,
    principals,
  ).toSQL();
  expect(text.toLowerCase()).not.toContain("group by");
  expect(text.match(/= \(\s*select max\(/g)).toHaveLength(principals.length);
  expect(params).toHaveLength(principals.length * 4);
});
