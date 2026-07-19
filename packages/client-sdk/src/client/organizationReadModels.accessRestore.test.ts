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

    // Simulate the denial a 403 read-model response records (the user was
    // removed from the group), then reconcile successfully: the denied →
    // restored edge is the retry signal for stranded write lanes.
    denyOrganizationPresentationAccess(
      {
        execSql,
        organizationId: organizationReadModelOrganizationId,
        requesterUserId: organizationReadModelUserId,
      },
      ["readModel", "usage"],
    );
    await expect(coordinator.reconcile()).resolves.not.toBeNull();
    await laneRan;
    expect(laneRuns).toBe(1);
  } finally {
    disposeDomainSyncCoordinator(domainScope);
    close();
  }
});
