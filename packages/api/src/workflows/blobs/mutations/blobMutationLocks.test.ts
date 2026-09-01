import { expect, test } from "bun:test";
import { db, getDefaultApiDatabaseKind } from "@tearleads/api-shared/postgres";
import { blobs } from "@tearleads/api-shared/schema";
import {
  lockBlobMutationRows,
  planBlobMutationLockIds,
} from "./blobMutationLocks";

test("blob mutation lock planning is unique and deterministic", () => {
  expect(
    planBlobMutationLockIds([
      "00000000-0000-4000-8000-000000000003",
      "00000000-0000-4000-8000-000000000001",
      "00000000-0000-4000-8000-000000000002",
      "00000000-0000-4000-8000-000000000001",
    ]),
  ).toEqual([
    "00000000-0000-4000-8000-000000000001",
    "00000000-0000-4000-8000-000000000002",
    "00000000-0000-4000-8000-000000000003",
  ]);
});

test("an empty blob mutation lock plan is a no-op", async () => {
  let queried = false;
  await lockBlobMutationRows({
    blobIds: [],
    executor: new Proxy(
      {},
      {
        get() {
          queried = true;
          throw new Error("unexpected query");
        },
      },
    ) as never,
  });
  expect(queried).toBe(false);
});

test.skipIf(getDefaultApiDatabaseKind() !== "postgres")(
  "opposite blob mutation plans serialize without deadlocking",
  async () => {
    const firstBlobId = crypto.randomUUID();
    const secondBlobId = crypto.randomUUID();
    await db.insert(blobs).values(
      [firstBlobId, secondBlobId].map((id) => ({
        byteLength: 1,
        id,
        sha256: `sha256:${id}`,
        storageKey: `blob-object:${id}`,
      })),
    );

    let markHeld!: () => void;
    const held = new Promise<void>((resolve) => {
      markHeld = resolve;
    });
    let releaseHold!: () => void;
    const hold = new Promise<void>((resolve) => {
      releaseHold = resolve;
    });
    const holder = db.transaction(async (tx) => {
      await lockBlobMutationRows({
        blobIds: [firstBlobId, secondBlobId],
        executor: tx,
      });
      markHeld();
      await hold;
    });

    await held;
    let contenderSettled = false;
    const contender = db
      .transaction((tx) =>
        lockBlobMutationRows({
          blobIds: [secondBlobId, firstBlobId],
          executor: tx,
        }),
      )
      .then(() => {
        contenderSettled = true;
      });
    await new Promise((resolve) => setTimeout(resolve, 300));
    const settledWhileHeld = contenderSettled;
    releaseHold();
    await Promise.all([holder, contender]);

    expect(settledWhileHeld).toBe(false);
    expect(contenderSettled).toBe(true);
  },
  30_000,
);
