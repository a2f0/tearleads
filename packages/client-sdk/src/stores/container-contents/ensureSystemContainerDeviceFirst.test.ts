import { expect, test } from "bun:test";
import { generateKemSeedAndKeyPair } from "@tearleads/crypto";
import { createMockApiClient, createTestExecSql } from "@tearleads/test-utils";
import type { ContainerSystemSlot } from "@tearleads/validators/containerSystemSlot";
import type { BlobStore } from "../../data/blobContracts";
import { defaultDocumentProjectorRegistry } from "../../data/documents/documentKinds";
import type { DomainScope } from "../../data/domainScope";
import type { ExecSql } from "../../data/sqlite/sqlSchema";
import { defaultContainerContentsPersistence } from "../../workflows/container-contents/containerPersistence";
import { createContainerContentsWorkflowRuntime } from "../../workflows/container-contents/runtime";
import { createContainerContentsStore } from "./containerContentsStore";

// A non-built-in system slot is enough to exercise the device-first create path;
// the slot string only needs to be stable for `findSystemContainerState`.
const TEST_SYSTEM_SLOT = "contacts" as ContainerSystemSlot;
const ROOT_CONTAINER_ID = "device-first-root";

async function waitForCondition(
  predicate: () => boolean | Promise<boolean>,
  message: string,
): Promise<void> {
  const deadline = Date.now() + 2_000;
  while (Date.now() <= deadline) {
    if (await predicate()) {
      return;
    }

    await new Promise((resolve) => setTimeout(resolve, 10));
  }

  throw new Error(message);
}

function createAuthenticatedRuntime(input: {
  apiClient: ReturnType<typeof createMockApiClient>;
  domainScope: DomainScope;
  execSql: ExecSql;
  online: boolean;
  writerReady?: boolean | undefined;
}) {
  return createContainerContentsWorkflowRuntime({
    apiClient: input.apiClient,
    auth: {
      isAuthenticated: true,
      organizationId: "org-1",
      userId: "user-1",
    },
    crypto: {
      encapsulationKeyPair: input.writerReady
        ? generateKemSeedAndKeyPair()
        : null,
      signingFingerprint: null,
      signingKeyPair: null,
    },
    infra: {
      blobStore: {} as BlobStore,
      dbStatus: "ready",
      documentProjectors: defaultDocumentProjectorRegistry,
      execSql: input.execSql,
    },
    state: {
      containerId: ROOT_CONTAINER_ID,
      domainScope: input.domainScope,
      events: [],
      online: input.online,
    },
    util: {
      cacheReferencedPrincipalPolicies: async () => {},
      log: () => {},
    },
  });
}

async function seedLocalRootContainer(execSql: ExecSql): Promise<void> {
  await defaultContainerContentsPersistence.ensureSchema(execSql);
  await defaultContainerContentsPersistence.saveContainer(
    execSql,
    {
      icon: null,
      id: ROOT_CONTAINER_ID,
      effectiveAccessLevel: "admin",
      metadataDocumentId: "device-first-root-metadata-document",
      name: "/",
      organizationId: "org-1",
      parentId: null,
    },
    null,
  );
}

async function withReadyStore(
  online: boolean,
  listContainers: ReturnType<typeof createMockApiClient>["listContainers"],
  body: (
    store: ReturnType<typeof createContainerContentsStore>,
    execSql: ExecSql,
  ) => Promise<void>,
  options: {
    apiClientOverrides?: Partial<ReturnType<typeof createMockApiClient>>;
    writerReady?: boolean | undefined;
  } = {},
): Promise<void> {
  const { close, execSql } = await createTestExecSql(
    "ensure-system-container-device-first-test",
  );
  try {
    await seedLocalRootContainer(execSql);
    const runtime = createAuthenticatedRuntime({
      apiClient: createMockApiClient({
        listContainers,
        ...options.apiClientOverrides,
      }),
      domainScope: {} as DomainScope,
      execSql,
      online,
      writerReady: options.writerReady,
    });
    const store = createContainerContentsStore(runtime);
    store.updateRuntime(runtime);

    await waitForCondition(
      () => store.getSnapshot().ready,
      "Container contents store did not become ready from the local root.",
    );
    expect(store.getSnapshot().nodes.map((node) => node.id)).toContain(
      ROOT_CONTAINER_ID,
    );

    await body(store, execSql);
  } finally {
    close();
  }
}

