import { describe, expect, test } from "bun:test";
import {
  assertLocalSchemaMigrations,
  type LocalSchemaMigration,
} from "./localSchemaMigrations";
import {
  classifyLocalSchema,
  localSchemaStateError,
  parseLocalSchemaLedger,
} from "./localSchemaState";

function step(version: number, name: string): LocalSchemaMigration {
  return { name, up: async () => {}, version };
}

const migrations = [step(2, "add_title"), step(3, "backfill_title")];
const baseline = { name: "baseline", version: 1 };

describe("classifyLocalSchema", () => {
  test("a database without user tables records every step without running one", () => {
    expect(
      classifyLocalSchema({ hasUserTables: false, ledger: [], migrations }),
    ).toEqual({
      record: [
        baseline,
        { name: "add_title", version: 2 },
        { name: "backfill_title", version: 3 },
      ],
      status: "fresh",
    });
  });

  test("user tables without a ledger are the baseline and run every step", () => {
    expect(
      classifyLocalSchema({ hasUserTables: true, ledger: [], migrations }),
    ).toEqual({ pending: migrations, record: [baseline], status: "legacy" });
  });

  test("a ledger behind this build runs only the steps after it", () => {
    const state = classifyLocalSchema({
      hasUserTables: true,
      ledger: [baseline, { name: "add_title", version: 2 }],
      migrations,
    });
    expect(state).toEqual({
      pending: migrations.slice(1),
      status: "behind",
      version: 2,
    });
    expect(localSchemaStateError(state)).toBeNull();
  });

  test("a ledger at the newest step is current", () => {
    expect(
      classifyLocalSchema({
        hasUserTables: true,
        ledger: [baseline],
        migrations: [],
      }),
    ).toEqual({ status: "current", version: 1 });
  });

  test("a ledger past the newest step is refused", () => {
    const state = classifyLocalSchema({
      hasUserTables: true,
      ledger: [baseline, { name: "add_title", version: 2 }],
      migrations: [],
    });
    expect(state).toEqual({ status: "ahead", supported: 1, version: 2 });
    expect(localSchemaStateError(state)?.message).toBe(
      "Local database schema version 2 is newer than this app supports (1); update the app before opening it",
    );
  });

  test("a ledger with another build's step names or a gap is refused", () => {
    for (const ledger of [
      [baseline, { name: "other_change", version: 2 }],
      [{ name: "add_title", version: 2 }],
      [baseline, { name: "backfill_title", version: 3 }],
      null,
    ]) {
      const state = classifyLocalSchema({
        hasUserTables: true,
        ledger,
        migrations,
      });
      expect(state.status).toBe("diverged");
      expect(localSchemaStateError(state)?.message).toStartWith(
        "Local database schema history does not match this app:",
      );
    }
  });
});

test("parseLocalSchemaLedger orders rows and rejects malformed ones", () => {
  expect(
    parseLocalSchemaLedger([
      { name: "add_title", version: 2 },
      { name: "baseline", version: 1 },
    ]),
  ).toEqual([baseline, { name: "add_title", version: 2 }]);
  expect(
    parseLocalSchemaLedger([{ name: "baseline", version: "1" }]),
  ).toBeNull();
  expect(parseLocalSchemaLedger([{ name: null, version: 1 }])).toBeNull();
});

test("assertLocalSchemaMigrations requires consecutive versions from 2 and snake_case names", () => {
  expect(() => assertLocalSchemaMigrations(migrations)).not.toThrow();
  expect(() => assertLocalSchemaMigrations([step(3, "skip")])).toThrow(
    "Local schema migration skip has version 3; expected 2",
  );
  expect(() => assertLocalSchemaMigrations([step(2, "Add-Title")])).toThrow(
    "Local schema migration 2 needs a snake_case name",
  );
});
