import { expect, test } from "bun:test";
import {
  createContainerContentsStore as createExplorerStore,
  createInitializedContainerMetadataDocument,
} from "@tearleads/client-sdk";
import { bytesToBase64 } from "@tearleads/encoding";
import {
  createContainerParentLaneBatchMock,
  createMockApiClient,
} from "@tearleads/test-utils";
import {
  ensureContainerTables,
  ensureDocumentTables,
  listContainersResponse,
  listedContainer,
  saveContainer,
  saveDocumentRecord,
} from "../../../test/helpers/explorer-provider/explorerProviderFixtures";
import {
  createSqlRuntime,
  runtimeWithPatch,
} from "../../../test/helpers/explorer-provider/explorerProviderHarness";
import { waitForCondition } from "../../../test/helpers/waitForCondition";

test("explorer hydration logs a fresh-bootstrap re-pull as reconciling already-local containers, not new downloads", async () => {
  let runtime = await createSqlRuntime();
  const updatedAt = "2026-05-05T00:00:00.000Z";
  const logs: string[] = [];

  // Mirrors device-first bootstrap: the container already lives locally (system
  // containers have deterministic ids), with timestamps that match what the
  // server returns, so the server re-pull is a genuine no-op.
  async function saveAlreadyLocalContainer(input: {
    id: string;
    metadataAccessStateHash: string;
    metadataDocumentId: string;
    name: string;
    parentId: string | null;
  }) {
    const { initialUpdate } = await createInitializedContainerMetadataDocument(
      input.id,
      { icon: null, name: input.name },
    );
    await saveContainer(
      runtime.infra.execSql,
      {
        id: input.id,
        icon: null,
        metadataDocumentId: input.metadataDocumentId,
        name: input.name,
        organizationId: "org-2",
        parentId: input.parentId,
      },
      {
        localUpdatedAt: updatedAt,
        serverTimestamps: { createdAt: updatedAt, updatedAt },
      },
    );
    await saveDocumentRecord(
      runtime.infra.execSql,
      { appKind: "container-metadata", localId: input.id },
      {
        accessEpoch: 1,
        accessStateHash: input.metadataAccessStateHash,
        documentId: input.metadataDocumentId,
        id: input.id,
        lastCommitLsn: null,
        metadataUpdates: bytesToBase64(initialUpdate),
        snapshotEndVersion: "",
      },
      updatedAt,
    );
  }

  runtime = runtimeWithPatch(runtime, {
    apiClient: createMockApiClient({
      ...runtime.apiClient,
      listContainerParentLanes: createContainerParentLaneBatchMock(
        async (options) =>
          options.parentId === null || options.parentId === undefined
            ? listContainersResponse([
                listedContainer({
                  id: "root-container",
                  metadataAccessEpoch: 1,
                  metadataAccessStateHash: "root-access-state-hash-1",
                  metadataDocumentId: "root-metadata-document",
                  organizationId: "org-2",
                  parentId: null,
                  updatedAt,
                }),
              ])
            : listContainersResponse(
                options.parentId === "root-container"
                  ? [
                      listedContainer({
                        id: "contacts-container",
                        metadataAccessEpoch: 1,
                        metadataAccessStateHash: "contacts-access-state-hash-1",
                        metadataDocumentId: "contacts-metadata-document",
                        organizationId: "org-2",
                        parentId: "root-container",
                        updatedAt,
                      }),
                      listedContainer({
                        id: "trash-container",
                        metadataAccessEpoch: 1,
                        metadataAccessStateHash: "trash-access-state-hash-1",
                        metadataDocumentId: "trash-metadata-document",
                        organizationId: "org-2",
                        parentId: "root-container",
                        updatedAt,
                      }),
                    ]
                  : [],
              ),
      ),
    }),
    isAuthenticated: true,
    online: true,
    util: {
      ...runtime.util,
      log: (message: string) => {
        logs.push(message);
      },
    },
  });

  let store: ReturnType<typeof createExplorerStore> | null = null;
  try {
    await ensureContainerTables(runtime.infra.execSql);
    await ensureDocumentTables(runtime.infra.execSql);
    await saveAlreadyLocalContainer({
      id: "root-container",
      metadataAccessStateHash: "root-access-state-hash-1",
      metadataDocumentId: "root-metadata-document",
      name: "/",
      parentId: null,
    });
    await saveAlreadyLocalContainer({
      id: "contacts-container",
      metadataAccessStateHash: "contacts-access-state-hash-1",
      metadataDocumentId: "contacts-metadata-document",
      name: "Contacts",
      parentId: "root-container",
    });
    await saveAlreadyLocalContainer({
      id: "trash-container",
      metadataAccessStateHash: "trash-access-state-hash-1",
      metadataDocumentId: "trash-metadata-document",
      name: "Trash",
      parentId: "root-container",
    });

    const createdStore = createExplorerStore(runtime);
    store = createdStore;
    createdStore.updateRuntime(runtime);

    await waitForCondition(async () => {
      await createdStore.refresh();
      return logs.some((message) => message.startsWith("Container contents:"));
    }, "Explorer hydration never emitted a container-contents log.");

    const hydrationLogs = logs.filter((message) =>
      message.startsWith("Container contents:"),
    );
    // The re-pull only reconciled containers the device already had — the log
    // must say so rather than implying new containers came down from the server.
    expect(
      hydrationLogs.some((message) =>
        /reconciled \d+ already-local container\(s\) with the server/.test(
          message,
        ),
      ),
    ).toBe(true);
    expect(hydrationLogs.some((message) => message.includes("hydrated"))).toBe(
      false,
    );
  } finally {
    if (store) {
      store.updateRuntime(
        runtimeWithPatch(runtime, { dbStatus: "terminated" }),
      );
    }
    runtime.close();
  }
});
