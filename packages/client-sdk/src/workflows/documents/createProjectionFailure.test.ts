import { expect, test } from "bun:test";
import { generateKemSeedAndKeyPair } from "@tearleads/crypto";
import {
  createContainerWriterProjectionFixture,
  createTestExecSql,
} from "@tearleads/test-utils";
import { DOCUMENT_SYNC_ERROR_CODES } from "@tearleads/validators/response";
import { createAuthor } from "../../../test/helpers/documentFixturePrimitives";
import { createTestTrustedUserIdentityResolver } from "../../../test/helpers/trustedUserIdentity";
import { createRemoteDocument } from "./create";

test("createRemoteDocument records a terminal failure when the container projection fetch fails", async () => {
  const { author } = await createAuthor();
  const keyPair = generateKemSeedAndKeyPair();
  const recordedFailures: Array<{ message: string; status: number | null }> =
    [];
  let reported = 0;
  let submissions = 0;
  const { close, execSql } = await createTestExecSql(
    "document-create-projection-fetch-failure",
  );

  try {
    const created = await createRemoteDocument({
      apiClient: {
        createDocument: async () => {
          submissions += 1;
          return null;
        },
        getContainerWriterProjection: async () => {
          throw new Error(
            "plain projection fetch must not run when the result variant exists",
          );
        },
        getContainerWriterProjectionResult: async () => ({
          message:
            "GET /containers/blocked-container/writer-projection: 402 Payment Required",
          ok: false as const,
          report: () => {
            reported += 1;
          },
          status: 402,
        }),
        primeDocumentWriterProjection: () => undefined,
      },
      author,
      containerId: "blocked-container",
      execSql,
      onTerminalSubmitFailure: (failure) => {
        recordedFailures.push({
          message: failure.message,
          status: failure.status,
        });
      },
      resolveProjectionUserKey: async () => null,
      targetSecretKey: keyPair.secretKey,
    });

    expect(created).toBeNull();
    expect(submissions).toBe(0);
    expect(reported).toBe(1);
    expect(recordedFailures).toEqual([
      {
        message:
          "GET /containers/blocked-container/writer-projection: 402 Payment Required",
        status: 402,
      },
    ]);
  } finally {
    close();
  }
});

test("createRemoteDocument stays silent when a plain-fetch double yields no projection", async () => {
  const { author } = await createAuthor();
  const keyPair = generateKemSeedAndKeyPair();
  const recordedFailures: Array<{ message: string; status: number | null }> =
    [];
  const { close, execSql } = await createTestExecSql(
    "document-create-plain-projection-fetch-null",
  );

  try {
    const created = await createRemoteDocument({
      apiClient: {
        createDocument: async () => null,
        getContainerWriterProjection: async () => null,
        primeDocumentWriterProjection: () => undefined,
      },
      author,
      containerId: "unfetchable-container",
      execSql,
      onTerminalSubmitFailure: (failure) => {
        recordedFailures.push({
          message: failure.message,
          status: failure.status,
        });
      },
      resolveProjectionUserKey: async () => null,
      targetSecretKey: keyPair.secretKey,
    });

    expect(created).toBeNull();
    expect(recordedFailures).toEqual([]);
  } finally {
    close();
  }
});

test("createRemoteDocument records a terminal failure when the stale-target refetch fails", async () => {
  const { author, signingPublicKey } = await createAuthor();
  const keyPair = generateKemSeedAndKeyPair();
  const projection = await createContainerWriterProjectionFixture({
    containerId: "stale-then-denied-container",
    encapsulationPublicKey: keyPair.publicKey,
    organizationId: author.organizationId,
    signerKeyFingerprint: author.signerKeyFingerprint,
    signerPrivateKey: author.signerPrivateKey,
    userId: author.signerUserId,
  });
  const recordedFailures: Array<{ message: string; status: number | null }> =
    [];
  let projectionReads = 0;
  let evictions = 0;
  let submissions = 0;
  const { close, execSql } = await createTestExecSql(
    "document-create-stale-target-refetch-failure",
  );

  try {
    const created = await createRemoteDocument({
      apiClient: {
        createDocument: async () => null,
        createDocumentResult: async () => {
          submissions += 1;
          return {
            code: DOCUMENT_SYNC_ERROR_CODES.stateStale,
            message:
              "POST /documents: 409 Conflict: targetContainerPathRefs[0] is stale",
            ok: false as const,
            report: () => undefined,
            status: 409,
          };
        },
        evictContainerWriterProjection: (containerId) => {
          expect(containerId).toBe(projection.containerId);
          evictions += 1;
        },
        getContainerWriterProjection: async () => {
          throw new Error(
            "plain projection fetch must not run when the result variant exists",
          );
        },
        getContainerWriterProjectionResult: async () => {
          projectionReads += 1;
          if (projectionReads === 1) {
            return { data: projection, ok: true as const };
          }
          return {
            message:
              "GET /containers/stale-then-denied-container/writer-projection: 403 Forbidden",
            ok: false as const,
            report: () => undefined,
            status: 403,
          };
        },
        primeDocumentWriterProjection: () => undefined,
      },
      author,
      containerId: projection.containerId,
      documentId: "stale-then-denied-document",
      execSql,
      onTerminalSubmitFailure: (failure) => {
        recordedFailures.push({
          message: failure.message,
          status: failure.status,
        });
      },
      resolveProjectionUserKey: createTestTrustedUserIdentityResolver({
        encapsulationPublicKey: keyPair.publicKey,
        signingKeyFingerprint: author.signerKeyFingerprint,
        signingPublicKey,
        userId: author.signerUserId,
      }),
      targetSecretKey: keyPair.secretKey,
    });

    expect(created).toBeNull();
    expect(submissions).toBe(1);
    expect(evictions).toBe(1);
    expect(projectionReads).toBe(2);
    expect(recordedFailures).toEqual([
      {
        message:
          "GET /containers/stale-then-denied-container/writer-projection: 403 Forbidden",
        status: 403,
      },
    ]);
  } finally {
    close();
  }
});
