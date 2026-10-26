import { mock } from "bun:test";
import { repetitions } from "./probe";

export function probeFixture(readOnly = "on") {
  const calls: string[] = [];
  const query = mock(async (sql: string) => {
    calls.push(sql);
    if (sql === "SHOW transaction_read_only")
      return { rows: [{ transaction_read_only: readOnly }] };
    if (sql.startsWith("EXPLAIN"))
      return {
        rows: [
          { "QUERY PLAN": [{ "Planning Time": 0.02, "Execution Time": 0.01 }] },
        ],
      };
    if (sql.includes(";"))
      return Array.from({ length: repetitions }, () => ({
        rows: [{ value: 1 }],
      }));
    return { rows: [{ value: 1 }] };
  });
  const release = mock(() => {});
  const client = { query, release };
  return {
    calls,
    client,
    connect: mock(async () => client),
    end: mock(async () => {}),
  };
}
