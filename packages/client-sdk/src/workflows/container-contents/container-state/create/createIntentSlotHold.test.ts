import { expect, test } from "bun:test";
import { createMockApiClient, createTestExecSql } from "@tearleads/test-utils";
import { withPrincipalPolicies } from "../../../../../test/helpers/workflows/principalPolicyServiceFixture";
import {
  type ContainerCreateIntentHold,
  NO_CREATE_INTENT_HOLD,
} from "../../../../data/containers/shared/createIntentHoldMachine";
import {
  ContainerSyncWatermarkRepository,
  containerParentSyncLane,
} from "../../../../data/persistence/container-contents/containerSyncWatermarkPersistence";
import {
  createDomainScope,
  type DomainScope,
} from "../../../../data/shared/domainScope";
import type { ExecSql } from "../../../../data/sqlite/sqlSchema";
import { containerContentsOrganizationHost } from "../../../organizations/containerContentsHost";
import {
  type ContainerCreateIntentRecord,
  defaultContainerContentsPersistence,
} from "../../containerPersistence";
import { createTestContainerState } from "../containerState.testFixtures";
import type { ContainerCreateIntentSyncState } from "../types";
import { getOrCreateCreateIntentHoldListings } from "./createIntentHoldListings";
import {
  SYSTEM_SLOT_CREATE_HOLD_MS,
  systemSlotCreateGate,
} from "./createIntentSlotHold";
import { syncPendingContainerCreateIntents } from "./createIntentSync";

const HELD_SINCE = "2026-11-26T12:00:00.000Z";
const HELD_MS = Date.parse(HELD_SINCE);

test.each([
  ["no hold", NO_CREATE_INTENT_HOLD, null, HELD_MS, "post"],
  [
    "pathTooDeep hold (handled by depth gate)",
    { status: "pathTooDeep" } satisfies ContainerCreateIntentHold,
    null,
    HELD_MS,
    "post",
  ],
  [
    "a hold whose parent was never listed",
    {
      since: HELD_SINCE,
      status: "awaitingParentListing",
    } satisfies ContainerCreateIntentHold,
    null,
    HELD_MS + 1_000,
    "awaiting-listing",
  ],
  [
    "a hold whose parent was listed before it",
    {
      since: HELD_SINCE,
      status: "awaitingParentListing",
    } satisfies ContainerCreateIntentHold,
    "2026-11-26T11:59:59.000Z",
    HELD_MS + 1_000,
    "awaiting-listing",
  ],
  [
    "a hold whose parent was listed after it",
    {
      since: HELD_SINCE,
      status: "awaitingParentListing",
    } satisfies ContainerCreateIntentHold,
    "2026-11-26T12:00:01.000Z",
    HELD_MS + 1_000,
    "post",
  ],
  [
    "an expired hold",
    {
      since: HELD_SINCE,
      status: "awaitingParentListing",
    } satisfies ContainerCreateIntentHold,
    null,
    HELD_MS + SYSTEM_SLOT_CREATE_HOLD_MS,
    "post",
  ],
  [
    "a taken slot, even after a listing",
    { status: "slotTaken" } satisfies ContainerCreateIntentHold,
    "2026-11-26T12:00:01.000Z",
    HELD_MS + SYSTEM_SLOT_CREATE_HOLD_MS,
    "slot-taken",
  ],
] as const)(
  "system slot create gate: %s",
  (_label, hold, parentCheckedAt, nowMs, status) => {
    expect(
      systemSlotCreateGate({
        hold,
        nowMs,
        parentCheckedAt,
      }).status,
    ).toBe(status);
  },
);

test("a held create's remaining time is what it waits for", () => {
  expect(
    systemSlotCreateGate({
      hold: { since: HELD_SINCE, status: "awaitingParentListing" },
      nowMs: HELD_MS + 20_000,
      parentCheckedAt: null,
    }),
  ).toEqual({
    remainingMs: SYSTEM_SLOT_CREATE_HOLD_MS - 20_000,
    status: "awaiting-listing",
  });
});

function createRuntime(input: {
  readonly domainScope: DomainScope;
  readonly execSql: ExecSql;
  readonly onPostAttempt: () => void;
}) {
  return withPrincipalPolicies({
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
      domainScope: input.domainScope,
      events: [],
      online: true,
    },
    util: { log: () => {}, reportSecurityIncident: async () => {} },
  });
}

