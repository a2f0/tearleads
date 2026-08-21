import { expect, test } from "bun:test";
import { generateKemSeedAndKeyPair } from "@symcrypt/crypto";
import { createMockApiClient, createTestExecSql } from "@symcrypt/test-utils";
import type { ContainerSystemSlot } from "@symcrypt/validators/containerSystemSlot";
import { waitFor } from "../../../test/helpers/waitFor";
import type { DomainScope } from "../../data/domainScope";
import type { ExecSql } from "../../data/sqlite/sqlSchema";
import { defaultContainerContentsPersistence } from "../../workflows/container-contents/containerPersistence";
import { createContainerContentsStore } from "./containerContentsStore";
import {
  createContainerContentsTestRuntime,
  seedLocalRootContainer,
} from "./runtime.testFixtures";

// A non-built-in system slot is enough to exercise the device-first create path;
// the slot string only needs to be stable for `findSystemContainerState`.
const TEST_SYSTEM_SLOT =
  "sys_v1_bbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb" as ContainerSystemSlot;
const ROOT_CONTAINER_ID = "device-first-root";

function createAuthenticatedRuntime(input: {
  apiClient: ReturnType<typeof createMockApiClient>;
  domainScope: DomainScope;
  execSql: ExecSql;
  online: boolean;
  organizationId?: string | undefined;
  rootContainerId?: string | undefined;
  writerReady?: boolean | undefined;
}) {
  return createContainerContentsTestRuntime({
    apiClient: input.apiClient,
    containerId: input.rootContainerId ?? ROOT_CONTAINER_ID,
    domainScope: input.domainScope,
    encapsulationKeyPair: input.writerReady
      ? generateKemSeedAndKeyPair()
      : null,
    execSql: input.execSql,
    online: input.online,
    organizationId: input.organizationId ?? "org-1",
  });
}

async function withReadyStore(
  online: boolean,
  listContainerParentLanes: ReturnType<
    typeof createMockApiClient
  >["listContainerParentLanes"],
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
    await seedLocalRootContainer(execSql, {
      rootContainerId: ROOT_CONTAINER_ID,
    });
    const runtime = createAuthenticatedRuntime({
      apiClient: createMockApiClient({
        listContainerParentLanes,
        ...options.apiClientOverrides,
      }),
      domainScope: {} as DomainScope,
      execSql,
      online,
      writerReady: options.writerReady,
    });
    const store = createContainerContentsStore(runtime);
    store.updateRuntime(runtime);

    await waitFor(
      () => store.getSnapshot().ready,
      "Container contents store did not become ready from the local root.",
      2_000,
    );
    expect(store.getSnapshot().nodes.map((node) => node.id)).toContain(
      ROOT_CONTAINER_ID,
    );

    await body(store, execSql);
  } finally {
    close();
  }
}

test("ensureSystemContainer creates the slot locally when parent-lane hydration returns a network failure (null)", async () => {
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
  let parentLaneBatchCalls = 0;
  await withReadyStore(
    false,
    async () => {
      parentLaneBatchCalls += 1;
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
      expect(parentLaneBatchCalls).toBe(0);
      expect(store.getSnapshot().ready).toBe(true);
    },
  );
});

test("ensureSystemContainer can defer remote bootstrap for non-blocking startup", async () => {
  // Contacts opens from local SQLite first; slow remote system-container I/O
  // must not keep the mini-app on its loading gate.
  let parentLaneBatchCalls = 0;
  let projectionCalls = 0;
  await withReadyStore(
    true,
    () => {
      parentLaneBatchCalls += 1;
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
      expect(parentLaneBatchCalls).toBe(0);
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
      apiClient: createMockApiClient({
        listContainerParentLanes: async () => null,
      }),
      domainScope: {} as DomainScope,
      execSql,
      online: true,
    });
    const store = createContainerContentsStore(runtime);
    store.updateRuntime(runtime);

    await waitFor(
      () => store.getSnapshot().ready,
      "Container contents store did not become ready.",
      2_000,
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

test("ensureSystemContainer creates distinct local system containers for the same slot under different roots", async () => {
  const { close, execSql } = await createTestExecSql(
    "ensure-system-container-multi-root-slot-test",
  );
  const domainScope = {} as DomainScope;
  const secondRootContainerId = "device-first-second-root";

  try {
    await seedLocalRootContainer(execSql, {
      organizationId: "org-1",
      rootContainerId: ROOT_CONTAINER_ID,
    });
    await seedLocalRootContainer(execSql, {
      organizationId: "org-2",
      rootContainerId: secondRootContainerId,
    });

    const apiClient = createMockApiClient({
      listContainerParentLanes: async () => null,
    });
    const store = createContainerContentsStore(
      createAuthenticatedRuntime({
        apiClient,
        domainScope,
        execSql,
        online: false,
        organizationId: "org-1",
        rootContainerId: ROOT_CONTAINER_ID,
      }),
    );
    store.updateRuntime(
      createAuthenticatedRuntime({
        apiClient,
        domainScope,
        execSql,
        online: false,
        organizationId: "org-1",
        rootContainerId: ROOT_CONTAINER_ID,
      }),
    );

    await waitFor(
      () => store.getSnapshot().ready,
      "Container contents store did not become ready.",
      2_000,
    );

    const first = await store.ensureSystemContainer(
      TEST_SYSTEM_SLOT,
      "Contacts",
      { skipAdvancedManagedRoot: true },
    );
    expect(first?.parentId).toBe(ROOT_CONTAINER_ID);

    store.updateRuntime(
      createAuthenticatedRuntime({
        apiClient,
        domainScope,
        execSql,
        online: false,
        organizationId: "org-2",
        rootContainerId: secondRootContainerId,
      }),
    );
    await waitFor(
      () =>
        store
          .getSnapshot()
          .nodes.some((node) => node.id === secondRootContainerId),
      "Second root did not load into the container store.",
      2_000,
    );

    const second = await store.ensureSystemContainer(
      TEST_SYSTEM_SLOT,
      "Contacts",
      { skipAdvancedManagedRoot: true },
    );

    expect(second?.parentId).toBe(secondRootContainerId);
    expect(second?.id).not.toBe(first?.id);
    expect(
      store
        .getSnapshot()
        .nodes.filter((candidate) => candidate.systemSlot === TEST_SYSTEM_SLOT),
    ).toHaveLength(2);
  } finally {
    close();
  }
});
