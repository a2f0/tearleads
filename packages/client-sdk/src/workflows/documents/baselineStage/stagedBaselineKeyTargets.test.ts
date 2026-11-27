// A rotation exists to keep a key from someone. A staged upload holds its
// key between attempts, so it also holds where the key has gone: a later
// attempt takes the key only if it leaves none of those places out.
import { expect, test } from "bun:test";
import type { ExecSql } from "../../../data/sqlite/sqlSchema";
import { reusableStagedBaselinePlan } from "./rotationBaselineWriter";
import {
  getOrCreateStagedBaselineUploads,
  type RotationKeyTarget,
} from "./stagedBaselineUploads";

const documentId = "0b6d7e0e-3c5a-4d0f-9a51-7b1f5c2a9e10";
const PLAN = {
  contentKey: new Uint8Array(32).fill(7),
  contentKeyCommitment: "a".repeat(64),
  contentKeyEpoch: 2,
  linkSetEvent: undefined,
  signedAt: "2026-07-26T00:00:00.000Z",
};

const target = (container: string, epoch = 1): RotationKeyTarget => ({
  containerId: `container-${container}`,
  containerKeyEpochId: `container-${container}-epoch-${epoch}`,
});
const [X, Y, Z] = [target("x"), target("y"), target("z")];

function database() {
  const execSql: ExecSql = async () => [];
  return { execSql, uploads: getOrCreateStagedBaselineUploads(execSql) };
}

test("a key goes on only to an attempt that leaves out no target it went to", () => {
  const { uploads } = database();
  const upload = uploads.begin(documentId, PLAN, [X, Y]);

  expect(upload.keyMayBeWrappedFor([X, Y])).toBe(true);
  expect(upload.keyMayBeWrappedFor([Y, X, Z])).toBe(true);
  // An unlink of either container leaves it out.
  expect(upload.keyMayBeWrappedFor([X])).toBe(false);
  expect(upload.keyMayBeWrappedFor([Y])).toBe(false);
  expect(upload.keyMayBeWrappedFor([])).toBe(false);
  // A container's next key epoch is another target: the members its
  // rotation dropped still hold the epoch the key was wrapped for.
  expect(upload.keyMayBeWrappedFor([X, target("y", 2)])).toBe(false);
});

test("where a key has gone only grows, whatever became of the request", () => {
  const { uploads } = database();
  const upload = uploads.begin(documentId, PLAN, [X]);
  expect(upload.keyMayBeWrappedFor([X])).toBe(true);

  // A wider attempt (a heal, after an unlink of Y was refused) wraps it
  // for Y as well. No attempt tag guards this: a superseded run's request
  // gave the key away as surely.
  upload.dispatch({ type: "runStarted" });
  upload.dispatch({ type: "runStarted" });
  upload.wrapKeyFor([X, Y]);

  expect(upload.keyMayBeWrappedFor([X])).toBe(false);
  expect(upload.keyMayBeWrappedFor([X, Y])).toBe(true);
});

test("a held plan is handed to an attempt only under that rule", () => {
  const { execSql, uploads } = database();
  const upload = uploads.begin(documentId, PLAN, [X, Y]);
  const { attempt } = upload.dispatch({ type: "runStarted" });
  const held = (epoch: number, targets: readonly RotationKeyTarget[]) =>
    reusableStagedBaselinePlan(execSql, documentId, epoch, targets);

  // Another epoch, another document, another database: no plan.
  expect(held(3, [X, Y])).toBeNull();
  expect(reusableStagedBaselinePlan(execSql, "other", 2, [X, Y])).toBeNull();
  expect(
    reusableStagedBaselinePlan(database().execSql, documentId, 2, [X, Y]),
  ).toBeNull();

  // The same targets: the same key.
  expect(held(2, [X, Y])?.contentKey).toBe(PLAN.contentKey);
  // Fewer: a new key, and the refusal records nothing.
  expect(held(2, [X])).toBeNull();
  expect(held(2, [X, Y])).toBe(PLAN);
  // More: the same key, which has then gone to Z as well.
  expect(held(2, [X, Y, Z])).toBe(PLAN);
  expect(held(2, [X, Y])).toBeNull();

  // An upload that is over holds no plan for anyone.
  upload.dispatch({ attempt, baselineId: "b", type: "planned" });
  upload.dispatch({ attempt, type: "released" });
  expect(held(2, [X, Y, Z])).toBeNull();
});
