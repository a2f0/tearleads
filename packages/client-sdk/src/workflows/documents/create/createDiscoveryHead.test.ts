import { expect, test } from "bun:test";
import { generateKemSeedAndKeyPair } from "@tearleads/crypto";
import {
  createContainerWriterProjectionFixture,
  createMockApiClient,
  createTestExecSql,
} from "@tearleads/test-utils";
import type {
  DocumentCreateResponse,
  DocumentWriterProjectionResponse,
} from "@tearleads/validators/response";
import {
  createAuthor,
  createResponseFromRequest,
} from "../../../../test/helpers/data/documentFixtures";
import { createTestTrustedUserIdentityResolver } from "../../../../test/helpers/data/trustedUserIdentity";
import { createRemoteDocumentForTest as createRemoteDocument } from "../../../../test/helpers/workflows/remoteDocumentServiceFixture";
import { DocumentDiscoveryEvidenceRepository } from "../../../data/persistence/documents/documentDiscoveryEvidencePersistence";
import { clearDocumentDiscoveryEvidenceOnRemoteReset } from "../../../data/persistence/documents/documentDiscoveryReset";
import { ProjectionDependencyUnavailableError } from "../../../data/shared/dependencyUnavailable";
import { documentContainerProjectionTables } from "../../../data/sqlite/schema/documentProjectionSchema";
import { getClientSQLitePersistenceRuntime } from "../../../data/sqlite/sqlitePersistenceRuntime";
import { type ExecSql, ensureSqlTables } from "../../../data/sqlite/sqlSchema";
import { createDiscoveredDocumentVerifier } from "../../container-contents/documentDiscovery/documentDiscoveryEvidence";
import { documentWriterProjectionFromCreateResponse } from "./createProjection";

const DOCUMENT_ID = "document-created-here";

/** Creates one note through the remote create workflow. */
async function createNote(
  execSql: ExecSql,
  options: {
    readonly logError?: (message: string | Error, cause?: unknown) => void;
    readonly onAfterCreateKeyResolve?: () => Promise<void> | void;
    readonly onPrimeWriterProjection?: () => void;
    readonly respond?: (
      response: DocumentCreateResponse,
    ) => DocumentCreateResponse;
    readonly stillCurrent?: () => boolean;
  } = {},
) {
  const { author, signingPublicKey } = await createAuthor();
  const keyPair = generateKemSeedAndKeyPair();
  const projection = await createContainerWriterProjectionFixture({
    containerId: "created-here-folder",
    encapsulationPublicKey: keyPair.publicKey,
    organizationId: author.organizationId,
    signerKeyFingerprint: author.signerKeyFingerprint,
    signerPrivateKey: author.signerPrivateKey,
    userId: author.signerUserId,
  });
  const resolveIdentity = createTestTrustedUserIdentityResolver({
    encapsulationPublicKey: keyPair.publicKey,
    signingKeyFingerprint: author.signerKeyFingerprint,
    signingPublicKey,
    userId: author.signerUserId,
  });
  let submitted = false;
  let writerProjection: DocumentWriterProjectionResponse | null = null;
  let afterCreateHookRan = false;
  const created = await createRemoteDocument({
    apiClient: createMockApiClient({
      createDocument: async (request) => {
        submitted = true;
        const raw = await createResponseFromRequest(request);
        writerProjection = documentWriterProjectionFromCreateResponse({
          containerProjection: projection,
          response: raw,
        });
        return options.respond ? options.respond(raw) : raw;
      },
      getContainerWriterProjection: async (containerId) =>
        containerId === projection.containerId ? projection : null,
      getDocumentWriterProjection: async () => writerProjection,
      primeDocumentWriterProjection: () => {
        options.onPrimeWriterProjection?.();
      },
    }),
    author,
    containerId: projection.containerId,
    documentId: DOCUMENT_ID,
    eventId: "event-created-here",
    execSql,
    logError: options.logError,
    resolveProjectionUserKey: async (userId) => {
      if (submitted && !afterCreateHookRan && options.onAfterCreateKeyResolve) {
        afterCreateHookRan = true;
        await options.onAfterCreateKeyResolve();
      }
      return resolveIdentity(userId);
    },
    signedAt: "2026-11-26T00:00:00.000Z",
    stillCurrent: options.stillCurrent,
    targetSecretKey: keyPair.secretKey,
  });
  return { author, containerId: projection.containerId, created };
}

async function expectCachedHeadCount(
  execSql: ExecSql,
  count: number,
): Promise<void> {
  await ensureSqlTables(execSql, documentContainerProjectionTables);
  expect(
    await execSql("SELECT COUNT(*) AS count FROM document_discovery_heads"),
  ).toEqual([{ count }]);
}

