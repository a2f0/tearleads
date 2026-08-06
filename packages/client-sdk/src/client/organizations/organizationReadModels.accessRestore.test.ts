import { expect, test } from "bun:test";
import type { RequestResult } from "@tearleads/api-client";
import { createMockApiClient, createTestExecSql } from "@tearleads/test-utils";
import type { OrganizationReadModelResponse } from "@tearleads/validators/response";
import {
  organizationReadModelFailure,
  organizationReadModelOrganizationId,
  organizationReadModelSnapshot,
  organizationReadModelUserId,
} from "../../../test/helpers/organizationReadModelProjectionFixtures";
import type { BlobStore } from "../../data/blobContracts";
import { defaultDocumentProjectorRegistry } from "../../data/documents/documentKinds";
import { createDomainScope } from "../../data/domainScope";
import { sqlDocumentMoveIntentPersistence } from "../../data/persistence/container-contents/documentMoveIntentPersistence";
import {
  completeDormantMetadataSweepRequest,
  listDormantMetadataSweepRequests,
} from "../../data/persistence/container-contents/dormantMetadataSweep";
import {
  ensureDocumentTables,
  recordDocumentSyncFailure,
} from "../../data/sqlite/documentPersistence";
import { containerTables } from "../../data/sqlite/schema";
import type { ExecSql } from "../../data/sqlite/sqlSchema";
import { ensureSqlTables } from "../../data/sqlite/sqlSchema";
import {
  disposeDomainSyncCoordinator,
  getOrCreateDomainSyncCoordinator,
  waitForDomainSyncCoordinatorToSettle,
} from "../../data/sync/syncCoordinator";
import { CONTAINER_CONTENTS_SYNC_LANE_KEY } from "../../workflows/container-contents/syncLane";
import { denyOrganizationPresentationAccess } from "../../workflows/organizations/organizationPresentationAccessState";
import type {
  InternalRuntime,
  InternalWorkflowRuntimeInput,
} from "../workflowRuntime";
import { createOrganizationReadModelCoordinator } from "./organizationReadModels";

function createRuntime(
  execSql: ExecSql,
  getOrganizationReadModelResult?: () => Promise<
    RequestResult<OrganizationReadModelResponse>
  >,
): {
  runtime: InternalRuntime;
  workflowInput: InternalWorkflowRuntimeInput;
} {
  const apiClient = createMockApiClient({
    getOrganizationReadModelResult:
      getOrganizationReadModelResult ??
      (async () => {
        return { data: organizationReadModelSnapshot(), ok: true };
      }),
  });
  const workflowInput = {
    apiClient,
    resolveTrustedUserIdentity: async () => null,
    auth: {
      isAuthenticated: true,
      organizationId: organizationReadModelOrganizationId,
      userId: organizationReadModelUserId,
    },
    crypto: {
      encapsulationKeyPair: null,
      signingFingerprint: null,
      signingKeyPair: null,
    },
    infra: {
      blobStore: {} as BlobStore,
      dbStatus: "ready",
      documentProjectors: defaultDocumentProjectorRegistry,
      execSql,
    },
    state: {
      containerId: null,
      domainScope: createDomainScope(),
      events: [],
      online: true,
    },
    util: {
      log: () => {},
      logError: () => {},
    },
  } satisfies InternalWorkflowRuntimeInput;
  const runtime = {
    adoptRootContainer: () => false,
    pinLocalUserIdentity: async () => {},
    publicRuntime: {
      version: 0,
      input: () => workflowInput,
      subscribe: () => () => {},
    },
    workflowInput: () => workflowInput,
  } satisfies InternalRuntime;
  return { runtime, workflowInput };
}

