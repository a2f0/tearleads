import { expect, test } from "bun:test";
import { DATABASE_TRANSACTION_BUSY_MESSAGE } from "@tearleads/sqlite-worker/types";
import type { DocumentRecord } from "../../../../workflows/documents";
import type { DocumentStoreState } from "../state";
import type { DocumentStoreSyncGeneration } from "./syncGeneration";
import { remoteCreateGate } from "./syncSeededCreate";
import { isContainerAwaitingRemoteCreate } from "./syncShared";

function storeInContainer(refusals: number): {
  readonly reads: () => number;
  readonly state: DocumentStoreState;
} {
  let reads = 0;
  const state = {
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

test("a container read that stays busy asks for another pass instead of creating", async () => {
  const store = storeInContainer(Number.POSITIVE_INFINITY);

  await expect(
    remoteCreateGate(
      store.state,
      { documentId: null } as unknown as DocumentRecord,
      {} as DocumentStoreSyncGeneration,
    ),
  ).resolves.toBe("busy");
});
