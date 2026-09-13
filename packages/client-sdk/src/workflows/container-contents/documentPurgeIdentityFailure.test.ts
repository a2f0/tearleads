import { expect, test } from "bun:test";
import {
  generateKemSeedAndKeyPair,
  KeyingVerificationError,
} from "@tearleads/crypto";
import { createAuthor } from "../../../test/helpers/documentFixtures";
import { defaultDocumentProjectorRegistry } from "../../data/documents/documentKinds";
import { assertProjectionVerificationCurrent } from "../../data/keyingProjectionVerification/types";
import type { ExecSql } from "../../data/sqlite/sqlSchema";
import type { DocumentsPersistence } from "../documents";
import { purgeRemoteContainerDocument } from "./documentPurge";

async function purgeWithFailingProjectionFetch(
  getDocumentWriterProjectionResult: () => Promise<never>,
) {
  const execSql: ExecSql = async () => [];
  const { author, signingPublicKey } = await createAuthor();
  const keyPair = generateKemSeedAndKeyPair();
  const logs: string[] = [];
  let localDeletes = 0;
  const persistence = {
    deleteDocument: async () => {
      localDeletes += 1;
    },
  } as unknown as DocumentsPersistence;

  const purge = purgeRemoteContainerDocument({
    documentId: "document",
    documentKind: "note",
    noteId: "note",
    persistence,
    resolveProjectionUserKey: async () => null,
    runtime: {
      apiClient: {
        getCurrentPrincipalPolicy: async () => null,
        getDocumentPurgeProof: async () => {
          throw new Error("Unexpected purge-proof fetch");
        },
        getDocumentWriterProjectionResult,
        purgeDocument: async () => {
          throw new Error("Unexpected purge call");
        },
      },
      auth: {
        isAuthenticated: true,
        organizationId: author.organizationId,
        userId: author.signerUserId,
      },
      crypto: {
        encapsulationKeyPair: keyPair,
        signingFingerprint: author.signerKeyFingerprint,
        signingKeyPair: {
          signingPrivateKey: author.signerPrivateKey,
          signingPublicKey,
        },
      },
      infra: {
        blobStore: null as never,
        dbStatus: "ready",
        documentProjectors: defaultDocumentProjectorRegistry,
        execSql,
      },
      resolveTrustedUserIdentity: async () => null,
      state: {
        containerId: null,
        domainScope: null as never,
        events: [],
        online: true,
      },
      util: {
        log: (message) => logs.push(message),
        reportSecurityIncident: async () => undefined,
      },
    },
  });
  return { logs, localDeletes: () => localDeletes, purge };
}

test("remote document purge propagates identity failures without deleting local state", async () => {
  const integrityError = new KeyingVerificationError(
    "equivocation",
    "trusted session identity changed",
  );
  const { logs, localDeletes, purge } = await purgeWithFailingProjectionFetch(
    async () => {
      throw integrityError;
    },
  );

  await expect(purge).rejects.toBe(integrityError);
  expect(localDeletes()).toBe(0);
  expect(logs).toEqual([]);
});

test("remote document purge propagates cancellation instead of reporting a failed purge", async () => {
  const { logs, localDeletes, purge } = await purgeWithFailingProjectionFetch(
    async () => {
      assertProjectionVerificationCurrent(() => false);
      throw new Error("Expected the expired generation to cancel");
    },
  );

  await expect(purge).rejects.toMatchObject({
    name: "ProjectionVerificationCancelledError",
  });
  expect(localDeletes()).toBe(0);
  expect(logs).toEqual([]);
});
