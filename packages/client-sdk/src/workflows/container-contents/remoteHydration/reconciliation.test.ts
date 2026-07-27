import { expect, test } from "bun:test";
import { createContainerMetadataDocument } from "../../../data/containers/containerMetadataDocument";
import { createDomainScope } from "../../../data/domainScope";
import type { ExecSql } from "../../../data/sqlite/sqlSchema";
import type { ContainerContentsPersistence } from "../containerPersistence";
import type { ContainerContentsRootAdoptionInput } from "../runtime";
import {
  reconcileLocalOnlyRootContainers,
  reconcileLocalOnlySystemContainers,
} from "./reconciliation";
import type { ContainerState, RemoteContainerHydrationState } from "./types";

const ORGANIZATION_ID = "remote-organization";
const SYSTEM_SLOT = "sys_v1_recovered_contacts";

async function containerState(input: {
  id: string;
  organizationId: string;
  parentId: string | null;
  remote: boolean;
  systemSlot?: string | null | undefined;
}): Promise<ContainerState> {
  const doc = await createContainerMetadataDocument(input.id);
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
    doc,
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

async function reconciliationFixture() {
  const rootReconciliations: Array<
    Parameters<ContainerContentsPersistence["reconcileLocalRootContainer"]>[1]
  > = [];
  const systemReconciliations: Array<
    Parameters<ContainerContentsPersistence["reconcileLocalSystemContainer"]>[1]
  > = [];
  const rootAdoptions: ContainerContentsRootAdoptionInput[] = [];
  const persistence = {
    reconcileLocalRootContainer: async (
      _execSql: ExecSql,
      input: (typeof rootReconciliations)[number],
    ) => {
      rootReconciliations.push(input);
    },
    reconcileLocalSystemContainer: async (
      _execSql: ExecSql,
      input: (typeof systemReconciliations)[number],
    ) => {
      systemReconciliations.push(input);
    },
  } as unknown as ContainerContentsPersistence;
  const state = {
    containersById: new Map<string, ContainerState>(),
    persistence,
    runtime: {
      adoptRootContainer: (input: ContainerContentsRootAdoptionInput) => {
        rootAdoptions.push(input);
        return true;
      },
      auth: {
        defaultOrganizationId: "personal-organization",
        isAuthenticated: true,
        organizationId: ORGANIZATION_ID,
        userId: "user-1",
      },
      infra: { execSql: (() => Promise.resolve([])) as ExecSql },
      state: {
        containerId: "local-root",
        domainScope: createDomainScope(),
      },
      util: { log: () => undefined },
    },
  } as unknown as RemoteContainerHydrationState;

  const localRoot = await containerState({
    id: "local-root",
    organizationId: "",
    parentId: null,
    remote: false,
  });
  const localSystem = await containerState({
    id: "local-contacts",
    organizationId: "",
    parentId: localRoot.container.id,
    remote: false,
    systemSlot: SYSTEM_SLOT,
  });
  const remoteRoot = await containerState({
    id: "remote-root",
    organizationId: ORGANIZATION_ID,
    parentId: null,
    remote: true,
  });
  const remoteSystem = await containerState({
    id: "remote-contacts",
    organizationId: ORGANIZATION_ID,
    parentId: remoteRoot.container.id,
    remote: true,
    systemSlot: SYSTEM_SLOT,
  });
  for (const container of [localRoot, localSystem, remoteRoot]) {
    state.containersById.set(container.container.id, container);
  }

  return {
    localRoot,
    localSystem,
    remoteRoot,
    remoteSystem,
    rootAdoptions,
    rootReconciliations,
    state,
    systemReconciliations,
  };
}

test("local system reconciliation converges regardless of remote page ordering", async () => {
  for (const remoteSystemFirst of [true, false]) {
    const fixture = await reconciliationFixture();
    let documentPrimingRequests = 0;
    if (remoteSystemFirst) {
      fixture.state.containersById.set(
        fixture.remoteSystem.container.id,
        fixture.remoteSystem,
      );
    }

    await reconcileLocalOnlyRootContainers({
      remoteRootState: fixture.remoteRoot,
      requestDocumentPriming: () => {
        documentPrimingRequests += 1;
      },
      state: fixture.state,
    });

    if (!remoteSystemFirst) {
      fixture.state.containersById.set(
        fixture.remoteSystem.container.id,
        fixture.remoteSystem,
      );
      await reconcileLocalOnlySystemContainers({
        requestDocumentPriming: () => {
          documentPrimingRequests += 1;
        },
        remoteSystemState: fixture.remoteSystem,
        state: fixture.state,
      });
    }

    expect(
      fixture.state.containersById.has(fixture.localRoot.container.id),
    ).toBe(false);
    expect(
      fixture.state.containersById.has(fixture.localSystem.container.id),
    ).toBe(false);
    expect(Array.from(fixture.state.containersById.keys()).sort()).toEqual([
      "remote-contacts",
      "remote-root",
    ]);
    expect(fixture.rootReconciliations).toHaveLength(1);
    expect(documentPrimingRequests).toBe(remoteSystemFirst ? 1 : 2);
    expect(fixture.systemReconciliations).toHaveLength(1);
    expect(fixture.rootReconciliations[0]).toMatchObject({
      descendantReparents: [
        {
          containerId: "local-contacts",
          parentContainerId: "remote-root",
          updateCreateIntent: true,
        },
      ],
      localRootContainerId: "local-root",
      remoteRootContainerId: "remote-root",
    });
    expect(fixture.systemReconciliations[0]).toMatchObject({
      localContainerId: "local-contacts",
      remoteContainerId: "remote-contacts",
      remoteOrganizationId: ORGANIZATION_ID,
    });
  }
});

test("root reconciliation requests priming after known system twins converge", async () => {
  const fixture = await reconciliationFixture();
  fixture.state.containersById.set(
    fixture.remoteSystem.container.id,
    fixture.remoteSystem,
  );
  const events: string[] = [];
  fixture.state.persistence.reconcileLocalSystemContainer = async () => {
    events.push("system-reconciled");
  };

  await reconcileLocalOnlyRootContainers({
    remoteRootState: fixture.remoteRoot,
    requestDocumentPriming: () => {
      events.push("priming-requested");
    },
    state: fixture.state,
  });

  expect(events).toEqual(["system-reconciled", "priming-requested"]);
});

test("root reconciliation adopts the exact active secondary-org root", async () => {
  const fixture = await reconciliationFixture();

  await reconcileLocalOnlyRootContainers({
    remoteRootState: fixture.remoteRoot,
    state: fixture.state,
  });

  expect(fixture.rootAdoptions).toEqual([
    {
      domainScope: fixture.state.runtime.state.domainScope,
      expectedContainerId: "local-root",
      nextContainerId: "remote-root",
      organizationId: ORGANIZATION_ID,
      userId: "user-1",
    },
  ]);
});

test("system-only reconciliation requests document priming", async () => {
  const fixture = await reconciliationFixture();
  fixture.state.containersById.delete(fixture.localRoot.container.id);
  fixture.localSystem.container = {
    ...fixture.localSystem.container,
    parentId: "deleted-local-root",
  };
  let documentPrimingRequests = 0;

  await reconcileLocalOnlySystemContainers({
    requestDocumentPriming: () => {
      documentPrimingRequests += 1;
    },
    remoteSystemState: fixture.remoteSystem,
    state: fixture.state,
  });

  expect(fixture.systemReconciliations).toHaveLength(1);
  expect(documentPrimingRequests).toBe(1);
});

test("home system reconciliation heals pre-auth candidates with stale parents", async () => {
  for (const parentState of ["missing", "local-root"] as const) {
    const fixture = await reconciliationFixture();
    fixture.state.containersById.clear();
    const staleParentId =
      parentState === "local-root"
        ? fixture.localRoot.container.id
        : "deleted-local-root";
    fixture.localSystem.container = {
      ...fixture.localSystem.container,
      parentId: staleParentId,
    };
    if (parentState === "local-root") {
      fixture.state.containersById.set(
        fixture.localRoot.container.id,
        fixture.localRoot,
      );
    }
    fixture.state.containersById.set(
      fixture.localSystem.container.id,
      fixture.localSystem,
    );
    fixture.state.containersById.set(
      fixture.remoteSystem.container.id,
      fixture.remoteSystem,
    );

    await reconcileLocalOnlySystemContainers({
      remoteSystemState: fixture.remoteSystem,
      state: fixture.state,
    });

    expect(
      fixture.state.containersById.has(fixture.localSystem.container.id),
    ).toBe(false);
    expect(fixture.systemReconciliations).toHaveLength(1);
    expect(fixture.systemReconciliations[0]).toMatchObject({
      localContainerId: fixture.localSystem.container.id,
      remoteContainerId: fixture.remoteSystem.container.id,
      remoteOrganizationId: ORGANIZATION_ID,
    });
  }
});

test("orphan healing never adopts a foreign candidate or remote target", async () => {
  const foreignOrganizationId = "foreign-organization";
  for (const foreignSide of ["candidate", "target"] as const) {
    const fixture = await reconciliationFixture();
    let documentPrimingRequests = 0;
    fixture.state.containersById.clear();
    fixture.localSystem.container = {
      ...fixture.localSystem.container,
      organizationId: foreignSide === "candidate" ? foreignOrganizationId : "",
      parentId: "deleted-local-root",
    };
    fixture.remoteSystem.container = {
      ...fixture.remoteSystem.container,
      organizationId:
        foreignSide === "target" ? foreignOrganizationId : ORGANIZATION_ID,
    };
    fixture.state.containersById.set(
      fixture.localSystem.container.id,
      fixture.localSystem,
    );
    fixture.state.containersById.set(
      fixture.remoteSystem.container.id,
      fixture.remoteSystem,
    );

    await reconcileLocalOnlySystemContainers({
      requestDocumentPriming: () => {
        documentPrimingRequests += 1;
      },
      remoteSystemState: fixture.remoteSystem,
      state: fixture.state,
    });

    expect(
      fixture.state.containersById.has(fixture.localSystem.container.id),
    ).toBe(true);
    expect(fixture.systemReconciliations).toHaveLength(0);
    expect(documentPrimingRequests).toBe(0);
  }
});
