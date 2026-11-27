import { expect, test } from "bun:test";
import { sql } from "drizzle-orm";
import {
  recordRequestScopeMetadata,
  withDatabaseStatementCounter,
  withRequestStatementCounter,
} from "./databaseStatementCounter";
import type {
  ObservedDatabaseRequestScope,
  ObservedDatabaseStatement,
} from "./databaseStatementObserver";
import * as statementObserver from "./databaseStatementObserver";
import { createDefaultManagedApiDatabase } from "./postgres";

test("observers see each statement's text, parameters, and scope until they stop", async () => {
  const managed = createDefaultManagedApiDatabase({ API_DATABASE: "memory" });
  const first: ObservedDatabaseStatement[] = [];
  const second: ObservedDatabaseStatement[] = [];
  const stopFirst = statementObserver.observeDatabaseStatements((statement) => {
    first.push(statement);
  });
  const stopSecond = statementObserver.observeDatabaseStatements(
    (statement) => {
      second.push(statement);
    },
  );
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
  // Outside a request, a nested counter shares its outermost scope; a
  // separate one does not.
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

test("observers see the request a statement ran in, inside any counter", async () => {
  const managed = createDefaultManagedApiDatabase({ API_DATABASE: "memory" });
  const scopes: (object | undefined)[] = [];
  const stop = statementObserver.observeDatabaseStatements(({ scope }) => {
    scopes.push(scope);
  });
  const outer = { statements: 0 };
  const request = async () => {
    const counter = { statements: 0 };
    await withRequestStatementCounter(counter, async () => {
      await managed.db.execute(sql`select 1`);
      // A counter inside the request still reports the request.
      await withDatabaseStatementCounter({ statements: 0 }, async () => {
        await managed.db.execute(sql`select 2`);
      });
    });
    return counter;
  };
  try {
    await withDatabaseStatementCounter(outer, async () => {
      await managed.db.execute(sql`select 0`);
      await request();
      await request();
    });
  } finally {
    stop();
    await managed.close();
  }
  expect(outer.statements).toBe(5);
  const [setup, a1, a2, b1, b2] = scopes;
  expect(a2).toBe(a1);
  expect(b2).toBe(b1);
  expect(new Set([setup, a1, b1]).size).toBe(3);
  // The token is all an observer gets: no counter to change.
  for (const scope of [setup, a1, b1]) {
    expect(Object.isFrozen(scope)).toBe(true);
    expect(Reflect.ownKeys(scope ?? {})).toEqual([]);
    expect(Object.getPrototypeOf(scope)).toBe(Object.prototype);
  }
});

test("observers see transaction tokens and request-scope route metadata", async () => {
  const managed = createDefaultManagedApiDatabase({ API_DATABASE: "memory" });
  const observed: ObservedDatabaseStatement[] = [];
  const scopes: ObservedDatabaseRequestScope[] = [];
  const stopStmts = statementObserver.observeDatabaseStatements((statement) => {
    observed.push(statement);
  });
  const stopScopes = statementObserver.observeDatabaseRequestScopes((meta) => {
    scopes.push(meta);
  });
  const counter = { statements: 0, txStatements: 0 };
  try {
    await withRequestStatementCounter(counter, async () => {
      await managed.db.execute(sql`select 1`);
      await managed.db.transaction(async (tx) => {
        await tx.execute(sql`select 2`);
        await tx.execute(sql`select 3`);
      });
      recordRequestScopeMetadata(() => ({
        method: "POST",
        route: "/documents/{documentId}/sync",
        status: 200,
      }));
    });
  } finally {
    stopStmts();
    stopScopes();
    await managed.close();
  }
  expect(counter).toEqual({ statements: 3, txStatements: 2 });
  expect(observed[0]?.transaction).toBeUndefined();
  expect(observed[1]?.transaction).toBeObject();
  expect(observed[2]?.transaction).toBe(observed[1]?.transaction);
  expect(Object.isFrozen(observed[1]?.transaction)).toBe(true);
  expect(scopes).toHaveLength(1);
  const requestScope = observed[0]?.scope;
  if (!requestScope) throw new Error("expected request scope");
  expect(scopes[0]).toEqual({
    scope: requestScope,
    method: "POST",
    route: "/documents/{documentId}/sync",
    status: 200,
  });
});

test("the public entry only registers observers", () => {
  expect(Object.keys(statementObserver).sort()).toEqual([
    "observeDatabaseRequestScopes",
    "observeDatabaseStatements",
  ]);
});
