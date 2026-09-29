import { expect, test } from "bun:test";
import { createNativeTestExecSql } from "@tearleads/test-utils";
import {
  createMetadataBindingFixture,
  installForeignOrganizationBinding,
  installOrganizationBinding,
} from "../../../../test/helpers/containerMetadataBinding";
import { loadAccessManifestCheckpoint } from "../../../data/persistence/keyingCheckpointPersistence";
import type { ExecSql } from "../../../data/sqlite/sqlSchema";
import { defaultContainerContentsPersistence as persistence } from "../containerPersistence";
import { renameContainerMetadataStateFromRuntime } from "../metadataPersistence";
import { upsertRemoteContainerState } from "../remoteContainerState";
import { cachedDestinationRole } from "./destinationRoleCache";
import type { ContainerState, RemoteContainerHydrationState } from "./types";

/** Pins for the held folder and for the foreign organization's claim to it. */
function readCheckpoints(
  execSql: ExecSql,
  fixture: Awaited<ReturnType<typeof createMetadataBindingFixture>>,
) {
  return Promise.all(
    [fixture.projection.organizationId, "foreign-organization"].map(
      (organizationId) =>
        loadAccessManifestCheckpoint(
          execSql,
          "container",
          organizationId,
          fixture.listed.id,
        ),
    ),
  );
}

async function hydrateWithQueuedRename(execSql: ExecSql) {
  const fixture = await createMetadataBindingFixture(execSql);
  const hydrated = await fixture.hydrate();
  if (!hydrated) throw new Error("Expected initial hydration");
  const renamed = await renameContainerMetadataStateFromRuntime({
    metadataState: hydrated,
    name: "Private queued rename",
    persistence,
    runtime: fixture.state.runtime,
  });
  if (!renamed) throw new Error("Expected a durable rename");
  hydrated.container = renamed.container;
  hydrated.record = renamed.record;
  const pending = await persistence.listPendingUpdates(
    execSql,
    fixture.listed.id,
  );
  expect(pending.length).toBeGreaterThan(0);
  return { fixture, hydrated, pending };
}

async function expectHeldBinding(input: {
  execSql: ExecSql;
  fixture: Awaited<ReturnType<typeof createMetadataBindingFixture>>;
  organizationId: string;
  pending: Awaited<ReturnType<typeof persistence.listPendingUpdates>>;
}) {
  const { execSql, fixture } = input;
  const stored = await persistence.loadContainerMetadataState(
    execSql,
    fixture.listed.id,
  );
  expect(stored?.container).toMatchObject({
    metadataDocumentId: fixture.metadataDocumentId,
    name: "Private queued rename",
    organizationId: input.organizationId,
  });
  expect(stored?.record?.documentId).toBe(fixture.metadataDocumentId);
  expect(
    await persistence.listPendingUpdates(execSql, fixture.listed.id),
  ).toEqual(input.pending);
}

test("a foreign organization cannot rebind a held folder or its queued rename", async () => {
  const { execSql, close } = createNativeTestExecSql();
  try {
    const { fixture, hydrated, pending } =
      await hydrateWithQueuedRename(execSql);
    const organizationId = hydrated.container.organizationId;
    const foreign = await installForeignOrganizationBinding(fixture);
    const checkpoints = await readCheckpoints(execSql, fixture);
    foreign.relist();

    await expect(fixture.hydrate()).rejects.toMatchObject({
      code: "object_mismatch",
    });
    expect(fixture.incidents).toHaveLength(1);
    // Fetched once to learn its creator, then refused without caching.
    expect(foreign.reads()).toBe(1);
    expect(await readCheckpoints(execSql, fixture)).toEqual(checkpoints);
    expect(
      cachedDestinationRole(execSql, {
        id: fixture.listed.id,
        organizationId: "foreign-organization",
      }),
    ).toBeUndefined();
    expect(hydrated.container.organizationId).toBe(organizationId);
    expect(hydrated.record.documentId).toBe(fixture.metadataDocumentId);
    await expectHeldBinding({ execSql, fixture, organizationId, pending });
  } finally {
    close();
  }
});

