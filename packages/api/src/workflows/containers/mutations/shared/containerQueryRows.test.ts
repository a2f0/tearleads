import { describe, expect, test } from "bun:test";
import type { DatabaseTransaction } from "@tearleads/api-shared/postgres";
import { assertCarriedRekeysBelowRotations } from "./carriedRekeyAncestry";
import { assertContainerMoveDepth } from "./containerDepth";

/** An executor whose every raw query answers `rows`. */
function rowsExecutor(rows: readonly unknown[]): DatabaseTransaction {
  const executor = { execute: async () => ({ rows }) };
  return executor as unknown as DatabaseTransaction;
}

async function rejection(run: () => Promise<unknown>): Promise<string> {
  try {
    await run();
  } catch (error) {
    if (error instanceof Error) return error.message;
    throw error;
  }
  throw new Error("expected a rejection");
}

describe("raw container query rows", () => {
  test("a subtree height must be a non-negative safe integer", async () => {
    const assertDepth = (rows: unknown[]) =>
      assertContainerMoveDepth(rowsExecutor(rows), "container-id", 1);
    await assertDepth([{ height: 0 }]);
    for (const rows of [
      [],
      [{ height: -1 }],
      [{ height: 1.5 }],
      [{ height: "2" }],
      [{ height: null }],
    ]) {
      expect(await rejection(() => assertDepth(rows))).toBe(
        "Container subtree depth is unavailable",
      );
    }
  });

  test("carried rekey ancestry skips rows without a string start id", async () => {
    const assertBelow = (rows: unknown[]) =>
      assertCarriedRekeysBelowRotations({
        carriedContainerIds: ["carried-id"],
        executor: rowsExecutor(rows),
        rotatedContainerIds: ["rotated-id"],
      });
    await assertBelow([{ start_id: "carried-id" }]);
    expect(
      await rejection(() =>
        assertBelow([{ start_id: 1 }, { other: "carried-id" }]),
      ),
    ).toBe("Carried container rekey is not below the rotated container");
  });
});
