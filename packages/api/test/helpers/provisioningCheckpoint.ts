import { expect } from "bun:test";
import { parseWalLsn } from "@tearleads/validators/util";

function commitLsnOf(value: unknown): string {
  const commitLsn =
    typeof value === "object" && value !== null
      ? Reflect.get(value, "commitLsn")
      : undefined;
  if (typeof commitLsn !== "string") {
    throw new Error("Expected a provisioning commit position");
  }
  return commitLsn;
}

/** The provisioning result a replay repeats: everything but its position. */
export function withoutCommitCheckpoint(
  value: unknown,
): Record<string, unknown> {
  if (typeof value !== "object" || value === null) {
    throw new Error("Expected a provisioning response");
  }
  const result: Record<string, unknown> = { ...value };
  Reflect.deleteProperty(result, "commitLsn");
  Reflect.deleteProperty(result, "commitLsnMode");
  return result;
}

/**
 * A replay returns the same result with a commit position read after its own
 * transaction, which still covers the original commit.
 */
export function expectProvisioningReplay(
  replay: unknown,
  original: unknown,
): void {
  expect(withoutCommitCheckpoint(replay)).toEqual(
    withoutCommitCheckpoint(original),
  );
  expect(Reflect.get(Object(replay), "commitLsnMode")).toBe(
    Reflect.get(Object(original), "commitLsnMode"),
  );
  expect(
    parseWalLsn(commitLsnOf(replay)) >= parseWalLsn(commitLsnOf(original)),
  ).toBe(true);
}
