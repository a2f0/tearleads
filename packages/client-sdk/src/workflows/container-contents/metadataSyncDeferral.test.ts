import { expect, test } from "bun:test";
import { KeyingVerificationError } from "@symcrypt/crypto";
import { createContainerMetadataDocument } from "../../data/containers/containerMetadataDocument";
import { PrincipalPolicyNotCachedError } from "../../data/keyingProjectionVerification/principalPolicyVerification";
import { syncContainerMetadataState } from "./metadata";
import {
  createContainerContentsPersistence,
  createContainerRecord,
  createDocumentRecord,
  metadataTestExecSql,
} from "./metadata.testFixtures";

function createMetadataSyncRuntime(input: {
  getDocumentWriterProjection: () => Promise<never>;
  logs: string[];
}) {
  return {
    apiClient: {
      getDocumentWriterProjection: input.getDocumentWriterProjection,
    },
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
    },
  } as never;
}

function createForcedMetadataSyncInput(runtime: never) {
  return {
    forceReadSync: true,
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