test("ensureSystemContainer creates the slot locally when listContainers returns a network failure (null)", async () => {
  // The ApiClient surfaces a "Failed to fetch" as a null result, not a throw.
  // The system container must still be provisioned locally so a caller that
  // waits on it reaches a ready state instead of wedging on loading.
  await withReadyStore(
    true,
    async () => null,
    async (store) => {
      const node = await store.ensureSystemContainer(
        TEST_SYSTEM_SLOT,
        "Contacts",
        { skipAdvancedManagedRoot: true },
      );

      expect(node).not.toBeNull();
      expect(node?.systemSlot).toBe(TEST_SYSTEM_SLOT);
      expect(node?.parentId).toBe(ROOT_CONTAINER_ID);
      expect(
        store
          .getSnapshot()
          .nodes.some((candidate) => candidate.systemSlot === TEST_SYSTEM_SLOT),
      ).toBe(true);
      expect(store.getSnapshot().ready).toBe(true);
    },
  );
});

test("ensureSystemContainer creates the slot locally when remote hydration throws", async () => {
  // Defense in depth: even if the remote probe rejects (a non-ignorable error
  // bubbling out of the hydration lane rather than a clean null), provisioning
  // must fall through to a local create rather than abort.
  await withReadyStore(
    true,
    async () => {
      throw new Error("Failed to fetch");
    },
    async (store) => {
      const node = await store.ensureSystemContainer(
        TEST_SYSTEM_SLOT,
        "Contacts",
        { skipAdvancedManagedRoot: true },
      );

      expect(node).not.toBeNull();
      expect(node?.systemSlot).toBe(TEST_SYSTEM_SLOT);
      expect(store.getSnapshot().ready).toBe(true);
    },
  );
});

test("ensureSystemContainer creates the slot locally while offline without touching the network", async () => {
  // Offline (network toggle off): the remote probe is skipped entirely and the
  // container is created locally, queued for sync when connectivity returns.
  let listContainersCalls = 0;
  await withReadyStore(
    false,
    async () => {
      listContainersCalls += 1;
      return null;
    },
    async (store) => {
      const node = await store.ensureSystemContainer(
        TEST_SYSTEM_SLOT,
        "Contacts",
        { skipAdvancedManagedRoot: true },
      );

      expect(node).not.toBeNull();
      expect(node?.systemSlot).toBe(TEST_SYSTEM_SLOT);
      expect(listContainersCalls).toBe(0);
      expect(store.getSnapshot().ready).toBe(true);
    },
  );
});

test("ensureSystemContainer can defer remote bootstrap for non-blocking startup", async () => {
  // Contacts opens from local SQLite first; slow remote system-container I/O
  // must not keep the mini-app on its loading gate.
  let listContainersCalls = 0;
  let projectionCalls = 0;
  await withReadyStore(
    true,
    () => {
      listContainersCalls += 1;
      return new Promise<never>(() => {});
    },
    async (store) => {
      const node = await store.ensureSystemContainer(
        TEST_SYSTEM_SLOT,
        "Contacts",
        { deferRemoteBootstrap: true, skipAdvancedManagedRoot: true },
      );

      expect(node).not.toBeNull();
      expect(node?.systemSlot).toBe(TEST_SYSTEM_SLOT);
      expect(listContainersCalls).toBe(0);
      expect(projectionCalls).toBe(0);
      expect(store.getSnapshot().ready).toBe(true);
    },
    {
      apiClientOverrides: {
        getContainerWriterProjection: async () => {
          projectionCalls += 1;
          return null;
        },
      },
      writerReady: true,
    },
  );
});