test("a restarted store refuses the rebinding from its durable binding", async () => {
  const { execSql, close } = createNativeTestExecSql();
  try {
    const { fixture, hydrated, pending } =
      await hydrateWithQueuedRename(execSql);
    const organizationId = hydrated.container.organizationId;
    const foreign = await installForeignOrganizationBinding(fixture);
    fixture.state.containersById.clear();
    foreign.relist();

    await expect(fixture.hydrate()).rejects.toMatchObject({
      code: "object_mismatch",
    });
    expect(fixture.incidents).toHaveLength(1);
    // Fetched once to learn its creator, then refused without caching.
    expect(foreign.reads()).toBe(1);
    expect(fixture.state.containersById.size).toBe(0);
    await expectHeldBinding({ execSql, fixture, organizationId, pending });
  } finally {
    close();
  }
});

test("retained dormant metadata keeps its organization across a relisting", async () => {
  const { execSql, close } = createNativeTestExecSql();
  try {
    const { fixture, hydrated, pending } =
      await hydrateWithQueuedRename(execSql);
    await persistence.deleteContainers(
      execSql,
      [
        {
          containerId: fixture.listed.id,
          reason: "access_revoked",
          updatedAt: fixture.listed.updatedAt,
        },
      ],
      { discoveryOnly: true },
    );
    fixture.state.containersById.clear();
    const retained = await persistence.loadContainerMetadataRecord(
      execSql,
      fixture.listed.id,
    );
    expect(retained?.documentId).toBe(fixture.metadataDocumentId);
    const foreign = await installForeignOrganizationBinding(fixture);
    const checkpoints = await readCheckpoints(execSql, fixture);
    foreign.relist();

    // The revocation fence makes this a placement-refreshing recovery.
    await expect(fixture.hydrate()).rejects.toMatchObject({
      code: "object_mismatch",
    });
    // Fetched once to learn its creator, then refused without caching.
    expect(foreign.reads()).toBe(1);
    expect(await readCheckpoints(execSql, fixture)).toEqual(checkpoints);
    expect(
      await persistence.loadHeldContainerBinding(execSql, fixture.listed.id),
    ).toEqual({
      metadataDocumentId: fixture.metadataDocumentId,
      organizationId: hydrated.container.organizationId,
    });
    expect(
      await persistence.loadContainerMetadataRecord(execSql, fixture.listed.id),
    ).toEqual(retained);
    expect(
      await persistence.listPendingUpdates(execSql, fixture.listed.id),
    ).toEqual(pending);
    expect(await persistence.containerExists(execSql, fixture.listed.id)).toBe(
      false,
    );
  } finally {
    close();
  }
});

for (const target of ["another", "the same"] as const) {
  test(`a concurrent insert naming ${target} metadata target cannot adopt a committed binding`, async () => {
    const { execSql, close } = createNativeTestExecSql();
    try {
      const fixture = await createMetadataBindingFixture(execSql);
      const foreign = await installForeignOrganizationBinding(
        fixture,
        target === "the same" ? fixture.metadataDocumentId : undefined,
      );
      const ownListing = { ...fixture.listed };
      // Another store over the same database has not seen the folder yet.
      const racingState: RemoteContainerHydrationState = {
        ...fixture.state,
        containersById: new Map<string, ContainerState>(),
      };
      const runtime = fixture.state.runtime;
      const serveForeign = runtime.apiClient.getContainerWriterProjection;
      let releaseForeign: () => void = () => {};
      const foreignRequested = new Promise<void>((requested) => {
        runtime.apiClient.getContainerWriterProjection = async (
          containerId,
        ) => {
          requested();
          await new Promise<void>((release) => {
            releaseForeign = release;
          });
          return serveForeign(containerId);
        };
      });
      foreign.relist();
      const foreignListing = { ...fixture.listed };
      const racing = upsertRemoteContainerState({
        containerIdsWithPendingMetadataUpdates: new Set(),
        containerIdsWithPendingStructuralIntents: new Set(),
        host: {
          persistContainerState: async () => {
            throw new Error("A new folder is inserted, not updated");
          },
          updateSnapshot: () => {},
        },
        remoteContainer: foreignListing,
        state: racingState,
      });
      await foreignRequested;

      Object.assign(fixture.listed, ownListing);
      runtime.apiClient.getContainerWriterProjection = serveForeign;
      const own = await fixture.hydrate();
      expect(own?.record.documentId).toBe(fixture.metadataDocumentId);
      Object.assign(fixture.listed, foreignListing);
      releaseForeign();

      await expect(racing).rejects.toMatchObject({ code: "object_mismatch" });
      expect(fixture.incidents).toHaveLength(1);
      expect(racingState.containersById.size).toBe(0);
      const stored = await persistence.loadContainerMetadataState(
        execSql,
        fixture.listed.id,
      );
      expect(stored?.container).toMatchObject({
        metadataDocumentId: fixture.metadataDocumentId,
        organizationId: ownListing.organizationId,
      });
    } finally {
      close();
    }
  });
}

