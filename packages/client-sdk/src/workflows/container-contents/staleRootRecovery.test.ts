import { expect, test } from "bun:test";
import { createTestExecSql } from "@tearleads/test-utils";
import { createDomainScope } from "../../data/domainScope";
import { sqlDocumentMoveIntentPersistence } from "../../data/persistence/container-contents/documentMoveIntentPersistence";
import { sqlDocumentsPersistence } from "../../data/persistence/documents/documentsPersistence";
import type { ExecSql } from "../../data/sqlite/sqlSchema";
import {
  type ContainerContentsPersistence,
  defaultContainerContentsPersistence,
} from "./containerPersistence";
import { primeDocumentsForLoadedRoots } from "./documentPriming";
import { saveTestDocument } from "./documentQueries.testFixtures";
import type { ContainerState } from "./remoteHydration";
import type {
  ContainerContentsRootAdopter,
  ContainerContentsRootAdoptionInput,
} from "./runtime";
import { recoverStaleSessionRoot } from "./staleRootRecovery";

const ORGANIZATION_ID = "organization-1";

function remoteRoot(input: {
  effectiveAccessLevel?:
    | ContainerState["container"]["effectiveAccessLevel"]
    | undefined;
  id: string;
  organizationId?: string | undefined;
  systemSlot?: ContainerState["container"]["systemSlot"] | undefined;
}): ContainerState {
  return {
    container: {
      effectiveAccessLevel: input.effectiveAccessLevel ?? "admin",
      id: input.id,
      metadataDocumentId: `${input.id}-metadata`,
      organizationId: input.organizationId ?? ORGANIZATION_ID,
      parentId: null,
      systemSlot: input.systemSlot ?? null,
    },
    record: {
      accessStateHash: `${input.id}-access-state`,
      documentId: `${input.id}-metadata`,
    },
  } as unknown as ContainerState;
}

function createFixture() {
  const domainScope = createDomainScope();
  const reassignments: Array<{
    fromContainerId: string;
    toContainerId: string;
  }> = [];
  const adoptions: ContainerContentsRootAdoptionInput[] = [];
  const persistedContainerIds = new Set<string>();
  let adoptionResult: ReturnType<ContainerContentsRootAdopter> = true;
  const adoptRootContainer: ContainerContentsRootAdopter = (input) => {
    adoptions.push(input);
    return adoptionResult;
  };
  let containerExistsEffect: () => void = () => undefined;
  const state = {
    containersById: new Map<string, ContainerState>([
      ["remote-root", remoteRoot({ id: "remote-root" })],
    ]),
    persistence: {
      containerExists: async (_execSql: ExecSql, containerId: string) => {
        containerExistsEffect();
        return persistedContainerIds.has(containerId);
      },
      reassignContainerDocuments: async (
        _execSql: ExecSql,
        input: { fromContainerId: string; toContainerId: string },
      ) => {
        reassignments.push(input);
      },
    } as Pick<
      ContainerContentsPersistence,
      "containerExists" | "reassignContainerDocuments"
    >,
    rootLaneHydrated: true,
    runtime: {
      adoptRootContainer,
      auth: {
        defaultOrganizationId: ORGANIZATION_ID,
        isAuthenticated: true,
        organizationId: ORGANIZATION_ID,
        userId: "user-1",
      },
      infra: { execSql: (() => Promise.resolve([])) as ExecSql },
      state: { containerId: "deleted-local-root", domainScope },
    },
  };

  return {
    adoptions,
    persistedContainerIds,
    reassignments,
    disableAdoption() {
      Reflect.set(state.runtime, "adoptRootContainer", undefined);
    },
    setAdoptionResult(value: ReturnType<ContainerContentsRootAdopter>) {
      adoptionResult = value;
    },
    setContainerExistsEffect(effect: () => void) {
      containerExistsEffect = effect;
    },
    state,
  };
}

test("stale root recovery rehomes documents and adopts the remote root", async () => {
  const fixture = createFixture();

  await expect(recoverStaleSessionRoot(fixture.state)).resolves.toEqual({
    candidateCount: 1,
    reassigned: true,
    status: "reassigned",
  });
  expect(fixture.reassignments).toEqual([
    {
      fromContainerId: "deleted-local-root",
      toContainerId: "remote-root",
    },
  ]);
  expect(fixture.adoptions).toEqual([
    {
      domainScope: fixture.state.runtime.state.domainScope,
      expectedContainerId: "deleted-local-root",
      nextContainerId: "remote-root",
      organizationId: ORGANIZATION_ID,
      userId: "user-1",
    },
  ]);
});

