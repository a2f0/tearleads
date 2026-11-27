import { expect, test } from "bun:test";
import { DATABASE_TRANSACTION_BUSY_MESSAGE } from "@tearleads/sqlite-worker/types";
import { DATABASE_BUSY_RUN_LIMIT } from "../../../../data/sqlite/availability/databaseBusyRetry";
import type { DocumentRecord } from "../../../../workflows/documents";
import type { DocumentStoreState } from "../state";
import { captureDocumentStoreSyncGeneration } from "./syncGeneration";
import { remoteCreateGate } from "./syncSeededCreate";
import { isContainerAwaitingRemoteCreate } from "./syncShared";

function storeInContainer(refusals: number): {
  readonly reads: () => number;
  readonly state: DocumentStoreState;
} {
  let reads = 0;
  const state = {
    doc: null,
    runtime: {
      infra: {
        execSql: async () => {
          reads += 1;
          if (reads <= refusals) {
            throw new Error(DATABASE_TRANSACTION_BUSY_MESSAGE);
          }
          return [{ server_created_at: null }];
        },
      },
      state: { containerId: "container-awaiting-create" },
    },
  } as unknown as DocumentStoreState;
  return { reads: () => reads, state };
}

// #3360: a refusal behind another tab's transaction used to read as "the
// container exists remotely", so the create went ahead and met a 404.
test("a busy container read is retried before the create gate decides", async () => {
  const store = storeInContainer(2);

  await expect(isContainerAwaitingRemoteCreate(store.state)).resolves.toBe(
    true,
  );
  expect(store.reads()).toBe(3);
});

test("a busy container read stops retrying once its sync pass is stale", async () => {
  const store = storeInContainer(Number.POSITIVE_INFINITY);

  await expect(
    isContainerAwaitingRemoteCreate(store.state, () => store.reads() < 2),
  ).rejects.toThrow(DATABASE_TRANSACTION_BUSY_MESSAGE);
  expect(store.reads()).toBe(2);
});

test("a container read that stays busy asks for another pass instead of creating", async () => {
  const store = storeInContainer(Number.POSITIVE_INFINITY);

  const generation = captureDocumentStoreSyncGeneration(store.state, null);
  if (!generation) throw new Error("Expected a current sync generation");

  await expect(
    remoteCreateGate(
      store.state,
      { documentId: null } as unknown as DocumentRecord,
      generation,
    ),
  ).resolves.toBe("busy");
  expect(store.reads()).toBe(DATABASE_BUSY_RUN_LIMIT);
});
