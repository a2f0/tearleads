import { expect, test } from "bun:test";
import {
  type ClientSqlRecord,
  formatClientSqlMarkdown,
  normalizeClientSql,
  parseClientSqlCapture,
  summarizeClientSqlCapture,
} from "./clientSqlSummary";

test("normalizes SQLite placeholders and summarizes per-phase statements and mutation holds", () => {
  expect(normalizeClientSql("SELECT *  FROM docs WHERE id IN (?, ?, ?)")).toBe(
    "SELECT * FROM docs WHERE id IN (?, …)",
  );

  const records: ClientSqlRecord[] = [
    {
      kind: "stmt",
      label: "t",
      sql: "SELECT 1",
      bindCount: 0,
      durationMs: 0.4,
      rows: 1,
      inLock: false,
      failed: false,
    },
    { phaseStart: "sync" },
    {
      kind: "stmt",
      label: "t",
      sql: "SELECT * FROM documents WHERE id IN (?, ?)",
      bindCount: 2,
      durationMs: 1.5,
      rows: 2,
      inLock: true,
      failed: false,
    },
    {
      kind: "stmt",
      label: "t",
      sql: "SELECT * FROM documents WHERE id IN (?, ?, ?)",
      bindCount: 3,
      durationMs: 2.5,
      rows: 3,
      inLock: true,
      failed: false,
    },
    {
      kind: "mutation",
      label: "t",
      waitMs: 0.2,
      holdMs: 6.4,
      statements: 2,
      failed: false,
    },
    { phaseEnd: "sync", requests: 1 },
  ];

  const jsonl = `${records.map((entry) => JSON.stringify(entry)).join("\n")}\n`;
  const parsed = parseClientSqlCapture(jsonl);
  const summary = summarizeClientSqlCapture(parsed);

  expect(summary.statements).toBe(3);
  expect(summary.inLockStatements).toBe(2);
  expect(summary.mutations).toBe(1);
  expect(summary.maxMutationHoldMs).toBe(6.4);
  expect(summary.avgStatementsPerMutation).toBe(2);
  expect(summary.phases).toHaveLength(1);
  expect(summary.phases[0]).toMatchObject({
    label: "sync",
    statements: 2,
    inLockStatements: 2,
    mutations: 1,
    maxMutationHoldMs: 6.4,
  });
  expect(summary.phases[0]?.top[0]).toEqual({
    sql: "SELECT * FROM documents WHERE id IN (?, …)",
    count: 2,
    durationMs: 4,
  });

  const md = formatClientSqlMarkdown("Client SQLite", summary).join("\n");
  expect(md).toContain("## Client SQLite");
  expect(md).toContain("### Client SQLite by phase");
  expect(md).toContain("### Top client SQLite statements");
});