test("stale root recovery refuses ambiguous or foreign roots", async () => {
  const fixture = createFixture();
  fixture.state.containersById.set(
    "other-root",
    remoteRoot({ id: "other-root" }),
  );
  fixture.state.containersById.set(
    "foreign-root",
    remoteRoot({ id: "foreign-root", organizationId: "foreign-org" }),
  );

  await expect(recoverStaleSessionRoot(fixture.state)).resolves.toEqual({
    candidateCount: 2,
    reassigned: false,
    status: "ambiguous",
  });
  expect(fixture.reassignments).toEqual([]);
  expect(fixture.adoptions).toEqual([]);
});

test("stale root recovery refuses granted and system roots", async () => {
  const fixture = createFixture();
  fixture.state.containersById.clear();
  fixture.state.containersById.set(
    "granted-root",
    remoteRoot({ effectiveAccessLevel: "read", id: "granted-root" }),
  );
  fixture.state.containersById.set(
    "system-root",
    remoteRoot({ id: "system-root", systemSlot: "sys_v1_recovered_root" }),
  );

  await expect(recoverStaleSessionRoot(fixture.state)).resolves.toEqual({
    candidateCount: 0,
    reassigned: false,
    status: "ambiguous",
  });
  expect(fixture.reassignments).toEqual([]);
  expect(fixture.adoptions).toEqual([]);
});

test("stale root recovery only runs in the personal organization", async () => {
  const fixture = createFixture();
  fixture.state.runtime.auth.defaultOrganizationId = "personal-organization";

  await expect(recoverStaleSessionRoot(fixture.state)).resolves.toEqual({
    candidateCount: 0,
    reassigned: false,
    status: "not-needed",
  });
  expect(fixture.reassignments).toEqual([]);
  expect(fixture.adoptions).toEqual([]);
});

test("stale root recovery waits for the authoritative root lane", async () => {
  const fixture = createFixture();
  fixture.state.rootLaneHydrated = false;

  await expect(recoverStaleSessionRoot(fixture.state)).resolves.toEqual({
    candidateCount: 0,
    reassigned: false,
    status: "not-needed",
  });
  expect(fixture.reassignments).toEqual([]);
  expect(fixture.adoptions).toEqual([]);
});

test("stale root recovery reports when no authoritative root is loaded", async () => {
  const fixture = createFixture();
  fixture.state.containersById.clear();

  await expect(recoverStaleSessionRoot(fixture.state)).resolves.toEqual({
    candidateCount: 0,
    reassigned: false,
    status: "ambiguous",
  });
  expect(fixture.reassignments).toEqual([]);
  expect(fixture.adoptions).toEqual([]);
});

test("stale root recovery reports a missing adoption capability", async () => {
  const fixture = createFixture();
  fixture.disableAdoption();

  await expect(recoverStaleSessionRoot(fixture.state)).resolves.toEqual({
    candidateCount: 1,
    reassigned: false,
    status: "unsupported",
  });
  expect(fixture.reassignments).toEqual([]);
  expect(fixture.adoptions).toEqual([]);
});

test("stale root recovery does nothing while the session root is live", async () => {
  const fixture = createFixture();
  fixture.state.containersById.set(
    "deleted-local-root",
    remoteRoot({ id: "deleted-local-root" }),
  );

  await expect(recoverStaleSessionRoot(fixture.state)).resolves.toEqual({
    candidateCount: 0,
    reassigned: false,
    status: "not-needed",
  });
  expect(fixture.reassignments).toEqual([]);
});

test("stale root recovery ignores a durable root missing from a partial topology", async () => {
  const fixture = createFixture();
  fixture.persistedContainerIds.add("deleted-local-root");

  await expect(recoverStaleSessionRoot(fixture.state)).resolves.toEqual({
    candidateCount: 0,
    reassigned: false,
    status: "not-needed",
  });
  expect(fixture.reassignments).toEqual([]);
  expect(fixture.adoptions).toEqual([]);
});

const changedRecoveryContexts: ReadonlyArray<
  readonly [
    name: string,
    mutate: (state: ReturnType<typeof createFixture>["state"]) => void,
  ]
> = [
  ["authentication", (state) => (state.runtime.auth.isAuthenticated = false)],
  ["container", (state) => (state.runtime.state.containerId = "another-root")],
  [
    "default organization",
    (state) =>
      (state.runtime.auth.defaultOrganizationId = "another-organization"),
  ],
  [
    "domain scope",
    (state) => (state.runtime.state.domainScope = createDomainScope()),
  ],
  [
    "organization",
    (state) => (state.runtime.auth.organizationId = "another-organization"),
  ],
  ["user", (state) => (state.runtime.auth.userId = "another-user")],
];

for (const [name, mutate] of changedRecoveryContexts) {
  test(`stale root recovery stops when ${name} changes during lookup`, async () => {
    const fixture = createFixture();
    fixture.setContainerExistsEffect(() => mutate(fixture.state));

    await expect(recoverStaleSessionRoot(fixture.state)).resolves.toEqual({
      candidateCount: 0,
      reassigned: false,
      status: "context-changed",
    });
    expect(fixture.reassignments).toEqual([]);
    expect(fixture.adoptions).toEqual([]);
  });
}

