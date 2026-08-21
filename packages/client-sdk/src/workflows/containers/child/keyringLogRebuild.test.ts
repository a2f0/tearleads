import { expect, test } from "bun:test";
import { createContainerKekPredecessorBridge } from "@symcrypt/crypto";
import {
  CONTAINER_KEK_LOG_PAGE_LIMIT,
  MAX_CONTAINER_KEY_EPOCH,
} from "@symcrypt/validators/util";
import {
  makeEpochBridge,
  makeEpochKeys,
  makeLogEpoch,
} from "../../../../test/helpers/keyringRotationFixtures";
import {
  fetchContainerKekLog,
  rebuildKeyringEntriesFromLog,
} from "../../../data/documents/shared/keyringRebuild";

test("a severed middle bridge rebuilds both segments around the gap", async () => {
  const containerId = crypto.randomUUID();
  // Four epochs; the bridge from 3 -> 2 is destroyed. The walk must still
  // recover epoch 3 from the intact top bridge, and epochs 1-2 once the
  // caller supplies a wrap-recovered anchor for epoch 2.
  const keys = await makeEpochKeys(containerId, 4);
  const [epoch1, epoch2, epoch3, epoch4] = keys;
  if (!epoch1 || !epoch2 || !epoch3 || !epoch4) {
    throw new Error("expected fixture epochs");
  }

  const log = {
    containerId,
    hasMore: false,
    epochs: await Promise.all(
      keys.map(async (key, index) =>
        makeLogEpoch(key, {
          // Epoch 3's bridge (index 2) is severed.
          bridge:
            index === 0 || index === 2
              ? null
              : await makeEpochBridge(containerId, keys, index),
        }),
      ),
    ),
  };

  const withoutAnchor = await rebuildKeyringEntriesFromLog({
    containerId,
    currentContainerKey: epoch4.keyMaterial,
    currentContainerKeyEpochId: epoch4.containerKeyEpochId,
    log,
  });
  // The top segment survives; the gap and everything below it is reported.
  expect(withoutAnchor.entries.map((e) => e.containerKeyEpochId)).toEqual([
    epoch3.containerKeyEpochId,
  ]);
  expect(withoutAnchor.missingEpochIds).toEqual([
    epoch1.containerKeyEpochId,
    epoch2.containerKeyEpochId,
  ]);

  // Supplying the wrap-recovered epoch-2 key re-anchors the lower segment.
  const withAnchor = await rebuildKeyringEntriesFromLog({
    anchorKeysByEpochId: new Map([
      [epoch2.containerKeyEpochId, epoch2.keyMaterial],
    ]),
    containerId,
    currentContainerKey: epoch4.keyMaterial,
    currentContainerKeyEpochId: epoch4.containerKeyEpochId,
    log,
  });
  expect(withAnchor.entries.map((e) => e.containerKeyEpochId)).toEqual([
    epoch1.containerKeyEpochId,
    epoch2.containerKeyEpochId,
    epoch3.containerKeyEpochId,
  ]);
  expect(withAnchor.missingEpochIds).toEqual([]);
});

test("a poisoned bridge is treated as severance, not a fatal error", async () => {
  const containerId = crypto.randomUUID();
  const [epoch1, epoch2] = await makeEpochKeys(containerId, 2);
  if (!epoch1 || !epoch2) {
    throw new Error("expected fixture epochs");
  }

  // A structurally present but undecryptable bridge: the poisoned-link case
  // the wrap anchors exist for. It must degrade to a reported gap, not an
  // exception that discards the anchor path.
  const poisonedLog = {
    containerId,
    hasMore: false,
    epochs: [
      makeLogEpoch(epoch1),
      makeLogEpoch(epoch2, {
        bridge: { version: 1, wrappingSuite: "nonsense" },
      }),
    ],
  };

  const withoutAnchor = await rebuildKeyringEntriesFromLog({
    containerId,
    currentContainerKey: epoch2.keyMaterial,
    currentContainerKeyEpochId: epoch2.containerKeyEpochId,
    log: poisonedLog,
  });
  expect(withoutAnchor.entries).toEqual([]);
  expect(withoutAnchor.missingEpochIds).toEqual([epoch1.containerKeyEpochId]);

  // The anchor recovers what the poisoned bridge could not.
  const withAnchor = await rebuildKeyringEntriesFromLog({
    anchorKeysByEpochId: new Map([
      [epoch1.containerKeyEpochId, epoch1.keyMaterial],
    ]),
    containerId,
    currentContainerKey: epoch2.keyMaterial,
    currentContainerKeyEpochId: epoch2.containerKeyEpochId,
    log: poisonedLog,
  });
  expect(withAnchor.entries.map((e) => e.containerKeyEpochId)).toEqual([
    epoch1.containerKeyEpochId,
  ]);
  expect(withAnchor.missingEpochIds).toEqual([]);
});

