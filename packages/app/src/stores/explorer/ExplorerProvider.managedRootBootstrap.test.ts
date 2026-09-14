import { expect, test } from "bun:test";
import { createContainerContentsStore as createExplorerStore } from "@tearleads/client-sdk";
import {
  createContainerParentLaneBatchMock as batchParentLanes,
  createMockApiClient,
} from "@tearleads/test-utils";
import {
  ensureContainerTables,
  ensureDocumentTables,
  listContainersResponse,
  listedContainer,
  saveContainer,
} from "../../../test/helpers/explorer-provider/explorerProviderFixtures";
import {
  createSqlRuntime,
  runtimeWithPatch,
} from "../../../test/helpers/explorer-provider/explorerProviderHarness";
import { createSignedExplorerRoots } from "../../../test/helpers/explorer-provider/signedExplorerRoots";
import { waitForCondition } from "../../../test/helpers/waitForCondition";

test("explorer store can skip background system container creation after managed root policy advances", async () => {
  let runtime = await createSqlRuntime();
  // The session acknowledges this root as its own, so its creator is the
  // session user.
  const signedRoots = await createSignedExplorerRoots(
    [
      {
        id: "root-container",
        organizationId: "org-1",
        metadataDocumentId: "root-metadata-document",
      },
    ],
    { userId: "user-1" },
  );
  const systemSlot = "sys_v1_bbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb";
  let listContainersCalls = 0;
  let writerProjectionCalls = 0;
  let systemContainerCreateCalls = 0;

  runtime = runtimeWithPatch(runtime, {
    apiClient: createMockApiClient({
      ...runtime.apiClient,
      ...signedRoots,
      createContainerWithMetadataDocument: async () => {
        systemContainerCreateCalls += 1;
        return null;
      },
      getContainerWriterProjection: async (id) => {
        writerProjectionCalls += 1;
        return signedRoots.getContainerWriterProjection(id);
      },
      listContainerParentLanes: batchParentLanes(async () => {
        listContainersCalls += 1;
        return listContainersResponse([
          listedContainer({
            id: "root-container",
            metadataAccessEpoch: 1,
            metadataAccessStateHash: "root-access-state",
            metadataDocumentId: "root-metadata-document",
            metadataReferencedPrincipals: [
              {
                keyEpoch: 1,
                keyFingerprint: "group-key",
                principalId: "admins-group",
                principalType: "group",
                stateHash: "advanced-state",
                version: 2,
              },
            ],
            organizationId: "org-1",
            parentId: null,
          }),
        ]);
      }),
    }),
    auth: { ...runtime.auth, rootContainerId: "root-container" },
    isAuthenticated: true,
    online: true,
    organizationId: "org-1",
    state: { ...runtime.state, containerId: "root-container" },
    userId: "user-1",
  });

  try {
    await ensureContainerTables(runtime.infra.execSql);
    await ensureDocumentTables(runtime.infra.execSql);
    await saveContainer(runtime.infra.execSql, {
      id: "root-container",
      organizationId: "org-1",
      parentId: null,
      metadataDocumentId: null,
      name: "/",
      icon: null,
    });

    const store = createExplorerStore(runtime);
    store.updateRuntime(runtime);
    await waitForCondition(
      () => store.getSnapshot().ready,
      "Explorer store did not become ready.",
    );

    await expect(
      store.ensureSystemContainer(systemSlot, "Contacts", {
        skipAdvancedManagedRoot: true,
      }),
    ).resolves.toBeNull();
    expect(listContainersCalls).toBeGreaterThan(0);
    expect(writerProjectionCalls).toBe(1);
    expect(systemContainerCreateCalls).toBe(0);
  } finally {
    runtime.close();
  }
});
