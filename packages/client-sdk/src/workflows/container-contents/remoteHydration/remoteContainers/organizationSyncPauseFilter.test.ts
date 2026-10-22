import { expect, test } from "bun:test";
import { createNativeTestExecSql } from "@tearleads/test-utils";
import { cachedContainerHydrationRuntime } from "../../../../../test/helpers/cachedContainerHydrationRuntime";
import { getOrCreateOrganizationSyncPauses } from "../../../../data/sync/organizationSyncPauses";
import { createRemoteContainerIngestor } from "../index";
import type { RemoteContainer, RemoteContainerHydrationState } from "../types";

const folder: RemoteContainer = {
  createdAt: "2026-01-01T00:00:00.000Z",
  effectiveAccessLevel: "write",
  id: "shared-folder",
  metadataAccessEpoch: 1,
  metadataAccessStateHash: "access-shared-folder",
  metadataDocumentId: "metadata-shared-folder",
  metadataReferencedPrincipals: [],
  organizationId: "organization-paused",
  parentId: "unreachable-root",
  systemSlot: null,
  updatedAt: "2026-01-01T00:00:00.000Z",
};

test("a pause landing while a container commits keeps it off the device", async () => {
  const database = createNativeTestExecSql();
  try {
    const runtime = cachedContainerHydrationRuntime([folder], database.execSql);
    // The session works in its own organization; the folder is shared from
    // another one, which this user pauses.
    Object.assign(runtime.auth, { organizationId: "organization-home" });
    const pauses = getOrCreateOrganizationSyncPauses(runtime.state.domainScope);
    const state = {
      containersById: new Map(),
      lifecycleGeneration: 0,
      persistence: {
        // Stands in for the guarded transaction: the pause from another
        // device lands mid-commit, and the commit honors the guard.
        commitHydratedContainer: async (
          _execSql: unknown,
          input: {
            container: { id: string };
            stillCurrent?: () => boolean;
          },
        ) => {
          await pauses.replace(database.execSql, [folder.organizationId]);
          return input.stillCurrent?.() === false
            ? { committed: false as const }
            : { committed: true as const, container: input.container };
        },
        isSupersededContainerBinding: async () => false,
        listPendingCreateIntents: async () => [],
        listUnsyncedMoveIntents: async () => [],
        loadContainerHydrationTombstones: async () => [],
        loadContainerMetadataRecord: async () => null,
        loadContainerMetadataState: async () => null,
        loadHeldContainerBinding: async () => null,
      },
      runtime,
    } as unknown as RemoteContainerHydrationState;
    const ingest = createRemoteContainerIngestor({
      host: {
        persistContainerState: async () => {
          throw new Error("new folders are inserted, not updated");
        },
        updateSnapshot: () => {},
      },
      state,
    });

    await ingest(folder);

    expect(pauses.isOrganizationPaused(folder.organizationId)).toBe(true);
    expect(state.containersById.has(folder.id)).toBe(false);
  } finally {
    database.close();
  }
});