test("the session user's own re-home moves a held folder with its queued rename", async () => {
  const { execSql, close } = createNativeTestExecSql();
  try {
    const { fixture, pending } = await hydrateWithQueuedRename(execSql);
    // Purged-organization recovery on another device re-created the folder
    // under its existing id in the replacement organization.
    const replacement = await installOrganizationBinding(fixture, {
      metadataDocumentId: "replacement-metadata",
      organizationId: "replacement-organization",
      signer: "session-user",
    });
    replacement.relist();

    const reHomed = await fixture.hydrate();

    expect(fixture.incidents).toHaveLength(0);
    expect(replacement.reads()).toBe(1);
    expect(reHomed?.container).toMatchObject({
      metadataDocumentId: "replacement-metadata",
      name: "Private queued rename",
      organizationId: "replacement-organization",
    });
    const stored = await persistence.loadContainerMetadataState(
      execSql,
      fixture.listed.id,
    );
    expect(stored?.container.organizationId).toBe("replacement-organization");
    expect(stored?.record).toMatchObject({
      accessEpoch: fixture.listed.metadataAccessEpoch,
      documentId: "replacement-metadata",
      lastCommitLsn: null,
    });
    expect(
      await persistence.listPendingUpdates(execSql, fixture.listed.id),
    ).toEqual(pending);
  } finally {
    close();
  }
});

test("retained metadata follows the session user's own re-home", async () => {
  const { execSql, close } = createNativeTestExecSql();
  try {
    const { fixture, pending } = await hydrateWithQueuedRename(execSql);
    await persistence.deleteContainers(
      execSql,
      [
        {
          containerId: fixture.listed.id,
          reason: "access_revoked",
          updatedAt: fixture.listed.updatedAt,
        },
      ],
      { discoveryOnly: true },
    );
    fixture.state.containersById.clear();
    const replacement = await installOrganizationBinding(fixture, {
      metadataDocumentId: fixture.metadataDocumentId,
      organizationId: "replacement-organization",
      signer: "session-user",
    });
    replacement.relist();

    const reHomed = await fixture.hydrate();

    expect(fixture.incidents).toHaveLength(0);
    expect(reHomed?.container).toMatchObject({
      name: "Private queued rename",
      organizationId: "replacement-organization",
    });
    expect(
      await persistence.loadHeldContainerBinding(execSql, fixture.listed.id),
    ).toMatchObject({
      metadataDocumentId: fixture.metadataDocumentId,
      organizationId: "replacement-organization",
    });
    expect(
      await persistence.listPendingUpdates(execSql, fixture.listed.id),
    ).toEqual(pending);
  } finally {
    close();
  }
});

test("a foreign signer cannot retarget a live folder within its organization", async () => {
  const { execSql, close } = createNativeTestExecSql();
  try {
    const { fixture, hydrated, pending } =
      await hydrateWithQueuedRename(execSql);
    const organizationId = hydrated.container.organizationId;
    const foreign = await installOrganizationBinding(fixture, {
      metadataDocumentId: "foreign-metadata",
      organizationId,
      signer: "foreign-owner",
    });
    foreign.relist();
    // A cold role cache forces the conflicting proof to be fetched.
    const coldExecSql = ((...args: unknown[]) =>
      Reflect.apply(execSql, undefined, args)) as unknown as ExecSql;
    Object.assign(fixture.state.runtime.infra, { execSql: coldExecSql });

    await expect(fixture.hydrate()).rejects.toMatchObject({
      code: "object_mismatch",
    });
    expect(foreign.reads()).toBe(1);
    expect(fixture.incidents).toHaveLength(1);
    await expectHeldBinding({ execSql, fixture, organizationId, pending });
  } finally {
    close();
  }
});
