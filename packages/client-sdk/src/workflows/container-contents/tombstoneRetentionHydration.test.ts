import { expect, test } from "bun:test";
import { bytesToBase64 } from "@tearleads/encoding";
import { exportAllUpdates } from "@tearleads/loro";
import { createTestExecSql } from "@tearleads/test-utils";
import type {
  ListContainerParentLanesResponse,
  ListContainersResponse,
} from "@tearleads/validators/response";
import {
  createContainerMetadataDocument,
  writeContainerMetadataValue,
} from "../../data/containers/containerMetadataDocument";
import { defaultContainerContentsPersistence } from "./containerPersistence";
import { listPendingWrites } from "./pendingWrites";
import { hydrateRemoteContainers } from "./remoteHydration";
import type {
  ContainerState,
  RemoteContainerHydrationState,
} from "./remoteHydration/types";

const T0 = "2026-01-01T00:00:00.000Z";
const T1 = "2026-01-01T00:00:01.000Z";

const T2 = "2026-01-01T00:00:02.000Z";
const T3 = "2026-01-01T00:00:03.000Z";

function remoteContainerItem(
  updatedAt: string,
): ListContainersResponse["items"][number] {
  return {
    createdAt: T0,
    depth: 0,
    effectiveAccessLevel: "write",
    id: "revoked",
    metadataAccessEpoch: 1,
    metadataAccessStateHash: "access-revoked",
    metadataDocumentId: "metadata-revoked",
    metadataReferencedPrincipals: [],
    organizationId: "peer-organization",
    parentId: null,
    updatedAt,
  };
}

function lanePage(
  overrides: Partial<ListContainersResponse>,
): ListContainersResponse {
  return {
    hasMore: false,
    items: [],
    nextWatermark: null,
    tombstones: [],
    ...overrides,
  };
}

test("revoke and remote re-list retain and re-attach through hydration", async () => {
  const { close, execSql } = await createTestExecSql(
    "tombstone-metadata-hydration",
  );
  try {
    await defaultContainerContentsPersistence.ensureSchema(execSql);
    await listPendingWrites(execSql);
    // Scripted server: each hydration pass consumes the next root-lane page;
    // discovered child lanes always answer empty.
    const rootLanePages: ListContainersResponse[] = [];
    const state = {
      containersById: new Map<string, ContainerState>(),
      persistence: defaultContainerContentsPersistence,
      runtime: {
        adoptRootContainer: () => {},
        apiClient: {
          async listContainerParentLanes(request: {
            lanes: ReadonlyArray<{ laneId: string; parentId: string | null }>;
          }): Promise<ListContainerParentLanesResponse> {
            return {
              results: request.lanes.map(({ laneId, parentId }) => ({
                laneId,
                page:
                  parentId === null
                    ? (rootLanePages.shift() ?? lanePage({}))
                    : lanePage({}),
              })),
            };
          },
        },
        auth: { isAuthenticated: true },
        infra: { dbStatus: "ready", execSql },
        state: { online: true },
        util: { log: () => {} },
      },
    } as unknown as RemoteContainerHydrationState;
    const host = {
      persistContainerState: async () => {
        throw new Error("update path must not run in this scenario");
      },
      updateSnapshot: () => {},
    };
    const hydrate = () =>
      hydrateRemoteContainers({ host, parentIds: [null], state });

    // Pass 1: discovery inserts the container fresh.
    rootLanePages.push(lanePage({ items: [remoteContainerItem(T0)] }));
    await hydrate();
    expect(state.containersById.has("revoked")).toBe(true);

    // A local rename lands in the metadata document and queue.
    const authoredDoc = await createContainerMetadataDocument("revoked");
    writeContainerMetadataValue(authoredDoc, {
      icon: "folder-special",
      name: "Renamed",
    });
    const authoredSnapshot = bytesToBase64(exportAllUpdates(authoredDoc));
    await defaultContainerContentsPersistence.saveContainer(
      execSql,
      {
        effectiveAccessLevel: "write",
        icon: "folder-special",
        id: "revoked",
        metadataDocumentId: "metadata-revoked",
        name: "Renamed",
        organizationId: "peer-organization",
        parentId: null,
      },
      {
        accessEpoch: 1,
        accessStateHash: "access-revoked",
        documentId: "metadata-revoked",
        id: "revoked",
        metadataUpdates: authoredSnapshot,
        snapshotEndVersion: "",
      },
      { localUpdatedAt: T1 },
    );
    await execSql(
      `INSERT INTO document_pending_updates (
        id, app_kind, local_id, update_data,
        partial_start_version_vector, partial_end_version_vector,
        source_version_vector, created_at
      ) VALUES (?, ?, ?, ?, ?, ?, NULL, ?)`,
      [
        "rename-hydration",
        "container-metadata",
        "revoked",
        authoredSnapshot,
        "{}",
        "{}",
        T1,
      ],
    );

    // Pass 2: the access_revoked tombstone cascades through the real
    // applyContainerTombstones path — container gone, metadata dormant.
    rootLanePages.push(
      lanePage({
        tombstones: [
          {
            containerId: "revoked",
            depth: 0,
            parentId: null,
            reason: "access_revoked",
            updatedAt: T2,
          },
        ],
      }),
    );
    await hydrate();
    expect(state.containersById.has("revoked")).toBe(false);
    expect(
      await defaultContainerContentsPersistence.containerExists(
        execSql,
        "revoked",
      ),
    ).toBe(false);
    const dormantListed = await listPendingWrites(execSql);
    expect(dormantListed.some((item) => item.localId === "revoked")).toBe(
      false,
    );

    // Pass 3: access restored — the server lists the container again and the
    // real insert path re-attaches the dormant metadata.
    rootLanePages.push(lanePage({ items: [remoteContainerItem(T3)] }));
    await hydrate();
    const restoredState = state.containersById.get("revoked");
    expect(restoredState?.container.name).toBe("Renamed");
    expect(restoredState?.container.icon).toBe("folder-special");
    expect(restoredState?.record?.metadataUpdates).toBe(authoredSnapshot);
    const restoredListed = await listPendingWrites(execSql);
    expect(restoredListed.some((item) => item.localId === "revoked")).toBe(
      true,
    );
  } finally {
    await close();
  }
});