test("a listing names a note this device created without reading its head", async () => {
  const { close, execSql } = await createTestExecSql("created-discovery-head");
  try {
    const { author, containerId, created } = await createNote(execSql);
    if (!created?.plan) throw new Error("Expected a fresh create");
    const { manifestHash } = created.plan;
    const store = new DocumentDiscoveryEvidenceRepository(execSql);

    let headReads = 0;
    const verify = createDiscoveredDocumentVerifier(
      author.organizationId,
      async () => {
        headReads += 1;
        return null;
      },
      async () => 1,
      store,
    );
    const result = await verify(
      [
        {
          accessEpoch: 1,
          accessStateHash: manifestHash,
          containerId,
          createdAt: "2026-11-26T00:00:00.000Z",
          documentId: DOCUMENT_ID,
          // Listing fields are untrusted hints; only the signed head names
          // links.
          linkedContainerIds: ["forged-container"],
          listedContainerIds: [containerId],
        },
      ],
      [containerId],
      await store.begin(),
    );

    expect(headReads).toBe(0);
    expect(result.inputs).toEqual([
      expect.objectContaining({
        accessStateHash: manifestHash,
        containerId,
        documentId: DOCUMENT_ID,
        linkedContainerIds: [containerId],
      }),
    ]);
    expect(await result.commit()).toBe(true);
  } finally {
    close();
  }
});

test("a create whose acknowledgement names another head seeds nothing", async () => {
  const { close, execSql } = await createTestExecSql(
    "created-discovery-head-mismatch",
  );
  try {
    await expect(
      createNote(execSql, {
        respond: (response) => ({
          ...response,
          manifestHash: "0".repeat(64),
        }),
      }),
    ).rejects.toThrow();
    await expectCachedHeadCount(execSql, 0);
  } finally {
    close();
  }
});

test("a head-cache write failure is logged without failing the create or skipping projection priming", async () => {
  const { close, execSql } = await createTestExecSql(
    "created-discovery-head-write-failure",
  );
  try {
    await ensureSqlTables(execSql, documentContainerProjectionTables);
    await execSql(`
      CREATE TRIGGER fail_discovery_head_insert
      BEFORE INSERT ON document_discovery_heads
      BEGIN
        SELECT RAISE(ABORT, 'simulated cache write failure');
      END
    `);
    const logged: Array<string | Error> = [];
    let primedWriterProjection = 0;
    const { created } = await createNote(execSql, {
      logError: (message) => {
        logged.push(message);
      },
      onPrimeWriterProjection: () => {
        primedWriterProjection += 1;
      },
    });

    expect(created?.documentId).toBe(DOCUMENT_ID);
    expect(primedWriterProjection).toBe(1);
    expect(logged).toEqual([
      "Documents: a created document's head was not cached",
    ]);
    await expectCachedHeadCount(execSql, 0);
  } finally {
    close();
  }
});

test("a remote reset landing between acknowledgement and seed keeps the head out of the cache", async () => {
  const { close, execSql } = await createTestExecSql(
    "created-discovery-head-reset-race",
  );
  try {
    // No discovery `begin()` has run yet; the reset itself must raise the
    // eviction mark so the in-flight create detects it under the write lock.
    const { created } = await createNote(execSql, {
      onAfterCreateKeyResolve: async () => {
        await getClientSQLitePersistenceRuntime(execSql).transaction((tx) =>
          clearDocumentDiscoveryEvidenceOnRemoteReset(tx, {
            containerIds: [],
            documentIds: [DOCUMENT_ID],
          }),
        );
      },
    });

    expect(created?.documentId).toBe(DOCUMENT_ID);
    await expectCachedHeadCount(execSql, 0);
  } finally {
    close();
  }
});

test("a superseded create during projection verification seeds nothing", async () => {
  const { close, execSql } = await createTestExecSql(
    "created-discovery-head-superseded",
  );
  try {
    let current = true;
    const { created } = await createNote(execSql, {
      onAfterCreateKeyResolve: () => {
        current = false;
      },
      stillCurrent: () => current,
    });

    expect(created).toBeNull();
    await expectCachedHeadCount(execSql, 0);
  } finally {
    close();
  }
});

test("a create recovered through the adoption path seeds nothing", async () => {
  const { close, execSql } = await createTestExecSql(
    "created-discovery-head-adoption",
  );
  try {
    const { created } = await createNote(execSql, {
      onAfterCreateKeyResolve: () => {
        throw new ProjectionDependencyUnavailableError(
          "Principal pin advanced during create",
        );
      },
    });

    expect(created?.documentId).toBe(DOCUMENT_ID);
    await expectCachedHeadCount(execSql, 0);
  } finally {
    close();
  }
});
