import { expect, mock, test } from "bun:test";
import { createNativeTestExecSql } from "@tearleads/test-utils";
import { cachedContainerHydrationRuntime } from "../../../../../test/helpers/workflows/cachedContainerHydrationRuntime";
import { ProjectionDependencyUnavailableError } from "../../../../data/shared/dependencyUnavailable";
import { createRemoteContainerIngestor } from "../index";
import type { RemoteContainer, RemoteContainerHydrationState } from "../types";

function listed(id: string): RemoteContainer {
  return {
    createdAt: "2026-01-01T00:00:00.000Z",
    effectiveAccessLevel: "admin",
    id,
    metadataAccessEpoch: 1,
    metadataAccessStateHash: `access-${id}`,
    metadataDocumentId: `metadata-${id}`,
    metadataUpdateCount: 0,
    metadataReferencedPrincipals: [],
    organizationId: "organization-1",
    parentId: "root-1",
    systemSlot: null,
    updatedAt: "2026-01-01T00:00:00.000Z",
  };
}

test("a refused live folder is acknowledged without blocking the batch", async () => {
  const database = createNativeTestExecSql();
  try {
    const refused = listed("held-elsewhere");
    const accepted = listed("new-folder");
    const commitHydratedContainer = mock(
      async (_execSql: unknown, input: { container: { id: string } }) => ({
        committed: true as const,
        container: input.container,
      }),
    );
    const state = {
      containersById: new Map(),
      lifecycleGeneration: 0,
      persistence: {
        commitHydratedContainer,
        listPendingCreateIntents: async () => [],
        listUnsyncedMoveIntents: async () => [],
        loadContainerHydrationTombstones: async () => [],
        loadContainerMetadataRecord: async () => null,
        isSupersededContainerBinding: async () => false,
        // The device holds the first folder under another organization.
        loadHeldContainerBinding: async (_execSql: unknown, id: string) =>
          id === refused.id
            ? {
                metadataDocumentId: refused.metadataDocumentId,
                organizationId: "organization-0",
              }
            : null,
      },
      runtime: cachedContainerHydrationRuntime(
        [refused, accepted],
        database.execSql,
      ),
    } as unknown as RemoteContainerHydrationState;
    const incidents: unknown[] = [];
    Object.assign(state.runtime.util, {
      reportSecurityIncident: async (error: unknown) => {
        incidents.push(error);
      },
    });
    const ingest = createRemoteContainerIngestor({
      host: {
        persistContainerState: async () => {
          throw new Error("new folders are inserted, not updated");
        },
        updateSnapshot: () => {},
      },
      state,
    });

    await Promise.all([ingest(refused), ingest(accepted)]);

    expect(incidents).toMatchObject([{ code: "object_mismatch" }]);
    expect(
      commitHydratedContainer.mock.calls.map(([, input]) => input.container.id),
    ).toEqual([accepted.id]);
    expect(state.containersById.has(accepted.id)).toBe(true);
    expect(state.containersById.has(refused.id)).toBe(false);
    expect(ingest.hasPending()).toBe(false);
  } finally {
    database.close();
  }
});

test.each(["retired", "dependency unavailable"])(
  "queued ingestion honors %s during upsert",
  async (scenario) => {
    const database = createNativeTestExecSql();
    const item = listed("new-folder");
    const started = Promise.withResolvers<void>();
    const release = Promise.withResolvers<void>();
    const unavailable = new ProjectionDependencyUnavailableError("temporary");
    let live = true;
    let first = true;
    const commitHydratedContainer = mock(
      async (_sql: unknown, input: { container: { id: string } }) => ({
        committed: true,
        container: input.container,
      }),
    );
    const state = {
      containersById: new Map(),
      lifecycleGeneration: 0,
      structuralGeneration: 0,
      persistence: {
        commitHydratedContainer,
        listPendingCreateIntents: async () => [],
        listUnsyncedMoveIntents: async () => [],
        loadContainerHydrationTombstones: async () => [],
        loadContainerMetadataRecord: async () => null,
        isSupersededContainerBinding: async () => false,
        loadHeldContainerBinding: async () => {
          if (first) {
            first = false;
            started.resolve();
            await release.promise;
            if (scenario === "dependency unavailable") throw unavailable;
          }
          return null;
        },
      },
      runtime: cachedContainerHydrationRuntime([item], database.execSql),
    } as unknown as RemoteContainerHydrationState;
    try {
      const input = {
        ownsScope: () => live,
        state,
        host: {
          persistContainerState: async () => {
            throw new Error("new folder must insert");
          },
          updateSnapshot: () => {},
        },
      };
      const ingest = createRemoteContainerIngestor(input);
      const pending = ingest(item);
      await started.promise;
      if (scenario === "retired") {
        live = false;
        state.lifecycleGeneration = 1;
      }
      release.resolve();
      if (live) {
        await expect(pending).rejects.toBe(unavailable);
        expect(ingest.hasPending()).toBe(true);
        await ingest.resume();
        expect(commitHydratedContainer).toHaveBeenCalledTimes(1);
      } else {
        await pending;
        await ingest.resume();
        expect(commitHydratedContainer).not.toHaveBeenCalled();
      }
      expect(ingest.hasPending()).toBe(false);
    } finally {
      release.resolve();
      database.close();
    }
  },
);
