import { expect, test } from "bun:test";
import { createMockApiClient, createTestExecSql } from "@tearleads/test-utils";
import { withPrincipalPolicies } from "../../../../../test/helpers/workflows/principalPolicyServiceFixture";
import {
  CONTAINER_CREATE_AWAITS_PARENT_LISTING,
  CONTAINER_SYSTEM_SLOT_TAKEN_MESSAGE,
} from "../../../../data/containers/shared/systemSlotCreate";
import {
  ContainerSyncWatermarkRepository,
  containerParentSyncLane,
} from "../../../../data/persistence/container-contents/containerSyncWatermarkPersistence";
import { createDomainScope } from "../../../../data/shared/domainScope";
import type { ExecSql } from "../../../../data/sqlite/sqlSchema";
import { containerContentsOrganizationHost } from "../../../organizations/containerContentsHost";
import {
  type ContainerCreateIntentRecord,
  defaultContainerContentsPersistence,
} from "../../containerPersistence";
import { createTestContainerState } from "../containerState.testFixtures";
import type { ContainerCreateIntentSyncState } from "../types";
import {
  SYSTEM_SLOT_CREATE_HOLD_MS,
  systemSlotCreateGate,
} from "./createIntentSlotHold";
import { syncPendingContainerCreateIntents } from "./createIntentSync";

const HELD_SINCE = "2026-11-26T12:00:00.000Z";
const HELD_MS = Date.parse(HELD_SINCE);

test.each([
  ["no recorded reason", null, null, HELD_MS, "post"],
  [
    "another recorded error",
    "Remote container create failed: x",
    null,
    HELD_MS,
    "post",
  ],
  [
    "a hold whose parent was never listed",
    CONTAINER_CREATE_AWAITS_PARENT_LISTING,
    null,
    HELD_MS + 1_000,
    "awaiting-listing",
  ],
  [
    "a hold whose parent was listed before it",
    CONTAINER_CREATE_AWAITS_PARENT_LISTING,
    "2026-11-26T11:59:59.000Z",
    HELD_MS + 1_000,
    "awaiting-listing",
  ],
  [
    "a hold whose parent was listed after it",
    CONTAINER_CREATE_AWAITS_PARENT_LISTING,
    "2026-11-26T12:00:01.000Z",
    HELD_MS + 1_000,
    "post",
  ],
  [
    "an expired hold",
    CONTAINER_CREATE_AWAITS_PARENT_LISTING,
    null,
    HELD_MS + SYSTEM_SLOT_CREATE_HOLD_MS,
    "post",
  ],
  [
    "a taken slot, even after a listing",
    CONTAINER_SYSTEM_SLOT_TAKEN_MESSAGE,
    "2026-11-26T12:00:01.000Z",
    HELD_MS + SYSTEM_SLOT_CREATE_HOLD_MS,
    "slot-taken",
  ],
] as const)(
  "system slot create gate: %s",
  (_label, lastError, parentCheckedAt, nowMs, status) => {
    expect(
      systemSlotCreateGate({
        heldSince: HELD_SINCE,
        lastError,
        nowMs,
        parentCheckedAt,
      }).status,
    ).toBe(status);
  },
);

test("a held create's remaining time is what it waits for", () => {
  expect(
    systemSlotCreateGate({
      heldSince: HELD_SINCE,
      lastError: CONTAINER_CREATE_AWAITS_PARENT_LISTING,
      nowMs: HELD_MS + 20_000,
      parentCheckedAt: null,
    }),
  ).toEqual({
    remainingMs: SYSTEM_SLOT_CREATE_HOLD_MS - 20_000,
    status: "awaiting-listing",
  });
});

