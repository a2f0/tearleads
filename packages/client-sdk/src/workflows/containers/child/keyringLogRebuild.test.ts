import { expect, test } from "bun:test";
import {
  computeContainerKekMaterialId,
  createContainerKekPredecessorBridge,
} from "@tearleads/crypto";
import {
  CONTAINER_KEK_LOG_PAGE_LIMIT,
  MAX_CONTAINER_KEY_EPOCH,
} from "@tearleads/validators/util";
import {
  fetchContainerKekLog,
  rebuildKeyringEntriesFromLog,
} from "../../../data/documents/shared/keyringRebuild";

test("a severed middle bridge rebuilds both segments around the gap", async () => {
  const containerId = crypto.randomUUID();
  // Four epochs; the bridge from 3 -> 2 is destroyed. The walk must still
  // recover epoch 3 from the intact top bridge, and epochs 1-2 once the
  // caller supplies a wrap-recovered anchor for epoch 2.
  const keys = await Promise.all(
    [1, 2, 3, 4].map(async (keyEpoch) => {
      const keyMaterial = crypto.getRandomValues(new Uint8Array(32));
      return {
        containerKeyEpochId: await computeContainerKekMaterialId({
          containerId,
          keyEpoch,
          keyMaterial,
        }),
        keyEpoch,
        keyMaterial,
      };
    }),
  );
  const bridgeFor = async (successorIndex: number) =>
    createContainerKekPredecessorBridge({
      containerId,
      predecessorContainerKey: keys[successorIndex - 1]
        ?.keyMaterial as Uint8Array,
      predecessorContainerKeyEpochId: keys[successorIndex - 1]
        ?.containerKeyEpochId as string,
      successorContainerKey: keys[successorIndex]?.keyMaterial as Uint8Array,
      successorContainerKeyEpochId: keys[successorIndex]
        ?.containerKeyEpochId as string,
    });

  const log = {
    containerId,
    hasMore: false,
    epochs: await Promise.all(
      keys.map(async (key, index) => ({
        accessManifestHash: `manifest-${key.keyEpoch}`,
        // Epoch 3's bridge (index 2) is severed.
        bridge:
          index === 0 || index === 2
            ? null
            : ((await bridgeFor(index)) as unknown as Record<string, unknown>),
        containerKeyEpoch: key.keyEpoch,
        containerKeyEpochId: key.containerKeyEpochId,
        keyring: null,
        parentContainerKeyEpochId: null,
        wraps: [],
      })),
    ),
  };

  const withoutAnchor = await rebuildKeyringEntriesFromLog({
    containerId,
    currentContainerKey: keys[3]?.keyMaterial as Uint8Array,
    currentContainerKeyEpochId: keys[3]?.containerKeyEpochId as string,
    log,
  });
  // The top segment survives; the gap and everything below it is reported.
  expect(withoutAnchor.entries.map((e) => e.containerKeyEpochId)).toEqual([
    keys[2]?.containerKeyEpochId as string,
  ]);
  expect(withoutAnchor.missingEpochIds).toEqual([
    keys[0]?.containerKeyEpochId as string,
    keys[1]?.containerKeyEpochId as string,
  ]);

  // Supplying the wrap-recovered epoch-2 key re-anchors the lower segment.
  const withAnchor = await rebuildKeyringEntriesFromLog({
    anchorKeysByEpochId: new Map([
      [
        keys[1]?.containerKeyEpochId as string,
        keys[1]?.keyMaterial as Uint8Array,
      ],
    ]),
    containerId,
    currentContainerKey: keys[3]?.keyMaterial as Uint8Array,
    currentContainerKeyEpochId: keys[3]?.containerKeyEpochId as string,
    log,
  });
  expect(withAnchor.entries.map((e) => e.containerKeyEpochId)).toEqual([
    keys[0]?.containerKeyEpochId as string,
    keys[1]?.containerKeyEpochId as string,
    keys[2]?.containerKeyEpochId as string,
  ]);
  expect(withAnchor.missingEpochIds).toEqual([]);
});