test("stale root recovery rechecks context after candidate selection", async () => {
  const fixture = createFixture();
  const values = fixture.state.containersById.values.bind(
    fixture.state.containersById,
  );
  fixture.state.containersById.values = () => {
    fixture.state.runtime.auth.userId = "another-user";
    return values();
  };

  await expect(recoverStaleSessionRoot(fixture.state)).resolves.toEqual({
    candidateCount: 0,
    reassigned: false,
    status: "context-changed",
  });
  expect(fixture.reassignments).toEqual([]);
  expect(fixture.adoptions).toEqual([]);
});

test("stale root recovery reports a context change after reassignment", async () => {
  const fixture = createFixture();
  fixture.setAdoptionResult(false);

  await expect(recoverStaleSessionRoot(fixture.state)).resolves.toEqual({
    candidateCount: 1,
    reassigned: true,
    status: "context-changed",
  });
  expect(fixture.reassignments).toHaveLength(1);
});

test("stale root recovery distinguishes an already-adopted session", async () => {
  const fixture = createFixture();
  fixture.setAdoptionResult("already-adopted");

  await expect(recoverStaleSessionRoot(fixture.state)).resolves.toEqual({
    candidateCount: 1,
    reassigned: true,
    status: "already-adopted",
  });
  expect(fixture.reassignments).toHaveLength(1);
});

test("durable orphan recovery makes the document primeable on relaunch", async () => {
  const { close, execSql } = await createTestExecSql(
    "stale-root-recovery-document-priming",
  );
  try {
    await defaultContainerContentsPersistence.ensureSchema(execSql);
    await sqlDocumentsPersistence.ensureSchema(execSql);
    await saveTestDocument({
      containerId: "deleted-local-root",
      documentId: null,
      execSql,
      id: "pending-document",
      title: "Decrypted title excluded from telemetry",
      updatedAt: "2026-07-23T14:19:12.658Z",
    });
    await sqlDocumentMoveIntentPersistence.enqueueMoveIntent(execSql, {
      documentId: "pending-document-remote",
      localId: "pending-document",
      sourceContainerId: "deleted-local-root",
      targetContainerId: "destination-root",
    });
    await sqlDocumentMoveIntentPersistence.recordMoveIntentError(execSql, {
      blocked: true,
      documentId: "pending-document-remote",
      message: "stale source",
    });
    // Blocked intents keep replaying (the status is a diagnosis, not a
    // verdict), so the list still surfaces the blocked row.
    expect(
      (
        await sqlDocumentMoveIntentPersistence.listPendingMoveIntents(execSql)
      ).map((intent) => intent.syncStatus),
    ).toEqual(["blocked"]);
    const containersById = new Map<string, ContainerState>([
      ["remote-root", remoteRoot({ id: "remote-root" })],
    ]);
    const recovery = await recoverStaleSessionRoot({
      containersById,
      persistence: defaultContainerContentsPersistence,
      rootLaneHydrated: true,
      runtime: {
        adoptRootContainer: () => true,
        auth: {
          defaultOrganizationId: ORGANIZATION_ID,
          isAuthenticated: true,
          organizationId: ORGANIZATION_ID,
          userId: "user-1",
        },
        infra: { execSql },
        state: {
          containerId: "deleted-local-root",
          domainScope: createDomainScope(),
        },
      },
    });
    const opened: Array<{ containerId: string; localId: string }> = [];

    const priming = await primeDocumentsForLoadedRoots({
      containersById,
      host: {
        documentWorkflowRuntime: (containerId) => ({ containerId }),
        openDocumentStore: (input) => {
          opened.push({
            containerId: input.runtime.containerId,
            localId: input.localId,
          });
          return { requestSync: () => undefined };
        },
      },
      runtime: { infra: { execSql } },
    });

    expect(recovery.status).toBe("reassigned");
    expect(priming).toMatchObject({
      candidateCount: 1,
      primedCount: 1,
      unroutableCount: 0,
    });
    expect(opened).toEqual([
      { containerId: "remote-root", localId: "pending-document" },
    ]);
    expect(
      await execSql(
        "SELECT container_id FROM document_projection WHERE local_id = ?",
        ["pending-document"],
      ),
    ).toEqual([{ container_id: "remote-root" }]);
    expect(
      await sqlDocumentMoveIntentPersistence.listPendingMoveIntents(execSql),
    ).toEqual([
      expect.objectContaining({
        documentId: "pending-document-remote",
        lastAttemptedAt: null,
        lastError: null,
        sourceContainerId: "remote-root",
        syncStatus: "pending",
        targetContainerId: "destination-root",
      }),
    ]);
  } finally {
    close();
  }
});