/** One pass over a create under the synced container `root`. */
function heldCreatePass(input: {
  readonly domainScope?: DomainScope;
  readonly execSql: ExecSql;
  readonly intent: () => ContainerCreateIntentRecord;
  readonly isCurrent?: () => boolean;
  readonly onListingRequest?: (parentContainerId: string | null) => void;
  readonly onPostAttempt: () => void;
  readonly onSyncAfter: (delayMs: number) => void;
}) {
  const domainScope = input.domainScope ?? createDomainScope();
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
      recordCreateIntentRevisionHold: async () => {},
    },
    resolveProjectionUserKey: async () => null,
    runtime: createRuntime({
      domainScope,
      execSql: input.execSql,
      onPostAttempt: input.onPostAttempt,
    }),
  };
  return syncPendingContainerCreateIntents({
    host: {
      persistContainerState: async () => {
        throw new Error("unexpected persist");
      },
    },
    isCurrent: input.isCurrent ?? (() => true),
    isRemoteSyncBlocked: () => false,
    requestRemoteReconciliation: (parentContainerId) =>
      input.onListingRequest?.(parentContainerId),
    requestSyncAfter: input.onSyncAfter,
    state,
  });
}

function contactsIntent(
  hold: ContainerCreateIntentHold,
  updatedAt: string,
  lastError: string | null = null,
): ContainerCreateIntentRecord {
  return {
    containerId: "contacts",
    createdAt: updatedAt,
    hold,
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
    const domainScope = createDomainScope();
    const heldAt = new Date(Date.now() - 1_000).toISOString();
    let postAttempts = 0;
    const delays: number[] = [];
    const listings: Array<string | null> = [];
    const pass = () =>
      heldCreatePass({
        domainScope,
        execSql,
        intent: () =>
          contactsIntent(
            { since: heldAt, status: "awaitingParentListing" },
            heldAt,
          ),
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

test("resetting the scoped hold-listings singleton makes the hold ask again", async () => {
  const { close, execSql } = await createTestExecSql("slot-hold-reset");
  try {
    const domainScope = createDomainScope();
    const heldAt = new Date(Date.now() - 1_000).toISOString();
    const listings: Array<string | null> = [];
    const pass = () =>
      heldCreatePass({
        domainScope,
        execSql,
        intent: () =>
          contactsIntent(
            { since: heldAt, status: "awaitingParentListing" },
            heldAt,
          ),
        onListingRequest: (parentContainerId) =>
          listings.push(parentContainerId),
        onPostAttempt: () => {},
        onSyncAfter: () => {},
      });

    await pass();
    await pass();
    expect(listings).toEqual(["root"]);

    getOrCreateCreateIntentHoldListings(domainScope).reset();

    await pass();
    expect(listings).toEqual(["root", "root"]);
  } finally {
    close();
  }
});

test("a stale pass does not request a listing or schedule a retry after loading the watermark", async () => {
  const { close, execSql } = await createTestExecSql("slot-hold-stale");
  try {
    const domainScope = createDomainScope();
    const heldAt = new Date(Date.now() - 1_000).toISOString();
    let current = true;
    const staleExecSql = (async (
      sql: string,
      params?: Parameters<ExecSql>[1],
      options?: Parameters<ExecSql>[2],
    ) => {
      const rows = await execSql(sql, params, options as never);
      if (sql.includes("container_sync_watermarks")) {
        current = false;
      }
      return rows;
    }) as ExecSql;
    const listings: Array<string | null> = [];
    const delays: number[] = [];
    await heldCreatePass({
      domainScope,
      execSql: staleExecSql,
      intent: () =>
        contactsIntent(
          { since: heldAt, status: "awaitingParentListing" },
          heldAt,
        ),
      isCurrent: () => current,
      onListingRequest: (parentContainerId) => listings.push(parentContainerId),
      onPostAttempt: () => {
        throw new Error("unexpected post on stale pass");
      },
      onSyncAfter: (delayMs) => delays.push(delayMs),
    });
    expect(listings).toEqual([]);
    expect(delays).toEqual([]);
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
          { status: "slotTaken" },
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

test("a real lastError matching old sentinel text does not hold an unheld create", async () => {
  const { close, execSql } = await createTestExecSql(
    "slot-real-error-not-hold",
  );
  try {
    let postAttempts = 0;
    await heldCreatePass({
      execSql,
      intent: () =>
        contactsIntent(
          NO_CREATE_INTENT_HOLD,
          new Date().toISOString(),
          "Container system slot is already taken",
        ),
      onPostAttempt: () => {
        postAttempts += 1;
      },
      onSyncAfter: () => {},
    });
    expect(postAttempts).toBe(1);
  } finally {
    close();
  }
});
