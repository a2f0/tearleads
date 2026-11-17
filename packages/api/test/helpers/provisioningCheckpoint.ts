import { expect } from "bun:test";
import { isWalLsnString } from "@tearleads/validators/util";

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

function commitLsnOf(value: unknown): unknown {
  return Reflect.get(Object(value), "commitLsn");
}

/**
 * A replay returns the committed result and names no position: its artifacts
 * can be older than the organization now, so the client reads them once.
 */
export function expectProvisioningReplay(
  replay: unknown,
  original: unknown,
): void {
  expect(withoutCommitCheckpoint(replay)).toEqual(
    withoutCommitCheckpoint(original),
  );
  expect(commitLsnOf(replay)).toBeNull();
  expect(Reflect.get(Object(replay), "commitLsnMode")).toBe("tracked");
}

/**
 * Concurrent identical creates return one result; only the request that
 * committed it, in whichever order they finished, names a position.
 */
export function expectConcurrentProvisioning(responses: unknown[]): void {
  const [first, ...rest] = responses;
  for (const response of rest) {
    expect(withoutCommitCheckpoint(response)).toEqual(
      withoutCommitCheckpoint(first),
    );
  }
  expect(
    responses.filter((response) => isWalLsnString(commitLsnOf(response))),
  ).toHaveLength(1);
  expect(
    responses.filter((response) => commitLsnOf(response) === null),
  ).toHaveLength(responses.length - 1);
}
