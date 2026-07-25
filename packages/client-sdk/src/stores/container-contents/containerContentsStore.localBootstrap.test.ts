import { expect, test } from "bun:test";
import { createMockApiClient, createTestExecSql } from "@tearleads/test-utils";
import type { BlobStore } from "../../data/blobContracts";
import { defaultDocumentProjectorRegistry } from "../../data/documents/documentKinds";
import type { DomainScope } from "../../data/domainScope";
import type { ExecSql } from "../../data/sqlite/sqlSchema";
import { defaultContainerContentsPersistence } from "../../workflows/container-contents/containerPersistence";
import { createContainerContentsStore } from "./containerContentsStore";
import { createContainerContentsStoreTestRuntime } from "./runtime.testFixtures";

async function waitForCondition(
  predicate: () => boolean | Promise<boolean>,
  message: string,
): Promise<void> {
  const deadline = Date.now() + 1_000;
  while (Date.now() <= deadline) {
    if (await predicate()) {
      return;
    }

    await new Promise((resolve) => setTimeout(resolve, 10));
  }

  throw new Error(message);
}

function createRuntime(input: {
  domainScope: DomainScope;
  execSql: ExecSql;
  organizationId: string | null;
  rootContainerId: string;
}) {
  return createContainerContentsStoreTestRuntime({
    apiClient: createMockApiClient(),
    auth: {
      isAuthenticated: true,
      organizationId: input.organizationId,
      userId: "user-1",
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
      execSql: input.execSql,
    },
    resolveTrustedUserIdentity: async () => null,
    state: {
      containerId: input.rootContainerId,
      domainScope: input.domainScope,
      events: [],
      online: true,
    },
    util: {
      log: () => {},
    },
  });
}

test("container contents store merges locally persisted bootstrap rows after context changes", async () => {
  const { close, execSql } = await createTestExecSql(
    "container-contents-store-context-local-merge-test",
  );
  const domainScope = {} as DomainScope;
  const rootContainerId = "registered-root";

  try {
    await defaultContainerContentsPersistence.ensureSchema(execSql);
    await defaultContainerContentsPersistence.saveContainer(
      execSql,
      {
        icon: null,
        id: rootContainerId,
        effectiveAccessLevel: "admin",
        metadataDocumentId: "registered-root-metadata-document",
        name: "/",
        organizationId: "",
        parentId: null,
      },
      null,
    );

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

    await waitForCondition(
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

    await waitForCondition(
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
