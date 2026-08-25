import { expect, test } from "bun:test";
import { createMockApiClient, createTestExecSql } from "@symcrypt/test-utils";
import { createMaterializedSyncFixture } from "../../../../test/helpers/documentFixtures";
import { createMemoryBlobStore } from "../../../data/blobs/memoryBlobStore";
import { defaultDocumentProjectorRegistry } from "../../../data/documents/documentKinds";
import { createDomainScope } from "../../../data/domainScope";
import { disposeDomainSyncCoordinator } from "../../../data/sync/syncCoordinator";
import {
  createDocumentsWorkflowRuntime,
  type DocumentsWorkflowRuntimeInput,
  defaultDocumentsPersistence,
} from "../../../workflows/documents";
import { createDocumentStore } from "../documentStore";

type MaterializedSyncFixture = Awaited<
  ReturnType<typeof createMaterializedSyncFixture>
>;

async function settleWithin<T>(promise: Promise<T>): Promise<T> {
  let timeout: ReturnType<typeof setTimeout> | undefined;
  try {
    return await Promise.race([
      promise,
      new Promise<never>((_, reject) => {
        timeout = setTimeout(
          () => reject(new Error("Timed out waiting for a remote sync probe")),
          3_000,
        );
      }),
    ]);
  } finally {
    clearTimeout(timeout);
  }
}

function createUnavailableRuntime(
  execSql: DocumentsWorkflowRuntimeInput["infra"]["execSql"],
) {
  return createDocumentsWorkflowRuntime({
    apiClient: createMockApiClient(),
    auth: {
      isAuthenticated: false,
      organizationId: null,
      userId: null,
    },
    crypto: {
      encapsulationKeyPair: null,
      signingFingerprint: null,
      signingKeyPair: null,
    },
    infra: {
      blobStore: createMemoryBlobStore(),
      dbStatus: "ready",
      documentProjectors: defaultDocumentProjectorRegistry,
      execSql,
    },
    resolveTrustedUserIdentity: async () => null,
    state: {
      containerId: "container-id",
      domainScope: createDomainScope(),
      events: [],
      online: true,
    },
    util: {
      log: () => undefined,
      reportSecurityIncident: async () => undefined,
    },
  });
}

function createFailingProbeRuntime(input: {
  readonly execSql: DocumentsWorkflowRuntimeInput["infra"]["execSql"];
  readonly fixture: MaterializedSyncFixture;
  readonly onSync: () => void;
}) {
  const { fixture } = input;
  return createDocumentsWorkflowRuntime({
    apiClient: createMockApiClient({
      getContainerWriterProjection: async () => fixture.projection,
      getDocumentWriterProjection: async () => fixture.writerProjection,
      syncDocument: async () => {
        input.onSync();
        return null;
      },
    }),
    auth: {
      isAuthenticated: true,
      organizationId: fixture.author.organizationId,
      userId: fixture.author.signerUserId,
    },
    crypto: {
      encapsulationKeyPair: {
        publicKey: fixture.publicKey,
        secretKey: fixture.secretKey,
      },
      signingFingerprint: fixture.author.signerKeyFingerprint,
      signingKeyPair: {
        signingPrivateKey: fixture.author.signerPrivateKey,
        signingPublicKey: fixture.signingPublicKey,
      },
    },
    infra: {
      blobStore: createMemoryBlobStore(),
      dbStatus: "ready",
      documentProjectors: defaultDocumentProjectorRegistry,
      execSql: input.execSql,
    },
    resolveTrustedUserIdentity: fixture.resolveProjectionUserKey,
    state: {
      containerId: fixture.projection.containerId,
      domainScope: createDomainScope(),
      events: [],
      online: true,
    },
    util: {
      log: () => undefined,
      reportSecurityIncident: async () => undefined,
    },
  });
}

test("a probe skipped for unavailable prerequisites reports incomplete", async () => {
  const database = await createTestExecSql("remote-sync-wait-unavailable");
  const runtime = createUnavailableRuntime(database.execSql);
  try {
    await defaultDocumentsPersistence.ensureSchema(database.execSql);
    const store = createDocumentStore(
      "unavailable-profile",
      runtime,
      defaultDocumentsPersistence,
      "remote-profile-id",
    );
    expect(await store.ensureInitialized()).toBe(true);

    expect(await settleWithin(store.requestRemoteSyncAndWait())).toBe(false);
  } finally {
    disposeDomainSyncCoordinator(runtime.state.domainScope);
    database.close();
  }
});

test("a graceful null remote probe reports incomplete", async () => {
  const fixture = await createMaterializedSyncFixture();
  const database = await createTestExecSql("remote-sync-wait-null");
  let syncCalls = 0;
  const runtime = createFailingProbeRuntime({
    execSql: database.execSql,
    fixture,
    onSync: () => {
      syncCalls += 1;
    },
  });
  try {
    await defaultDocumentsPersistence.ensureSchema(database.execSql);
    const store = createDocumentStore(
      "null-profile",
      runtime,
      defaultDocumentsPersistence,
      fixture.writerProjection.documentId,
    );
    expect(await store.ensureInitialized()).toBe(true);

    expect(await settleWithin(store.requestRemoteSyncAndWait())).toBe(false);
    expect(syncCalls).toBeGreaterThan(0);
  } finally {
    disposeDomainSyncCoordinator(runtime.state.domainScope);
    database.close();
  }
});
