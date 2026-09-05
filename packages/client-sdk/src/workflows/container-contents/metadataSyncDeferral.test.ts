import { expect, test } from "bun:test";
import { KeyingVerificationError } from "@tearleads/crypto";
import { createMockApiClient } from "@tearleads/test-utils";
import { createContainerMetadataDocument } from "../../data/containers/containerMetadataDocument";
import { DocumentSyncUpdateIsolationError } from "../../data/documents/shared/documentSyncUpdateIsolation";
import { PrincipalPolicyNotCachedError } from "../../data/keyingProjectionVerification/principalPolicyVerification";
import { syncContainerMetadataState } from "./metadata";
import {
  createContainerContentsPersistence,
  createContainerRecord,
  createDocumentRecord,
  metadataTestExecSql,
} from "./metadata.testFixtures";

function createMetadataSyncRuntime(input: {
  getDocumentWriterProjection: (documentId: string) => Promise<never>;
  logs: string[];
  reportSecurityIncident?:
    | ((error: unknown, context: unknown) => Promise<void>)
    | undefined;
}) {
  return {
    apiClient: createMockApiClient({
      getDocumentWriterProjection: input.getDocumentWriterProjection,
    }),
    auth: {
      deviceId: "device-1",
      organizationId: "org-1",
      userId: "user-1",
    },
    crypto: {
      encapsulationKeyPair: null,
      signingKeyPair: { signingPrivateKey: new Uint8Array(32) },
      signingFingerprint: "signing-fingerprint-1",
    },
    infra: { execSql: metadataTestExecSql },
    resolveTrustedUserIdentity: async () => null,
    state: {
      containerId: null,
      domainScope: {},
      events: [],
      online: true,
    },
    util: {
      log: (message: string) => {
        input.logs.push(message);
      },
      reportSecurityIncident:
        input.reportSecurityIncident ?? (async () => undefined),
    },
  } as never;
}

function createForcedMetadataSyncInput(runtime: never) {
  return {
    forceReadSync: true,
    isCurrent: () => true,
    persistence: createContainerContentsPersistence({}),
    resolveProjectionUserKey: async () => null,
    runtime,
    targetSecretKey: new Uint8Array(),
  };
}

test("syncContainerMetadataState defers a cold principal-policy cache", async () => {
  // A referenced policy that warming could not fetch this pass is transient:
  // the pass must skip this container (leaving its needing-sync state set for
  // the next trigger) instead of throwing and failing the whole lane run.
  const container = createContainerRecord({
    id: "container-4",
    metadataDocumentId: "metadata-document-4",
    parentId: null,
  });
  const doc = await createContainerMetadataDocument(container.id);
  const record = createDocumentRecord({
    documentId: "metadata-document-4",
    id: container.id,
  });
  const logs: string[] = [];

  const synced = await syncContainerMetadataState({
    ...createForcedMetadataSyncInput(
      createMetadataSyncRuntime({
        getDocumentWriterProjection: async () => {
          throw new PrincipalPolicyNotCachedError("group:group-1@1");
        },
        logs,
      }),
    ),
    metadataState: { container, doc, record },
  });

  expect(synced).toBeNull();
  expect(logs).toEqual([
    "Container contents: deferred metadata sync for container-4 because a referenced principal policy is not cached yet.",
  ]);
});

test("an isolated metadata response does not starve the next container", async () => {
  const states = await Promise.all(
    ["isolated", "later"].map(async (suffix) => {
      const container = createContainerRecord({
        id: `container-${suffix}`,
        metadataDocumentId: `metadata-document-${suffix}`,
        parentId: null,
      });
      return {
        container,
        doc: await createContainerMetadataDocument(container.id),
        record: createDocumentRecord({
          documentId: `metadata-document-${suffix}`,
          id: container.id,
        }),
      };
    }),
  );
  const requestedDocumentIds: string[] = [];
  const logs: string[] = [];
  const laterError = new Error("later container reached");
  const runtime = createMetadataSyncRuntime({
    getDocumentWriterProjection: async (documentId: string) => {
      requestedDocumentIds.push(documentId);
      if (documentId === "metadata-document-isolated") {
        throw new DocumentSyncUpdateIsolationError({
          batchUpdateIds: ["550e8400-e29b-41d4-a716-4466554400ff"],
          cause: new Error("poison metadata update"),
          stage: "loro_import",
          updateId: null,
        });
      }
      throw laterError;
    },
    logs,
  });
  let thrown: unknown;

  for (const metadataState of states) {
    try {
      await syncContainerMetadataState({
        ...createForcedMetadataSyncInput(runtime),
        metadataState,
      });
    } catch (error) {
      thrown = error;
      break;
    }
  }

  expect(thrown).toBe(laterError);
  expect(requestedDocumentIds).toEqual([
    "metadata-document-isolated",
    "metadata-document-later",
  ]);
  expect(logs).toEqual([
    "Container contents: quarantined incoming metadata updates for container-isolated; deferred this container without blocking later metadata syncs.",
  ]);
});

