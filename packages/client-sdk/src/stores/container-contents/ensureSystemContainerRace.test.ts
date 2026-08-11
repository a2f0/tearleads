import { expect, test } from "bun:test";
import { createMockApiClient } from "@tearleads/test-utils";
import type { ContainerSystemSlot } from "@tearleads/validators/containerSystemSlot";
import type { BlobStore } from "../../data/blobContracts";
import { createContainerMetadataDocument } from "../../data/containers/containerMetadataDocument";
import { defaultDocumentProjectorRegistry } from "../../data/documents/documentKinds";
import type { DomainScope } from "../../data/domainScope";
import type { ExecSql } from "../../data/sqlite/sqlSchema";
import type { ContainerContentsPersistence } from "../../workflows/container-contents/containerPersistence";
import type { ContainerState } from "../../workflows/container-contents/remoteHydration";
import { reconcileLocalOnlySystemContainers } from "../../workflows/container-contents/remoteHydration/reconciliation";
import { ensureSystemContainer } from "./operations";
import { createContainerContentsStoreTestRuntime } from "./runtime.testFixtures";
import {
  createContainerContentsStoreState,
  updateContainerContentsSnapshot,
} from "./state";
import type { ContainerContentsStoreSyncAgent } from "./syncAgent";
import type { ContainerContentsStoreState } from "./types";

const SYSTEM_SLOT =
  "sys_v1_bbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb" as ContainerSystemSlot;

async function containerState(input: {
  id: string;
  organizationId: string;
  parentId: string | null;
  remote: boolean;
  systemSlot?: ContainerSystemSlot | null | undefined;
}): Promise<ContainerState> {
  const metadataDocumentId = input.remote ? `${input.id}-metadata` : null;
  return {
    container: {
      effectiveAccessLevel: "admin",
      icon: null,
      id: input.id,
      metadataDocumentId,
      name: input.parentId === null ? "/" : "Contacts",
      organizationId: input.organizationId,
      parentId: input.parentId,
      systemSlot: input.systemSlot ?? null,
    },
    doc: await createContainerMetadataDocument(input.id),
    record: {
      accessEpoch: 1,
      accessStateHash: input.remote ? `${input.id}-access-state` : null,
      contentKeyBundle: null,
      documentId: metadataDocumentId,
      documentKekTargets: null,
      documentManifestBundle: null,
      id: input.id,
      lastCommitLsn: null,
      metadataUpdates: "",
      snapshotEndVersion: "",
    },
  };
}

