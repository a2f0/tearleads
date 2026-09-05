import { expect, test } from "bun:test";
import { createContainerContentsStore } from "@tearleads/client-sdk";
import {
  createContainerParentLaneBatchMock,
  createMockApiClient,
} from "@tearleads/test-utils";
import {
  ensureContainerTables,
  ensureDocumentTables,
  listContainersResponse,
  loadContainers,
  saveContainer,
} from "../../../test/helpers/explorer-provider/explorerProviderFixtures";
import {
  createSqlRuntime,
  runtimeWithPatch,
} from "../../../test/helpers/explorer-provider/explorerProviderHarness";
import { waitForCondition } from "../../../test/helpers/waitForCondition";
import { ensureSystemBootstrapContainer } from "./systemContainerBootstrap";

test("bootstrap corrects a cached system-folder icon while the remote queue is stalled", async () => {
  const base = await createSqlRuntime();
  const release = Promise.withResolvers<void>();
  let requests = 0;
  const slot = "sys_v1_aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa";
  const runtime = runtimeWithPatch(base, {
    organizationId: "org-1",
    isAuthenticated: true,
    online: true,
    state: { ...base.state, containerId: "root" },
    apiClient: createMockApiClient({
      ...base.apiClient,
      listContainerParentLanes: createContainerParentLaneBatchMock(async () => {
        requests += 1;
        await release.promise;
        return listContainersResponse();
      }),
    }),
  });
  const offline = runtimeWithPatch(runtime, { online: false });
  const store = createContainerContentsStore(offline);
  let probe: Promise<unknown> | undefined;
  try {
    await ensureContainerTables(base.infra.execSql);
    await ensureDocumentTables(base.infra.execSql);
    await saveContainer(base.infra.execSql, {
      id: "root",
      organizationId: "org-1",
      parentId: null,
      metadataDocumentId: null,
      name: "/",
      icon: null,
      effectiveAccessLevel: "admin",
    });
    store.updateRuntime(offline);
    await waitForCondition(
      () => store.getSnapshot().ready,
      "Local tree did not initialize",
    );
    const existing = await store.ensureSystemContainer(slot, "Contacts", {
      deferRemoteBootstrap: true,
      deferRemoteSync: true,
      icon: null,
    });
    expect(existing).not.toBeNull();
    store.updateRuntime(runtime);
    probe = store.ensureSystemContainer(
      "sys_v1_bbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb",
      "Trash",
    );
    await waitForCondition(() => requests > 0, "Remote probe did not start");
    let corrected = false;
    const correction = ensureSystemBootstrapContainer({
      currentOrganizationId: "org-1",
      currentRootContainerId: "root",
      store,
      systemContainer: {
        kind: "contacts",
        systemSlot: slot,
        name: "Contacts",
        icon: "users",
        provisionedAtOrganizationCreation: false,
      },
    }).then((node) => {
      corrected = node?.icon === "users";
    });
    await waitForCondition(
      () => corrected,
      "Icon bootstrap waited for the remote queue",
      1500,
    );
    await correction;
    expect(
      (await loadContainers(base.infra.execSql)).find(
        (node) => node.id === existing?.id,
      )?.icon,
    ).toBe("users");
  } finally {
    store.updateRuntime(runtimeWithPatch(runtime, { dbStatus: "terminated" }));
    release.resolve();
    await probe;
    base.close();
  }
});