test("a reconcile that restores denied org access re-requests all sync lanes", async () => {
  const { close, execSql } = await createTestExecSql(
    "organization-read-model-access-restore-test",
  );
  const { runtime, workflowInput } = createRuntime(execSql);
  const domainScope = workflowInput.state.domainScope;
  try {
    let laneRuns = 0;
    let markLaneRan = () => {};
    const laneRan = new Promise<void>((resolve) => {
      markLaneRan = resolve;
    });
    getOrCreateDomainSyncCoordinator(domainScope).registerLane(
      "documents:stranded",
      {
        label: "Stranded write lane",
        phase: "document",
        run: async () => {
          laneRuns += 1;
          markLaneRan();
        },
      },
    );
    const coordinator = createOrganizationReadModelCoordinator(runtime);

    // A reconcile with access already readable must not re-drive lanes.
    await expect(coordinator.reconcile()).resolves.not.toBeNull();
    expect(laneRuns).toBe(0);

    const accessInput = {
      execSql,
      organizationId: organizationReadModelOrganizationId,
      requesterUserId: organizationReadModelUserId,
    };

    // A denied → restored edge with no recorded terminal failures must not
    // re-drive lanes either: transient denials happen during bootstrap, and
    // there is nothing stranded to retry.
    denyOrganizationPresentationAccess(accessInput, ["readModel", "usage"]);
    await expect(coordinator.reconcile()).resolves.not.toBeNull();
    expect(laneRuns).toBe(0);

    // With a recorded denied write (the user was removed from the group while
    // writes were syncing), the denied → restored edge is the retry signal.
    await recordDocumentSyncFailure(
      execSql,
      { appKind: "documents", localId: "stranded-document" },
      {
        attemptedAt: "2026-01-01T00:00:00.000Z",
        message: "Write access denied by the server (403)",
        status: 403,
      },
    );
    denyOrganizationPresentationAccess(accessInput, ["readModel", "usage"]);
    await expect(coordinator.reconcile()).resolves.not.toBeNull();
    await laneRan;
    expect(laneRuns).toBe(1);
  } finally {
    disposeDomainSyncCoordinator(domainScope);
    close();
  }
});

test("restored access requests cleanup for every marked organization", async () => {
  const { close, execSql } = await createTestExecSql(
    "organization-read-model-dormant-cleanup-test",
  );
  const { runtime, workflowInput } = createRuntime(execSql);
  const domainScope = workflowInput.state.domainScope;
  try {
    await ensureSqlTables(execSql, containerTables);
    await execSql(
      `INSERT INTO dormant_container_metadata
        (container_id, organization_id, retained_at)
       VALUES (?, ?, '2026-01-01T00:00:00.000Z'),
              (?, ?, '2026-01-01T00:00:00.000Z')`,
      [
        "revoked-container",
        organizationReadModelOrganizationId,
        "peer-revoked-container",
        "peer-org",
      ],
    );
    const sweptOrganizations: string[][] = [];
    let markLaneRan = () => {};
    const laneRan = new Promise<void>((resolve) => {
      markLaneRan = resolve;
    });
    getOrCreateDomainSyncCoordinator(domainScope).registerLane(
      CONTAINER_CONTENTS_SYNC_LANE_KEY,
      {
        label: "Container contents",
        phase: "structural",
        run: async () => {
          const sweeps = await listDormantMetadataSweepRequests(
            execSql,
            organizationReadModelUserId,
          );
          sweptOrganizations.push(sweeps.map((sweep) => sweep.organizationId));
          for (const sweep of sweeps) {
            await completeDormantMetadataSweepRequest(execSql, sweep);
          }
          markLaneRan();
        },
      },
    );
    const coordinator = createOrganizationReadModelCoordinator(runtime);
    denyOrganizationPresentationAccess(
      {
        execSql,
        organizationId: organizationReadModelOrganizationId,
        requesterUserId: organizationReadModelUserId,
      },
      ["readModel", "usage"],
    );

    // No terminal write failure is needed: dormant cleanup has its own
    // organization-scoped structural signal and does not re-drive other lanes.
    await expect(coordinator.reconcile()).resolves.not.toBeNull();
    await laneRan;
    expect(sweptOrganizations[0]).toEqual([
      organizationReadModelOrganizationId,
      "peer-org",
    ]);
  } finally {
    disposeDomainSyncCoordinator(domainScope);
    close();
  }
});