test("a late local system create collapses into a remotely hydrated slot", async () => {
  const localRoot = await containerState({
    id: "local-root",
    organizationId: "",
    parentId: null,
    remote: false,
  });
  const remoteRoot = await containerState({
    id: "remote-root",
    organizationId: "organization-id",
    parentId: null,
    remote: true,
  });
  const remoteSystem = await containerState({
    id: "remote-contacts",
    organizationId: "organization-id",
    parentId: remoteRoot.container.id,
    remote: true,
    systemSlot: SYSTEM_SLOT,
  });
  const foreignRoot = await containerState({
    id: "foreign-root",
    organizationId: "foreign-organization",
    parentId: null,
    remote: true,
  });
  const foreignSystem = await containerState({
    id: "foreign-contacts",
    organizationId: "foreign-organization",
    parentId: foreignRoot.container.id,
    remote: true,
    systemSlot: SYSTEM_SLOT,
  });
  let state: ContainerContentsStoreState;
  let createdLocalContainerId: string | null = null;
  const reconciliations: Array<
    Parameters<ContainerContentsPersistence["reconcileLocalSystemContainer"]>[1]
  > = [];
  const persistence = {
    enqueuePendingUpdate: async () => {
      // Remote hydration wins after the local candidate is persisted but before
      // createChildContainerState returns it to ensureSystemContainer.
      // The stale runtime-default root and a foreign shared root both remain;
      // adoption must still resolve against the authenticated organization.
      state.containersById.set(foreignRoot.container.id, foreignRoot);
      state.containersById.set(foreignSystem.container.id, foreignSystem);
      state.containersById.set(remoteRoot.container.id, remoteRoot);
      state.containersById.set(remoteSystem.container.id, remoteSystem);
      updateContainerContentsSnapshot(state);
    },
    reconcileLocalSystemContainer: async (
      _execSql: ExecSql,
      input: (typeof reconciliations)[number],
    ) => {
      reconciliations.push(input);
    },
    saveContainer: async (
      _execSql: ExecSql,
      container: ContainerState["container"],
    ) => {
      createdLocalContainerId = container.id;
      return container;
    },
  } as unknown as ContainerContentsPersistence;
  const runtime = createContainerContentsStoreTestRuntime({
    apiClient: createMockApiClient(),
    auth: {
      isAuthenticated: true,
      organizationId: "organization-id",
      userId: "user-id",
    },
    crypto: {
      encapsulationKeyPair: null,
      signingFingerprint: null,
      signingKeyPair: null,
    },
    infra: {
      blobStore: {} as BlobStore,
      dbStatus: "ready",
      documentProjectors: defaultDocumentProjectorRegistry,
      execSql: (() => Promise.resolve([])) as ExecSql,
    },
    resolveTrustedUserIdentity: async () => null,
    state: {
      containerId: localRoot.container.id,
      domainScope: {} as DomainScope,
      events: [],
      online: true,
    },
    util: {
      log: () => {},
      reportSecurityIncident: async () => undefined,
    },
  });
  state = createContainerContentsStoreState(runtime, persistence);
  state.containersById.set(localRoot.container.id, localRoot);
  updateContainerContentsSnapshot(state);
  const scheduleSyncCalls: string[] = [];
  const syncAgent = {
    scheduleSync: () => scheduleSyncCalls.push("sync"),
  } as unknown as ContainerContentsStoreSyncAgent;

  const ensured = await ensureSystemContainer(
    state,
    syncAgent,
    SYSTEM_SLOT,
    "Contacts",
    { deferRemoteBootstrap: true },
  );

  const persistedLocalContainerId = createdLocalContainerId;
  if (!persistedLocalContainerId) {
    throw new Error("Expected the late local system candidate to be persisted");
  }
  expect(ensured?.id).toBe(remoteSystem.container.id);
  expect(reconciliations).toEqual([
    {
      localContainerId: persistedLocalContainerId,
      remoteContainerId: remoteSystem.container.id,
      remoteOrganizationId: "organization-id",
    },
  ]);
  expect(state.containersById.has(persistedLocalContainerId)).toBe(false);
  expect(state.containersById.has(localRoot.container.id)).toBe(true);
  expect(state.containersById.has(foreignSystem.container.id)).toBe(true);
  expect(
    state.snapshot.nodes
      .filter((node) => node.systemSlot === SYSTEM_SLOT)
      .map((node) => node.id)
      .sort(),
  ).toEqual(["foreign-contacts", "remote-contacts"]);
  expect(scheduleSyncCalls).toEqual([]);
});

