import { expect, test } from "bun:test";
import { isSqliteApiDatabase, lockRowForUpdate } from "./sqlDialect";

test("locks rows only when the database supports FOR UPDATE", async () => {
  let lockStrength: string | undefined;
  const query = Object.assign(Promise.resolve(["unlocked"]), {
    for: (strength: "update") => {
      lockStrength = strength;
      return Promise.resolve(["locked"]);
    },
  });

  const result = await lockRowForUpdate(query);

  expect(result).toEqual([isSqliteApiDatabase() ? "unlocked" : "locked"]);
  expect(lockStrength).toBe(isSqliteApiDatabase() ? undefined : "update");
});