test("a failed reconcile after a denial does not re-arm sync lanes", async () => {
  const { close, execSql } = await createTestExecSql(
    "organization-read-model-access-restore-failed-feed-test",
  );
  let failFeed = false;
  const { runtime, workflowInput } = createRuntime(execSql, async () =>
    failFeed
      ? organizationReadModelFailure({ kind: "http", status: 503 })
      : { data: organizationReadModelSnapshot(), ok: true as const },
  );
  const domainScope = workflowInput.state.domainScope;
  try {
    let laneRuns = 0;
    getOrCreateDomainSyncCoordinator(domainScope).registerLane(
      "documents:stranded",
      {
        label: "Stranded write lane",
        phase: "document",
        run: async () => {
          laneRuns += 1;
        },
      },
    );
    const coordinator = createOrganizationReadModelCoordinator(runtime);
    const accessInput = {
      execSql,
      organizationId: organizationReadModelOrganizationId,
      requesterUserId: organizationReadModelUserId,
    };
    await ensureDocumentTables(execSql);
    await recordDocumentSyncFailure(
      execSql,
      { appKind: "documents", localId: "stranded-document" },
      {
        attemptedAt: "2026-01-01T00:00:00.000Z",
        message: "Write access denied by the server (403)",
        status: 403,
      },
    );

    // A feed failure while denied proves nothing about restored access: the
    // scope stays unreadable (null), and no lanes re-arm.
    denyOrganizationPresentationAccess(accessInput, ["readModel", "usage"]);
    failFeed = true;
    await expect(coordinator.reconcile()).resolves.toBeNull();
    expect(laneRuns).toBe(0);

    // The next completed reconcile still observes the denied edge and
    // re-arms on the recorded evidence.
    failFeed = false;
    await expect(coordinator.reconcile()).resolves.not.toBeNull();
    await waitForDomainSyncCoordinatorToSettle(domainScope);
    expect(laneRuns).toBe(1);
  } finally {
    disposeDomainSyncCoordinator(domainScope);
    close();
  }
});

// A parked permission-denied move is re-arm evidence on its own, and the
// restored organization's reset is scoped: other organizations' parked moves
// stay parked (row 7).
test("restored access replays that organization's denied moves", async () => {
  const { close, execSql } = await createTestExecSql(
    "organization-read-model-denied-move-restore-test",
  );
  const { runtime, workflowInput } = createRuntime(execSql);
  const domainScope = workflowInput.state.domainScope;
  try {
    let laneRuns = 0;
    let markLaneRan = () => {};
    const laneRan = new Promise<void>((resolve) => {
      markLaneRan = resolve;
    });
    getOrCreateDomainSyncCoordinator(domainScope).registerLane(
      "documents:stranded",
      {
        label: "Stranded write lane",
        phase: "document",
        run: async () => {
          laneRuns += 1;
          markLaneRan();
        },
      },
    );
    const coordinator = createOrganizationReadModelCoordinator(runtime);
    const accessInput = {
      execSql,
      organizationId: organizationReadModelOrganizationId,
      requesterUserId: organizationReadModelUserId,
    };

    await ensureDocumentTables(execSql);
    await sqlDocumentMoveIntentPersistence.ensureSchema(execSql);
    await ensureSqlTables(execSql, containerTables);
    for (const [container, org] of [
      ["restored-target", organizationReadModelOrganizationId],
      ["foreign-target", "some-other-organization"],
    ] as const) {
      await execSql(
        `INSERT INTO containers (
          id, organization_id, local_created_at, local_updated_at
        ) VALUES (?, ?, ?, ?)`,
        [
          container,
          org,
          "2026-01-01T00:00:00.000Z",
          "2026-01-01T00:00:00.000Z",
        ],
      );
    }
    for (const [doc, local, target] of [
      ["restored-remote", "restored-doc", "restored-target"],
      ["foreign-remote", "foreign-doc", "foreign-target"],
    ] as const) {
      await sqlDocumentMoveIntentPersistence.enqueueMoveIntent(execSql, {
        documentId: doc,
        localId: local,
        replaceLinkedContainers: false,
        sourceContainerId: "from",
        targetContainerId: target,
      });
      await sqlDocumentMoveIntentPersistence.recordMoveIntentError(execSql, {
        denied: true,
        documentId: doc,
        message: "denied",
      });
    }

    // The denied → restored edge re-arms lanes on the parked move alone —
    // no recorded terminal failure rows required.
    denyOrganizationPresentationAccess(accessInput, ["readModel", "usage"]);
    await expect(coordinator.reconcile()).resolves.not.toBeNull();
    await laneRan;
    expect(laneRuns).toBe(1);

    // The restored organization's move replays; the other stays parked.
    expect(
      (
        await sqlDocumentMoveIntentPersistence.listPendingMoveIntents(execSql)
      ).map((intent) => intent.documentId),
    ).toEqual(["restored-remote"]);
    expect(
      await sqlDocumentMoveIntentPersistence.hasDeniedMoveIntents(execSql, {
        organizationId: "some-other-organization",
      }),
    ).toBe(true);
  } finally {
    disposeDomainSyncCoordinator(domainScope);
    close();
  }
});