test("a poisoned bridge is treated as severance, not a fatal error", async () => {
  const containerId = crypto.randomUUID();
  const keys = await Promise.all(
    [1, 2].map(async (keyEpoch) => {
      const keyMaterial = crypto.getRandomValues(new Uint8Array(32));
      return {
        containerKeyEpochId: await computeContainerKekMaterialId({
          containerId,
          keyEpoch,
          keyMaterial,
        }),
        keyEpoch,
        keyMaterial,
      };
    }),
  );

  // A structurally present but undecryptable bridge: the poisoned-link case
  // the wrap anchors exist for. It must degrade to a reported gap, not an
  // exception that discards the anchor path.
  const poisonedLog = {
    containerId,
    hasMore: false,
    epochs: [
      {
        accessManifestHash: "manifest-1",
        bridge: null,
        containerKeyEpoch: 1,
        containerKeyEpochId: keys[0]?.containerKeyEpochId as string,
        keyring: null,
        parentContainerKeyEpochId: null,
        wraps: [],
      },
      {
        accessManifestHash: "manifest-2",
        bridge: { version: 1, wrappingSuite: "nonsense" } as Record<
          string,
          unknown
        >,
        containerKeyEpoch: 2,
        containerKeyEpochId: keys[1]?.containerKeyEpochId as string,
        keyring: null,
        parentContainerKeyEpochId: null,
        wraps: [],
      },
    ],
  };

  const withoutAnchor = await rebuildKeyringEntriesFromLog({
    containerId,
    currentContainerKey: keys[1]?.keyMaterial as Uint8Array,
    currentContainerKeyEpochId: keys[1]?.containerKeyEpochId as string,
    log: poisonedLog,
  });
  expect(withoutAnchor.entries).toEqual([]);
  expect(withoutAnchor.missingEpochIds).toEqual([
    keys[0]?.containerKeyEpochId as string,
  ]);

  // The anchor recovers what the poisoned bridge could not.
  const withAnchor = await rebuildKeyringEntriesFromLog({
    anchorKeysByEpochId: new Map([
      [
        keys[0]?.containerKeyEpochId as string,
        keys[0]?.keyMaterial as Uint8Array,
      ],
    ]),
    containerId,
    currentContainerKey: keys[1]?.keyMaterial as Uint8Array,
    currentContainerKeyEpochId: keys[1]?.containerKeyEpochId as string,
    log: poisonedLog,
  });
  expect(withAnchor.entries.map((e) => e.containerKeyEpochId)).toEqual([
    keys[0]?.containerKeyEpochId as string,
  ]);
  expect(withAnchor.missingEpochIds).toEqual([]);
});

test("a lying bridge does not mask a supplied anchor", async () => {
  const containerId = crypto.randomUUID();
  const keys = await Promise.all(
    [1, 2].map(async (keyEpoch) => {
      const keyMaterial = crypto.getRandomValues(new Uint8Array(32));
      return {
        containerKeyEpochId: await computeContainerKekMaterialId({
          containerId,
          keyEpoch,
          keyMaterial,
        }),
        keyEpoch,
        keyMaterial,
      };
    }),
  );

  // An AEAD-VALID bridge that decrypts to the wrong material: it opens
  // cleanly but yields a key that is not the committed epoch's. The anchor
  // must still win, so the check has to run before the fallback.
  const lyingKey = crypto.getRandomValues(new Uint8Array(32));
  const lyingBridge = await createContainerKekPredecessorBridge({
    containerId,
    predecessorContainerKey: lyingKey,
    predecessorContainerKeyEpochId: keys[0]?.containerKeyEpochId as string,
    successorContainerKey: keys[1]?.keyMaterial as Uint8Array,
    successorContainerKeyEpochId: keys[1]?.containerKeyEpochId as string,
  });
  const log = {
    containerId,
    hasMore: false,
    epochs: [
      {
        accessManifestHash: "manifest-1",
        bridge: null,
        containerKeyEpoch: 1,
        containerKeyEpochId: keys[0]?.containerKeyEpochId as string,
        keyring: null,
        parentContainerKeyEpochId: null,
        wraps: [],
      },
      {
        accessManifestHash: "manifest-2",
        bridge: lyingBridge as unknown as Record<string, unknown>,
        containerKeyEpoch: 2,
        containerKeyEpochId: keys[1]?.containerKeyEpochId as string,
        keyring: null,
        parentContainerKeyEpochId: null,
        wraps: [],
      },
    ],
  };

  const withoutAnchor = await rebuildKeyringEntriesFromLog({
    containerId,
    currentContainerKey: keys[1]?.keyMaterial as Uint8Array,
    currentContainerKeyEpochId: keys[1]?.containerKeyEpochId as string,
    log,
  });
  expect(withoutAnchor.entries).toEqual([]);
  expect(withoutAnchor.missingEpochIds).toEqual([
    keys[0]?.containerKeyEpochId as string,
  ]);

  const withAnchor = await rebuildKeyringEntriesFromLog({
    anchorKeysByEpochId: new Map([
      [
        keys[0]?.containerKeyEpochId as string,
        keys[0]?.keyMaterial as Uint8Array,
      ],
    ]),
    containerId,
    currentContainerKey: keys[1]?.keyMaterial as Uint8Array,
    currentContainerKeyEpochId: keys[1]?.containerKeyEpochId as string,
    log,
  });
  expect(withAnchor.entries.map((e) => e.containerKeyEpochId)).toEqual([
    keys[0]?.containerKeyEpochId as string,
  ]);
  expect(withAnchor.entries[0]?.keyMaterial).toEqual(
    keys[0]?.keyMaterial as Uint8Array,
  );
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
                containerKeyEpochId: `tearleads.container-kek.v1.sha256:${"0".repeat(64)}`,
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
                containerKeyEpochId: `tearleads.container-kek.v1.sha256:${"0".repeat(64)}`,
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
              containerKeyEpochId: `tearleads.container-kek.v1.sha256:${"0".repeat(64)}`,
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
              containerKeyEpochId: `tearleads.container-kek.v1.sha256:${"1".repeat(64)}`,
              keyring: null,
              parentContainerKeyEpochId: null,
              wraps: [],
            },
            {
              accessManifestHash: "manifest",
              bridge: null,
              containerKeyEpoch: 2,
              containerKeyEpochId: `tearleads.container-kek.v1.sha256:${"2".repeat(64)}`,
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
