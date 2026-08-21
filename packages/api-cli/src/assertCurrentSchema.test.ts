import { expect, test } from "bun:test";
import type { DatabaseSession } from "@symcrypt/api-shared/postgres";
import { createDefaultManagedApiDatabase } from "@symcrypt/api-shared/postgres";
import {
  assertCurrentApiSchema,
  isMissingCurrentApiSchemaError,
} from "./assertCurrentSchema";

test("the migration guard rejects an old schema and accepts the current baseline", async () => {
  const managed = createDefaultManagedApiDatabase({ API_DATABASE: "memory" });
  try {
    await expect(assertCurrentApiSchema(managed.db)).rejects.toThrow(
      "destroy and reprovision the database",
    );
    await managed.migrate();
    await expect(assertCurrentApiSchema(managed.db)).resolves.toBeUndefined();
  } finally {
    await managed.close();
  }
}, 15_000);

test("the migration guard recognizes only missing baseline structures", () => {
  expect(isMissingCurrentApiSchemaError({ code: "42P01" })).toBe(true);
  expect(
    isMissingCurrentApiSchemaError({
      cause: { code: "42703" },
      message: "Failed query",
    }),
  ).toBe(true);
  expect(
    isMissingCurrentApiSchemaError(new Error("no such table: billing")),
  ).toBe(true);
  expect(isMissingCurrentApiSchemaError({ code: "08006" })).toBe(false);
  expect(isMissingCurrentApiSchemaError(new Error("connection reset"))).toBe(
    false,
  );
});

test("the migration guard preserves transient database failures", async () => {
  const transient = Object.assign(new Error("connection reset"), {
    code: "08006",
  });
  const executor = {
    select: () => {
      throw transient;
    },
  } as unknown as DatabaseSession;

  await expect(assertCurrentApiSchema(executor)).rejects.toBe(transient);
});
