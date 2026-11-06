import { expect, test } from "bun:test";
import {
  createContainerParentLaneBatchMock as batchParentLanes,
  createMockApiClient,
  createTestExecSql,
} from "@tearleads/test-utils";
import { waitFor } from "../../../test/helpers/waitFor";
import type { DomainScope } from "../../data/shared/domainScope";
import type { ExecSql } from "../../data/sqlite/sqlSchema";
import { defaultContainerContentsPersistence } from "../../workflows/container-contents/containerPersistence";
import { createContainerContentsStore } from "./containerContentsStore";
import {
  createContainerContentsTestRuntime,
  emptyListContainersResponse,
  rootRefreshDirectory,
  seedLocalRootContainer,
} from "./runtime.testFixtures";

function createRuntime(input: {
  domainScope: DomainScope;
  execSql: ExecSql;
  organizationId: string | null;
  rootContainerId: string;
}) {
  return createContainerContentsTestRuntime({
    apiClient: createMockApiClient(),
    containerId: input.rootContainerId,
    domainScope: input.domainScope,
    execSql: input.execSql,
    organizationId: input.organizationId,
  });
}

test("container contents store merges locally persisted bootstrap rows after context changes", async () => {
  const { close, execSql } = await createTestExecSql(
    "container-contents-store-context-local-merge-test",
  );
  const domainScope = {} as DomainScope;
  const rootContainerId = "registered-root";

  try {
    await seedLocalRootContainer(execSql, {
      organizationId: "",
      rootContainerId,
    });

    const store = createContainerContentsStore(
      createRuntime({
        domainScope,
        execSql,
        organizationId: null,
        rootContainerId,
      }),
    );
    store.updateRuntime(
      createRuntime({
        domainScope,
        execSql,
        organizationId: null,
        rootContainerId,
      }),
    );

    await waitFor(
      () => store.getSnapshot().ready,
      "Container contents store did not become ready.",
    );
    expect(store.getSnapshot().nodes.map((node) => node.id)).toEqual([
      rootContainerId,
    ]);

    await defaultContainerContentsPersistence.saveContainer(
      execSql,
      {
        icon: "trash",
        id: "registered-trash",
        effectiveAccessLevel: "admin",
        metadataDocumentId: "registered-trash-metadata-document",
        name: "Trash",
        organizationId: "org-1",
        parentId: rootContainerId,
        systemSlot: "sys_v1_aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa",
      },
      null,
    );

    store.updateRuntime(
      createRuntime({
        domainScope,
        execSql,
        organizationId: "org-1",
        rootContainerId,
      }),
    );

    await waitFor(
      () =>
        store
          .getSnapshot()
          .nodes.some(
            (node) =>
              node.id === "registered-trash" &&
              node.name === "Trash" &&
              node.icon === "trash",
          ),
      "Container contents store did not merge the locally persisted Trash row.",
    );
  } finally {
    close();
  }
});

// Option 1 (instant Trash surfacing): a server-provisioned system container is
// written to local SQLite by persistRegistrationBootstrap in the SAME flow as
// registration / org-creation. `refreshLocalContainers` must surface it into the
// snapshot from that local row with NO server round-trip, so it appears as
// instantly as the device-first Contacts instead of waiting for the remote
// root-lane poll — and stay idempotent with any later remote pull (merge keyed by
// container id, never a duplicate). Here the remote list only ever returns empty,
// so a surfaced Trash can only have come from the local re-read.
test("refreshLocalContainers surfaces a newly persisted container from local SQLite", async () => {
  const { close, execSql } = await createTestExecSql(
    "container-contents-store-local-refresh-surface-test",
  );
  const domainScope = {} as DomainScope;
  let parentLaneCalls = 0;

  try {
    await defaultContainerContentsPersistence.ensureSchema(execSql);
    await defaultContainerContentsPersistence.saveContainer(
      execSql,
      {
        icon: null,
        id: "active-root",
        effectiveAccessLevel: "admin",
        metadataDocumentId: "active-root-metadata-document",
        name: "/",
        organizationId: "org-1",
        parentId: null,
      },
      null,
    );

    const signedDirectory = await rootRefreshDirectory();
    const runtime = createContainerContentsTestRuntime({
      resolveTrustedUserIdentity: signedDirectory.resolveTrustedUserIdentity,
      apiClient: createMockApiClient({
        getContainerWriterProjection:
          signedDirectory.getContainerWriterProjection,
        listContainerParentLanes: batchParentLanes(async () => {
          parentLaneCalls += 1;
          return emptyListContainersResponse();
        }),
      }),
      containerId: "active-root",
      domainScope,
      execSql,
    });
    const store = createContainerContentsStore(runtime);

    store.updateRuntime(runtime);

    await waitFor(
      () => store.getSnapshot().ready,
      "Container contents store did not become ready.",
    );

    // The provisioned Trash is not in the tree yet.
    expect(store.getSnapshot().nodes.map((node) => node.id)).not.toContain(
      "provisioned-trash",
    );

    // Simulate registration persisting the server-provisioned Trash to local
    // SQLite AFTER the store already initialized (the fresh-registration case).
    await defaultContainerContentsPersistence.saveContainer(
      execSql,
      {
        icon: "trash",
        id: "provisioned-trash",
        effectiveAccessLevel: "admin",
        metadataDocumentId: "provisioned-trash-metadata-document",
        name: "Trash",
        organizationId: "org-1",
        parentId: "active-root",
        systemSlot: "sys_v1_aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa",
      },
      null,
    );

    const listCallsBeforeSurface = parentLaneCalls;
    await store.refreshLocalContainers();

    // Surfaced from local SQLite (the remote list only returns empty, so it could
    // not have come from the network), with no remote list issued by the surface.
    expect(store.getSnapshot().nodes.map((node) => node.id)).toContain(
      "provisioned-trash",
    );
    expect(parentLaneCalls).toBe(listCallsBeforeSurface);

    // Idempotent with a repeat surface (and any later remote pull): keyed by
    // container id, so it reconciles in place rather than inserting a duplicate.
    await store.refreshLocalContainers();
    expect(
      store
        .getSnapshot()
        .nodes.filter((node) => node.id === "provisioned-trash"),
    ).toHaveLength(1);
  } finally {
    close();
  }
});
