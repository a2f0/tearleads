import { expect, mock, test } from "bun:test";
import { cachedContainerHydrationRuntime } from "../../../test/helpers/cachedContainerHydrationRuntime";
import { createRemoteContainerIngestor } from "./remoteHydration";
import type {
  RemoteContainer,
  RemoteContainerHydrationState,
} from "./remoteHydration/types";

function listed(id: string): RemoteContainer {
  return {
    createdAt: "2026-01-01T00:00:00.000Z",
    effectiveAccessLevel: "admin",
    id,
    metadataAccessEpoch: 1,
    metadataAccessStateHash: `access-${id}`,
    metadataDocumentId: `metadata-${id}`,
    metadataReferencedPrincipals: [],
    organizationId: "organization-1",
    parentId: "root-1",
    systemSlot: null,
    updatedAt: "2026-01-01T00:00:00.000Z",
  };
}

test("a refused live folder is acknowledged without blocking the batch", async () => {
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
      // The device holds the first folder under another organization.
      loadHeldContainerBinding: async (_execSql: unknown, id: string) =>
        id === refused.id
          ? {
              metadataDocumentId: refused.metadataDocumentId,
              organizationId: "organization-0",
            }
          : null,
    },
    runtime: cachedContainerHydrationRuntime([refused, accepted]),
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
});
