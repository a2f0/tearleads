import { expect, test } from "bun:test";
import { createMockApiClient, createTestExecSql } from "@tearleads/test-utils";
import {
  organizationReadModelOrganizationId,
  organizationReadModelSnapshot,
  organizationReadModelUserId,
} from "../../test/helpers/organizationReadModelProjectionFixtures";
import type { BlobStore } from "../data/blobContracts";
import { defaultDocumentProjectorRegistry } from "../data/documents/documentKinds";
import { createDomainScope } from "../data/domainScope";
import { recordDocumentSyncFailure } from "../data/sqlite/documentPersistence";
import type { ExecSql } from "../data/sqlite/sqlSchema";
import {
  disposeDomainSyncCoordinator,
  getOrCreateDomainSyncCoordinator,
} from "../data/sync/syncCoordinator";
import { denyOrganizationPresentationAccess } from "../workflows/organizations/organizationPresentationAccessState";
import { createOrganizationReadModelCoordinator } from "./organizationReadModels";
import type {
  InternalRuntime,
  InternalWorkflowRuntimeInput,
} from "./workflowRuntime";

function createRuntime(execSql: ExecSql): {
  runtime: InternalRuntime;
  workflowInput: InternalWorkflowRuntimeInput;
} {
  const apiClient = createMockApiClient({
    async getOrganizationReadModelResult() {
      return { data: organizationReadModelSnapshot(), ok: true };
    },
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
