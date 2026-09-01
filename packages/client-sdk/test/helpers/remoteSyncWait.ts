import { createMockApiClient } from "@tearleads/test-utils";
import type { DocumentSyncResponse } from "@tearleads/validators/response";
import { createMemoryBlobStore } from "../../src/data/blobs/memoryBlobStore";
import { defaultDocumentProjectorRegistry } from "../../src/data/documents/documentKinds";
import { createDomainScope } from "../../src/data/domainScope";
import { getDomainSyncCoordinatorSnapshot } from "../../src/data/sync/syncCoordinator";
import {
  createDocumentsWorkflowRuntime,
  type DocumentsWorkflowRuntimeInput,
} from "../../src/workflows/documents";
import type { createMaterializedSyncFixture } from "./documentFixtures";

type MaterializedSyncFixture = Awaited<
  ReturnType<typeof createMaterializedSyncFixture>
>;

export function createUnavailableRuntime(
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

export async function settleCoordinator(
  domainScope: ReturnType<typeof createDomainScope>,
): Promise<void> {
  for (let index = 0; index < 100; index += 1) {
    const lanes = getDomainSyncCoordinatorSnapshot(domainScope).lanes;
    if (lanes.every((lane) => !lane.running && !lane.requested)) {
      return;
    }
    await new Promise((resolve) => setTimeout(resolve, 0));
  }
  throw new Error("Timed out waiting for the document sync lane to settle");
}

export async function settleWithin<T>(
  promise: Promise<T>,
  label = "remote sync probe",
): Promise<T> {
  let timeout: ReturnType<typeof setTimeout> | undefined;
  try {
    return await Promise.race([
      promise,
      new Promise<never>((_, reject) => {
        timeout = setTimeout(
          () => reject(new Error(`Timed out waiting for ${label}`)),
          3_000,
        );
      }),
    ]);
  } finally {
    clearTimeout(timeout);
  }
}

export function createProbeRuntime(input: {
  readonly execSql: DocumentsWorkflowRuntimeInput["infra"]["execSql"];
  readonly fixture: MaterializedSyncFixture;
  readonly syncDocument: () => Promise<DocumentSyncResponse | null>;
}) {
  const { fixture } = input;
  return createDocumentsWorkflowRuntime({
    apiClient: createMockApiClient({
      getContainerWriterProjection: async () => fixture.projection,
      getDocumentWriterProjection: async () => fixture.writerProjection,
      syncDocument: input.syncDocument,
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