/** One pass over a create under the synced container `root`. */
function heldCreatePass(input: {
  readonly execSql: ExecSql;
  readonly intent: () => ContainerCreateIntentRecord;
  readonly onListingRequest?: (parentContainerId: string | null) => void;
  readonly onPostAttempt: () => void;
  readonly onSyncAfter: (delayMs: number) => void;
}) {
  const state: ContainerCreateIntentSyncState = {
    containersById: new Map([
      ["root", createTestContainerState({ id: "root", parentId: null })],
      [
        "contacts",
        createTestContainerState({
          id: "contacts",
          parentId: "root",
          synced: false,
        }),
      ],
    ]),
    persistence: {
      ...defaultContainerContentsPersistence,
      listPendingCreateIntents: async () => [input.intent()],
      recordCreateIntentRevisionError: async () => {},
    },
    resolveProjectionUserKey: async () => null,
    runtime: withPrincipalPolicies({
      organizations: containerContentsOrganizationHost,
      apiClient: createMockApiClient({
        // A create's first request reads its parent's projection.
        getContainerWriterProjection: async () => {
          input.onPostAttempt();
          return null;
        },
      }),
      auth: {
        isAuthenticated: true,
        organizationId: "organization",
        userId: "user",
      },
      crypto: {
        encapsulationKeyPair: {
          secretKey: new Uint8Array(32),
        } as ContainerCreateIntentSyncState["runtime"]["crypto"]["encapsulationKeyPair"],
        signingFingerprint: "signing-fingerprint",
        signingKeyPair: {
          signingPrivateKey: new Uint8Array(32),
        } as ContainerCreateIntentSyncState["runtime"]["crypto"]["signingKeyPair"],
      },
      infra: {
        blobStore:
          {} as ContainerCreateIntentSyncState["runtime"]["infra"]["blobStore"],
        dbStatus: "ready",
        documentProjectors:
          {} as ContainerCreateIntentSyncState["runtime"]["infra"]["documentProjectors"],
        execSql: input.execSql,
      },
      resolveTrustedUserIdentity: async () => null,
      state: {
        containerId: "root",
        domainScope: createDomainScope(),
        events: [],
        online: true,
      },
      util: { log: () => {}, reportSecurityIncident: async () => {} },
    }),
  };
  return syncPendingContainerCreateIntents({
    host: {
      persistContainerState: async () => {
        throw new Error("unexpected persist");
      },
    },
    isCurrent: () => true,
    isRemoteSyncBlocked: () => false,
    requestRemoteReconciliation: (parentContainerId) =>
      input.onListingRequest?.(parentContainerId),
    requestSyncAfter: input.onSyncAfter,
    state,
  });
}

function contactsIntent(
  lastError: string,
  updatedAt: string,
): ContainerCreateIntentRecord {
  return {
    containerId: "contacts",
    createdAt: updatedAt,
    id: "create-contacts",
    intentType: "container.create",
    lastAttemptedAt: null,
    lastError,
    parentContainerId: "root",
    remoteContainerId: null,
    remoteMetadataAccessStateHash: null,
    remoteMetadataDocumentId: null,
    syncStatus: "pending",
    updatedAt,
  };
}

test("a create a root fold held waits for its parent's listing, then posts", async () => {
  const { close, execSql } = await createTestExecSql("slot-hold-listing");
  try {
    const heldAt = new Date(Date.now() - 1_000).toISOString();
    let postAttempts = 0;
    const delays: number[] = [];
    const listings: Array<string | null> = [];
    const pass = () =>
      heldCreatePass({
        execSql,
        intent: () =>
          contactsIntent(CONTAINER_CREATE_AWAITS_PARENT_LISTING, heldAt),
        onListingRequest: (parentContainerId) =>
          listings.push(parentContainerId),
        onPostAttempt: () => {
          postAttempts += 1;
        },
        onSyncAfter: (delayMs) => delays.push(delayMs),
      });

    await expect(pass()).resolves.toBe(0);
    await expect(pass()).resolves.toBe(0);
    expect(postAttempts).toBe(0);
    // One listing for the hold, however many passes it waits through.
    expect(listings).toEqual(["root"]);
    expect(delays).toHaveLength(2);
    expect(delays[0]).toBeGreaterThan(SYSTEM_SLOT_CREATE_HOLD_MS - 60_000);
    expect(delays[0]).toBeLessThanOrEqual(SYSTEM_SLOT_CREATE_HOLD_MS);

    await new ContainerSyncWatermarkRepository(execSql).markChecked(
      containerParentSyncLane("root"),
    );
    await pass();
    expect(postAttempts).toBe(1);
    expect(delays).toHaveLength(2);
  } finally {
    close();
  }
});

test("a create refused for a taken slot is not posted again after its parent's listing", async () => {
  const { close, execSql } = await createTestExecSql("slot-taken-listing");
  try {
    await new ContainerSyncWatermarkRepository(execSql).markChecked(
      containerParentSyncLane("root"),
    );
    let postAttempts = 0;
    const delays: number[] = [];
    await heldCreatePass({
      execSql,
      intent: () =>
        contactsIntent(
          CONTAINER_SYSTEM_SLOT_TAKEN_MESSAGE,
          new Date(Date.now() - SYSTEM_SLOT_CREATE_HOLD_MS).toISOString(),
        ),
      onPostAttempt: () => {
        postAttempts += 1;
      },
      onSyncAfter: (delayMs) => delays.push(delayMs),
    });
    expect(postAttempts).toBe(0);
    expect(delays).toEqual([]);
  } finally {
    close();
  }
});