test("a lying bridge does not mask a supplied anchor", async () => {
  const containerId = crypto.randomUUID();
  const [epoch1, epoch2] = await makeEpochKeys(containerId, 2);
  if (!epoch1 || !epoch2) {
    throw new Error("expected fixture epochs");
  }

  // An AEAD-VALID bridge that decrypts to the wrong material: it opens
  // cleanly but yields a key that is not the committed epoch's. The anchor
  // must still win, so the check has to run before the fallback.
  const lyingKey = crypto.getRandomValues(new Uint8Array(32));
  const lyingBridge = await createContainerKekPredecessorBridge({
    containerId,
    predecessorContainerKey: lyingKey,
    predecessorContainerKeyEpochId: epoch1.containerKeyEpochId,
    successorContainerKey: epoch2.keyMaterial,
    successorContainerKeyEpochId: epoch2.containerKeyEpochId,
  });
  const log = {
    containerId,
    hasMore: false,
    epochs: [
      makeLogEpoch(epoch1),
      makeLogEpoch(epoch2, {
        bridge: lyingBridge as unknown as Record<string, unknown>,
      }),
    ],
  };

  const withoutAnchor = await rebuildKeyringEntriesFromLog({
    containerId,
    currentContainerKey: epoch2.keyMaterial,
    currentContainerKeyEpochId: epoch2.containerKeyEpochId,
    log,
  });
  expect(withoutAnchor.entries).toEqual([]);
  expect(withoutAnchor.missingEpochIds).toEqual([epoch1.containerKeyEpochId]);

  const withAnchor = await rebuildKeyringEntriesFromLog({
    anchorKeysByEpochId: new Map([
      [epoch1.containerKeyEpochId, epoch1.keyMaterial],
    ]),
    containerId,
    currentContainerKey: epoch2.keyMaterial,
    currentContainerKeyEpochId: epoch2.containerKeyEpochId,
    log,
  });
  expect(withAnchor.entries.map((e) => e.containerKeyEpochId)).toEqual([
    epoch1.containerKeyEpochId,
  ]);
  expect(withAnchor.entries[0]?.keyMaterial).toEqual(epoch1.keyMaterial);
  expect(withAnchor.missingEpochIds).toEqual([]);
});

test("log paging rejects a short page claiming more", async () => {
  const containerId = crypto.randomUUID();
  let pages = 0;

  // One epoch per page with hasMore set would stretch the walk over 65,536
  // round trips. Only a FINAL page may be short.
  await expect(
    fetchContainerKekLog({
      apiClient: {
        getContainerKekLog: async (_id, options) => {
          pages += 1;
          const start = (options?.afterKeyEpoch ?? 0) + 1;
          return {
            containerId,
            hasMore: true,
            epochs: [
              {
                accessManifestHash: "manifest",
                bridge: null,
                containerKeyEpoch: start,
                containerKeyEpochId: `symcrypt.container-kek.v1.sha256:${"0".repeat(64)}`,
                keyring: null,
                parentContainerKeyEpochId: null,
                wraps: [],
              },
            ],
          };
        },
      },
      containerId,
    }),
  ).rejects.toThrow("short but claims more");
  // Rejected on the first page, not after thousands of round trips.
  expect(pages).toBe(1);
});

test("log paging stops at the protocol epoch ceiling", async () => {
  const containerId = crypto.randomUUID();
  let pages = 0;

  // A hostile server that claims more forever with advancing epochs.
  await expect(
    fetchContainerKekLog({
      apiClient: {
        getContainerKekLog: async (_id, options) => {
          pages += 1;
          const start = options?.afterKeyEpoch ?? 0;
          return {
            containerId,
            hasMore: true,
            epochs: Array.from(
              { length: CONTAINER_KEK_LOG_PAGE_LIMIT },
              (_value, index) => ({
                accessManifestHash: "manifest",
                bridge: null,
                containerKeyEpoch: start + index + 1,
                containerKeyEpochId: `symcrypt.container-kek.v1.sha256:${"0".repeat(64)}`,
                keyring: null,
                parentContainerKeyEpochId: null,
                wraps: [],
              }),
            ),
          };
        },
      },
      containerId,
    }),
  ).rejects.toThrow("maximum key epoch");
  // Bounded by the page budget, not by the epoch count.
  expect(pages).toBeLessThanOrEqual(
    Math.ceil(MAX_CONTAINER_KEY_EPOCH / CONTAINER_KEK_LOG_PAGE_LIMIT) + 1,
  );
});

test("log paging rejects a page for another container", async () => {
  const containerId = crypto.randomUUID();

  // The aggregate is handed to a rebuild that trusts its shape, so a page
  // belonging to a different container must be refused before it can splice
  // foreign history into the walk.
  await expect(
    fetchContainerKekLog({
      apiClient: {
        getContainerKekLog: async () => ({
          containerId: crypto.randomUUID(),
          hasMore: false,
          epochs: [
            {
              accessManifestHash: "manifest",
              bridge: null,
              containerKeyEpoch: 1,
              containerKeyEpochId: `symcrypt.container-kek.v1.sha256:${"0".repeat(64)}`,
              keyring: null,
              parentContainerKeyEpochId: null,
              wraps: [],
            },
          ],
        }),
      },
      containerId,
    }),
  ).rejects.toThrow("wrong container");
});

test("log paging rejects a page replaying epochs at or below the cursor", async () => {
  const containerId = crypto.randomUUID();

  // A stale or duplicated page would re-add epochs the walk already consumed,
  // producing a non-contiguous aggregate that reads as corrupt history.
  await expect(
    fetchContainerKekLog({
      apiClient: {
        getContainerKekLog: async () => ({
          containerId,
          hasMore: false,
          epochs: [
            {
              accessManifestHash: "manifest",
              bridge: null,
              containerKeyEpoch: 2,
              containerKeyEpochId: `symcrypt.container-kek.v1.sha256:${"1".repeat(64)}`,
              keyring: null,
              parentContainerKeyEpochId: null,
              wraps: [],
            },
            {
              accessManifestHash: "manifest",
              bridge: null,
              containerKeyEpoch: 2,
              containerKeyEpochId: `symcrypt.container-kek.v1.sha256:${"2".repeat(64)}`,
              keyring: null,
              parentContainerKeyEpochId: null,
              wraps: [],
            },
          ],
        }),
      },
      containerId,
    }),
  ).rejects.toThrow("out of order");
});