test("a root-first late create rebases before its remote system slot arrives", async () => {
  for (const deferRemoteSync of [false, true]) {
    const localRoot = await containerState({
      id: `local-root-${deferRemoteSync}`,
      organizationId: "",
      parentId: null,
      remote: false,
    });
    const remoteRoot = await containerState({
      id: `remote-root-${deferRemoteSync}`,
      organizationId: "organization-id",
      parentId: null,
      remote: true,
    });
    const remoteSystem = await containerState({
      id: `remote-contacts-${deferRemoteSync}`,
      organizationId: "organization-id",
      parentId: remoteRoot.container.id,
      remote: true,
      systemSlot: SYSTEM_SLOT,
    });
    type SaveOptions = Parameters<
      ContainerContentsPersistence["saveContainer"]
    >[3];
    const saves: Array<{
      container: ContainerState["container"];
      options: SaveOptions;
    }> = [];
    const reconciliations: Array<
      Parameters<
        ContainerContentsPersistence["reconcileLocalSystemContainer"]
      >[1]
    > = [];
    let state: ContainerContentsStoreState;
    const persistence = {
      enqueuePendingUpdate: async () => {},
      reconcileLocalSystemContainer: async (
        _execSql: ExecSql,
        input: (typeof reconciliations)[number],
      ) => {
        reconciliations.push(input);
      },
      saveContainer: async (
        _execSql: ExecSql,
        container: ContainerState["container"],
        _record: ContainerState["record"],
        options: SaveOptions,
      ) => {
        saves.push({ container: { ...container }, options });
        if (saves.length === 1) {
          // Root hydration wins after the child captured the pre-auth root, but
          // the same-slot remote child has not reached this peer yet.
          state.containersById.set(remoteRoot.container.id, remoteRoot);
          updateContainerContentsSnapshot(state);
        }
        return container;
      },
    } as unknown as ContainerContentsPersistence;
    const runtime = createContainerContentsStoreTestRuntime({
      apiClient: createMockApiClient(),
      auth: {
        isAuthenticated: true,
        organizationId: "organization-id",
        userId: "user-id",
      },
      crypto: {
        encapsulationKeyPair: null,
        signingFingerprint: null,
        signingKeyPair: null,
      },
      infra: {
        blobStore: {} as BlobStore,
        dbStatus: "ready",
        documentProjectors: defaultDocumentProjectorRegistry,
        execSql: (() => Promise.resolve([])) as ExecSql,
      },
      resolveTrustedUserIdentity: async () => null,
      state: {
        containerId: localRoot.container.id,
        domainScope: {} as DomainScope,
        events: [],
        online: true,
      },
      util: {
        log: () => {},
        reportSecurityIncident: async () => undefined,
      },
    });
    state = createContainerContentsStoreState(runtime, persistence);
    state.containersById.set(localRoot.container.id, localRoot);
    updateContainerContentsSnapshot(state);
    const scheduleSyncCalls: string[] = [];
    const syncAgent = {
      scheduleSync: () => scheduleSyncCalls.push("sync"),
    } as unknown as ContainerContentsStoreSyncAgent;

    const ensured = await ensureSystemContainer(
      state,
      syncAgent,
      SYSTEM_SLOT,
      "Contacts",
      { deferRemoteBootstrap: true, deferRemoteSync },
    );
    const localCandidateId = ensured?.id;
    if (!localCandidateId) {
      throw new Error("Expected a rebased local system candidate");
    }

    expect(ensured).toMatchObject({
      organizationId: "organization-id",
      parentId: remoteRoot.container.id,
      systemSlot: SYSTEM_SLOT,
    });
    expect(saves).toHaveLength(2);
    expect(saves[0]?.container).toMatchObject({
      organizationId: "",
      parentId: localRoot.container.id,
    });
    expect(saves[0]?.options).toEqual(
      deferRemoteSync
        ? undefined
        : { createIntent: { parentContainerId: localRoot.container.id } },
    );
    expect(saves[1]?.container).toMatchObject({
      organizationId: "organization-id",
      parentId: remoteRoot.container.id,
    });
    expect(saves[1]?.options).toEqual(
      deferRemoteSync
        ? undefined
        : { createIntent: { parentContainerId: remoteRoot.container.id } },
    );
    expect(scheduleSyncCalls).toEqual(deferRemoteSync ? [] : ["sync"]);

    state.containersById.set(remoteSystem.container.id, remoteSystem);
    await reconcileLocalOnlySystemContainers({
      remoteSystemState: remoteSystem,
      state,
    });

    expect(reconciliations).toEqual([
      {
        localContainerId: localCandidateId,
        remoteContainerId: remoteSystem.container.id,
        remoteOrganizationId: "organization-id",
        updatedAt: expect.any(String),
      },
    ]);
    expect(state.containersById.has(localCandidateId)).toBe(false);
    expect(state.containersById.has(remoteSystem.container.id)).toBe(true);
  }
});
