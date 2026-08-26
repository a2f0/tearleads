import { expect, test } from "bun:test";
import {
  generateKemSeedAndKeyPair,
  KeyingVerificationError,
} from "@symcrypt/crypto";
import { createAuthor } from "../../../test/helpers/documentFixtures";
import { defaultDocumentProjectorRegistry } from "../../data/documents/documentKinds";
import type { ExecSql } from "../../data/sqlite/sqlSchema";
import type { DocumentsPersistence } from "../documents";
import { purgeRemoteContainerDocument } from "./documentPurge";

test("remote document purge propagates identity failures without deleting local state", async () => {
  const integrityError = new KeyingVerificationError(
    "equivocation",
    "trusted session identity changed",
  );
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

  await expect(
    purgeRemoteContainerDocument({
      documentId: "document",
      noteId: "note",
      persistence,
      resolveProjectionUserKey: async () => null,
      runtime: {
        apiClient: {
          getCurrentPrincipalPolicy: async () => null,
          getDocumentPurgeProof: async () => {
            throw new Error("Unexpected purge-proof fetch");
          },
          getDocumentWriterProjectionResult: async () => {
            throw integrityError;
          },
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
    }),
  ).rejects.toBe(integrityError);
  expect(localDeletes).toBe(0);
  expect(logs).toEqual([]);
});