test("isolated metadata reports a nested verification incident", async () => {
  const container = createContainerRecord({
    id: "container-isolated-integrity",
    metadataDocumentId: "metadata-document-isolated-integrity",
    parentId: null,
  });
  const doc = await createContainerMetadataDocument(container.id);
  const record = createDocumentRecord({
    documentId: "metadata-document-isolated-integrity",
    id: container.id,
  });
  const logs: string[] = [];
  const integrityError = new KeyingVerificationError(
    "signature_mismatch",
    "metadata writer signature mismatch",
  );
  const isolationError = new DocumentSyncUpdateIsolationError({
    batchUpdateIds: ["550e8400-e29b-41d4-a716-4466554400ee"],
    cause: integrityError,
    stage: "write_header",
    updateId: null,
  });
  const incidents: Array<{ context: unknown; error: unknown }> = [];

  const synced = await syncContainerMetadataState({
    ...createForcedMetadataSyncInput(
      createMetadataSyncRuntime({
        getDocumentWriterProjection: async () => {
          throw isolationError;
        },
        logs,
        reportSecurityIncident: async (error, context) => {
          incidents.push({ context, error });
        },
      }),
    ),
    metadataState: { container, doc, record },
  });

  expect(synced).toBeNull();
  expect(incidents).toEqual([
    {
      context: {
        objectId: container.id,
        objectKind: "container",
        operation: "container.metadata.sync",
        organizationId: "org-1",
      },
      error: integrityError,
    },
  ]);
  expect(logs).toEqual([
    "Container contents: quarantined incoming metadata updates for container-isolated-integrity; deferred this container without blocking later metadata syncs.",
  ]);
});

test("syncContainerMetadataState rethrows unrelated sync errors", async () => {
  const container = createContainerRecord({
    id: "container-5",
    metadataDocumentId: "metadata-document-5",
    parentId: null,
  });
  const doc = await createContainerMetadataDocument(container.id);
  const record = createDocumentRecord({
    documentId: "metadata-document-5",
    id: container.id,
  });
  const logs: string[] = [];

  await expect(
    syncContainerMetadataState({
      ...createForcedMetadataSyncInput(
        createMetadataSyncRuntime({
          getDocumentWriterProjection: async () => {
            throw new Error("writer projection request failed");
          },
          logs,
        }),
      ),
      metadataState: { container, doc, record },
    }),
  ).rejects.toThrow("writer projection request failed");
  expect(logs).toEqual([]);
});

test("a clean metadata follow-up resumes its durable pull cursor", async () => {
  const container = createContainerRecord({
    id: "container-pagination-follow-up",
    metadataDocumentId: "metadata-document-pagination-follow-up",
    parentId: null,
  });
  const doc = await createContainerMetadataDocument(container.id);
  const record = createDocumentRecord({
    contentKeyBundle: "content-key-bundle",
    documentId: "metadata-document-pagination-follow-up",
    documentKekTargets: "document-kek-targets",
    documentManifestBundle: "document-manifest-bundle",
    id: container.id,
    lastCommitLsn: "0/2",
    pullContinuation: {
      commitLsn: "0/3",
      commitLsnMode: "tracked",
      cursor: "metadata-page-after-update-64",
    },
  });
  const logs: string[] = [];
  let writerProjectionCalls = 0;

  await expect(
    syncContainerMetadataState({
      ...createForcedMetadataSyncInput(
        createMetadataSyncRuntime({
          getDocumentWriterProjection: async () => {
            writerProjectionCalls += 1;
            throw new Error("resumed metadata projection request");
          },
          logs,
        }),
      ),
      forceReadSync: false,
      metadataState: {
        container,
        doc,
        record,
      },
    }),
  ).rejects.toThrow("resumed metadata projection request");
  expect(writerProjectionCalls).toBe(1);
  expect(logs).toEqual([]);
});

test("malformed durable metadata progress forces a page-one recovery", async () => {
  const container = createContainerRecord({
    id: "container-malformed-progress",
    metadataDocumentId: "metadata-document-malformed-progress",
    parentId: null,
  });
  const doc = await createContainerMetadataDocument(container.id);
  const record = createDocumentRecord({
    contentKeyBundle: "content-key-bundle",
    documentId: "metadata-document-malformed-progress",
    documentKekTargets: "document-kek-targets",
    documentManifestBundle: "document-manifest-bundle",
    id: container.id,
    lastCommitLsn: "0/2",
    pullContinuationRecoveryRequired: true,
  });
  const logs: string[] = [];
  let writerProjectionCalls = 0;

  await expect(
    syncContainerMetadataState({
      ...createForcedMetadataSyncInput(
        createMetadataSyncRuntime({
          getDocumentWriterProjection: async () => {
            writerProjectionCalls += 1;
            throw new Error("page-one metadata projection request");
          },
          logs,
        }),
      ),
      forceReadSync: false,
      metadataState: { container, doc, record },
    }),
  ).rejects.toThrow("page-one metadata projection request");
  expect(writerProjectionCalls).toBe(1);
  expect(logs).toEqual([]);
});

test("syncContainerMetadataState never defers keying verification failures", async () => {
  const container = createContainerRecord({
    id: "container-integrity-failure",
    metadataDocumentId: "metadata-document-integrity-failure",
    parentId: null,
  });
  const doc = await createContainerMetadataDocument(container.id);
  const record = createDocumentRecord({
    documentId: "metadata-document-integrity-failure",
    id: container.id,
  });
  const logs: string[] = [];
  const integrityError = new KeyingVerificationError(
    "missing_dependency",
    "Document authorizing container KEK path could not be unwrapped",
  );

  await expect(
    syncContainerMetadataState({
      ...createForcedMetadataSyncInput(
        createMetadataSyncRuntime({
          getDocumentWriterProjection: async () => {
            throw integrityError;
          },
          logs,
        }),
      ),
      metadataState: { container, doc, record },
    }),
  ).rejects.toBe(integrityError);
  expect(logs).toEqual([]);
});
