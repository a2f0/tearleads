import { expect, test } from "bun:test";
import type { ExecSql } from "../../data/sqlite/sqlSchema";
import { runSerializedDocumentBlobMutation } from "./blobMutationLock";

test("blob mutations serialize per key without blocking other keys", async () => {
  const execSql = (async () => []) as ExecSql;
  let releaseFirst: () => void = () => undefined;
  const firstBlocked = new Promise<void>((resolve) => {
    releaseFirst = resolve;
  });
  let markFirstStarted: () => void = () => undefined;
  const firstStarted = new Promise<void>((resolve) => {
    markFirstStarted = resolve;
  });
  let sameKeyStarted = false;
  let otherKeyStarted = false;

  const first = runSerializedDocumentBlobMutation(
    execSql,
    "shared-key",
    async () => {
      markFirstStarted();
      await firstBlocked;
    },
  );
  await firstStarted;
  const sameKey = runSerializedDocumentBlobMutation(
    execSql,
    "shared-key",
    () => {
      sameKeyStarted = true;
    },
  );
  const otherKey = runSerializedDocumentBlobMutation(
    execSql,
    "other-key",
    () => {
      otherKeyStarted = true;
    },
  );
  await otherKey;

  const sameKeyWasBlocked = !sameKeyStarted;
  releaseFirst();
  await Promise.all([first, sameKey]);
  expect(otherKeyStarted).toBe(true);
  expect(sameKeyWasBlocked).toBe(true);
  expect(sameKeyStarted).toBe(true);
});
