import { expect, test } from "bun:test";
import { sql } from "drizzle-orm";
import { withDatabaseStatementCounter } from "./databaseStatementCounter";
import {
  type ObservedDatabaseStatement,
  observeDatabaseStatements,
} from "./databaseStatementObserver";
import { createDefaultManagedApiDatabase } from "./postgres";

test("observers see each statement's text, parameters, and scope until they stop", async () => {
  const managed = createDefaultManagedApiDatabase({ API_DATABASE: "memory" });
  const first: ObservedDatabaseStatement[] = [];
  const second: ObservedDatabaseStatement[] = [];
  const stopFirst = observeDatabaseStatements((statement) => {
    first.push(statement);
  });
  const stopSecond = observeDatabaseStatements((statement) => {
    second.push(statement);
  });
  const counter = { statements: 0 };
  const inner = { statements: 0 };
  try {
    await withDatabaseStatementCounter(counter, async () => {
      await managed.db.execute(sql`select ${41} + 1 as answer`);
      await withDatabaseStatementCounter(inner, async () => {
        await managed.db.execute(sql`select 3`);
      });
    });
    await withDatabaseStatementCounter({ statements: 0 }, async () => {
      await managed.db.execute(sql`select 4`);
    });
    stopFirst();
    await managed.db.execute(sql`select 2`);
  } finally {
    stopSecond();
    await managed.close();
  }
  expect([counter.statements, inner.statements]).toEqual([2, 1]);
  expect(first.map(({ sql, parameters }) => ({ sql, parameters }))).toEqual([
    { sql: "select $1 + 1 as answer", parameters: [41] },
    { sql: "select 3", parameters: [] },
    { sql: "select 4", parameters: [] },
  ]);
  // A nested counter shares its outermost scope; a separate one does not.
  const [answer, nested, separate] = first.map(({ scope }) => scope);
  expect(answer).toBeObject();
  expect(nested).toBe(answer);
  expect(separate).not.toBe(answer);
  expect(second.map((statement) => statement.sql)).toEqual([
    "select $1 + 1 as answer",
    "select 3",
    "select 4",
    "select 2",
  ]);
  expect(second.at(-1)?.scope).toBeUndefined();
});