test("ensureSystemContainer creates configured metadata icons", async () => {
  await withReadyStore(
    false,
    async () => null,
    async (store, execSql) => {
      const node = await store.ensureSystemContainer(
        TEST_SYSTEM_SLOT,
        "Trash",
        {
          deferRemoteBootstrap: true,
          icon: "trash",
          skipAdvancedManagedRoot: true,
        },
      );
      const storedContainers =
        await defaultContainerContentsPersistence.loadContainers(execSql);
      const storedSystemContainer = storedContainers.find(
        (storedContainer) => storedContainer.container.id === node?.id,
      );

      expect(node?.icon).toBe("trash");
      expect(storedSystemContainer?.container.icon).toBe("trash");
    },
  );
});

test("ensureSystemContainer can defer remote sync until a later ensure promotes it", async () => {
  await withReadyStore(
    false,
    async () => null,
    async (store, execSql) => {
      const bootstrapped = await store.ensureSystemContainer(
        TEST_SYSTEM_SLOT,
        "Contacts",
        {
          deferRemoteBootstrap: true,
          deferRemoteSync: true,
          skipAdvancedManagedRoot: true,
        },
      );

      expect(bootstrapped).not.toBeNull();
      expect(
        await defaultContainerContentsPersistence.listPendingCreateIntents(
          execSql,
        ),
      ).toHaveLength(0);
      expect(
        await defaultContainerContentsPersistence.listPendingUpdates(
          execSql,
          bootstrapped?.id ?? "",
        ),
      ).toHaveLength(0);

      await store.ensureSystemContainer(TEST_SYSTEM_SLOT, "Contacts", {
        deferRemoteBootstrap: true,
        skipAdvancedManagedRoot: true,
      });
      await store.ensureSystemContainer(TEST_SYSTEM_SLOT, "Contacts", {
        deferRemoteBootstrap: true,
        skipAdvancedManagedRoot: true,
      });

      expect(
        await defaultContainerContentsPersistence.listPendingCreateIntents(
          execSql,
        ),
      ).toHaveLength(1);
      expect(
        await defaultContainerContentsPersistence.listPendingUpdates(
          execSql,
          bootstrapped?.id ?? "",
        ),
      ).toHaveLength(1);
    },
  );
});

test("ensureSystemContainer cannot provision a slot when no local root exists and the network is down", async () => {
  // Characterization: provisioning is parented under the local root. If the root
  // itself was never persisted locally (e.g. a fresh login whose root lives only
  // on the server) and the network fails, there is nothing to parent the system
  // container under, so it cannot be created. This is the residual device-first
  // gap that a local root projection on register would close.
  const { close, execSql } = await createTestExecSql(
    "ensure-system-container-no-local-root-test",
  );
  try {
    // Schema only — deliberately no root container persisted.
    await defaultContainerContentsPersistence.ensureSchema(execSql);
    const runtime = createAuthenticatedRuntime({
      apiClient: createMockApiClient({ listContainers: async () => null }),
      domainScope: {} as DomainScope,
      execSql,
      online: true,
    });
    const store = createContainerContentsStore(runtime);
    store.updateRuntime(runtime);

    await waitForCondition(
      () => store.getSnapshot().ready,
      "Container contents store did not become ready.",
    );

    const node = await store.ensureSystemContainer(
      TEST_SYSTEM_SLOT,
      "Contacts",
      {
        skipAdvancedManagedRoot: true,
      },
    );

    // With no local root and a failed network, the slot cannot be provisioned.
    expect(node).toBeNull();
  } finally {
    close();
  }
});

test("ensureSystemContainer is idempotent once the slot exists locally", async () => {
  await withReadyStore(
    true,
    async () => null,
    async (store) => {
      const first = await store.ensureSystemContainer(
        TEST_SYSTEM_SLOT,
        "Contacts",
        { skipAdvancedManagedRoot: true },
      );
      const second = await store.ensureSystemContainer(
        TEST_SYSTEM_SLOT,
        "Contacts",
        { skipAdvancedManagedRoot: true },
      );

      expect(first).not.toBeNull();
      expect(second?.id).toBe(first?.id);
      expect(
        store
          .getSnapshot()
          .nodes.filter(
            (candidate) => candidate.systemSlot === TEST_SYSTEM_SLOT,
          ),
      ).toHaveLength(1);
    },
  );
});
