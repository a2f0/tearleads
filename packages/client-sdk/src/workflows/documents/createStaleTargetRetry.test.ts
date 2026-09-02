import { expect, test } from "bun:test";
import {
  generateKemSeedAndKeyPair,
  KeyingVerificationError,
} from "@tearleads/crypto";
import {
  createContainerWriterProjectionFixture,
  createTestExecSql,
} from "@tearleads/test-utils";
import type { DocumentCreateRequest } from "@tearleads/validators/request";
import { DOCUMENT_SYNC_ERROR_CODES } from "@tearleads/validators/response";
import { createAuthor } from "../../../test/helpers/documentFixturePrimitives";
import { createResponseFromRequest } from "../../../test/helpers/documentResponseFixtures";
import { createTestTrustedUserIdentityResolver } from "../../../test/helpers/trustedUserIdentity";
import {
  createRemoteDocument,
  isStaleDocumentCreateTargetConflict,
} from "./create";

test("document create replan requires the exact stale-state code", () => {
  const diagnostic =
    "POST /documents: 409 Conflict: targetContainerPathRefs[0] is stale";
  const failure = (code: string | undefined, status = 409) => ({
    ...(code === undefined ? {} : { code }),
    message: diagnostic,
    ok: false as const,
    status,
  });

  expect(
    isStaleDocumentCreateTargetConflict(
      failure(DOCUMENT_SYNC_ERROR_CODES.stateStale),
    ),
  ).toBe(true);
  expect(isStaleDocumentCreateTargetConflict(failure(undefined))).toBe(false);
  expect(isStaleDocumentCreateTargetConflict(failure("unknown_code"))).toBe(
    false,
  );
  expect(
    isStaleDocumentCreateTargetConflict(
      failure(` ${DOCUMENT_SYNC_ERROR_CODES.stateStale} `),
    ),
  ).toBe(false);
  expect(
    isStaleDocumentCreateTargetConflict(
      failure(DOCUMENT_SYNC_ERROR_CODES.stateStale, 503),
    ),
  ).toBe(false);
});

test("createRemoteDocument replans once when the target container head advances", async () => {
  const { author, signingPublicKey } = await createAuthor();
  const keyPair = generateKemSeedAndKeyPair();
  const projection = await createContainerWriterProjectionFixture({
    containerId: "stale-create-target",
    encapsulationPublicKey: keyPair.publicKey,
    organizationId: author.organizationId,
    signerKeyFingerprint: author.signerKeyFingerprint,
    signerPrivateKey: author.signerPrivateKey,
    userId: author.signerUserId,
  });
  const contentKey = crypto.getRandomValues(new Uint8Array(32));
  const submittedRequests: DocumentCreateRequest[] = [];
  let projectionReads = 0;
  let evictions = 0;
  let reported = false;
  const { close, execSql } = await createTestExecSql(
    "document-create-stale-target-retry",
  );

  try {
    const created = await createRemoteDocument({
      apiClient: {
        createDocument: async () => null,
        createDocumentResult: async (request) => {
          submittedRequests.push(request);
          if (submittedRequests.length === 1) {
            return {
              code: DOCUMENT_SYNC_ERROR_CODES.stateStale,
              message: "POST /documents: 409 Conflict: diagnostic changed",
              ok: false as const,
              report: () => {
                reported = true;
              },
              status: 409,
            };
          }

          return {
            data: await createResponseFromRequest(request),
            ok: true as const,
          };
        },
        evictContainerWriterProjection: (containerId) => {
          expect(containerId).toBe(projection.containerId);
          evictions += 1;
        },
        getContainerWriterProjection: async (containerId) => {
          projectionReads += 1;
          return containerId === projection.containerId ? projection : null;
        },
        primeDocumentWriterProjection: () => undefined,
      },
      author,
      containerId: projection.containerId,
      contentKey,
      documentId: "stale-target-document",
      eventId: "stale-target-event",
      execSql,
      resolveProjectionUserKey: createTestTrustedUserIdentityResolver({
        encapsulationPublicKey: keyPair.publicKey,
        signingKeyFingerprint: author.signerKeyFingerprint,
        signingPublicKey,
        userId: author.signerUserId,
      }),
      signedAt: "2026-07-14T00:00:00.000Z",
      targetSecretKey: keyPair.secretKey,
    });

    expect(created?.documentId).toBe("stale-target-document");
    expect(Array.from(created?.contentKey ?? [])).toEqual(
      Array.from(contentKey),
    );
    expect(submittedRequests).toHaveLength(2);
    expect(
      submittedRequests.map((request) =>
        Reflect.get(request.manifest, "objectId"),
      ),
    ).toEqual(["stale-target-document", "stale-target-document"]);
    expect(
      submittedRequests.map((request) => Reflect.get(request.event, "eventId")),
    ).toEqual(["stale-target-event", "stale-target-event"]);
    expect(projectionReads).toBe(2);
    expect(evictions).toBe(1);
    expect(reported).toBe(false);
  } finally {
    close();
  }
});

test("createRemoteDocument refetches after a container projection rollback", async () => {
  const { author, signingPublicKey } = await createAuthor();
  const keyPair = generateKemSeedAndKeyPair();
  const projection = await createContainerWriterProjectionFixture({
    containerId: "rolled-back-create-container",
    encapsulationPublicKey: keyPair.publicKey,
    organizationId: author.organizationId,
    signerKeyFingerprint: author.signerKeyFingerprint,
    signerPrivateKey: author.signerPrivateKey,
    userId: author.signerUserId,
  });
  const submittedRequests: DocumentCreateRequest[] = [];
  let projectionReads = 0;
  let evictions = 0;
  let injectRollback = true;
  const resolveTrustedIdentity = createTestTrustedUserIdentityResolver({
    encapsulationPublicKey: keyPair.publicKey,
    signingKeyFingerprint: author.signerKeyFingerprint,
    signingPublicKey,
    userId: author.signerUserId,
  });
  const { close, execSql } = await createTestExecSql(
    "document-create-projection-rollback",
  );

  try {
    const created = await createRemoteDocument({
      apiClient: {
        createDocument: async (request) => {
          submittedRequests.push(request);
          return createResponseFromRequest(request);
        },
        evictContainerWriterProjection: () => {
          evictions += 1;
        },
        getContainerWriterProjection: async () => {
          projectionReads += 1;
          return projection;
        },
        primeDocumentWriterProjection: () => undefined,
      },
      author,
      containerId: projection.containerId,
      documentId: "rollback-retry-document",
      eventId: "rollback-retry-event",
      execSql,
      resolveProjectionUserKey: async (userId) => {
        if (injectRollback) {
          injectRollback = false;
          throw new KeyingVerificationError(
            "rollback",
            "container projection lost a local checkpoint race",
          );
        }
        return resolveTrustedIdentity(userId);
      },
      signedAt: "2026-07-14T00:00:00.000Z",
      targetSecretKey: keyPair.secretKey,
    });

    expect(created?.documentId).toBe("rollback-retry-document");
    expect(projectionReads).toBe(2);
    expect(evictions).toBe(1);
    expect(submittedRequests).toHaveLength(1);
    expect(Reflect.get(submittedRequests[0]?.event ?? {}, "eventId")).toBe(
      "rollback-retry-event",
    );
  } finally {
    close();
  }
});

test("createRemoteDocument propagates rollback from the refetched projection", async () => {
  const { author } = await createAuthor();
  const keyPair = generateKemSeedAndKeyPair();
  const projection = await createContainerWriterProjectionFixture({
    containerId: "persistently-rolled-back-create-container",
    encapsulationPublicKey: keyPair.publicKey,
    organizationId: author.organizationId,
    signerKeyFingerprint: author.signerKeyFingerprint,
    signerPrivateKey: author.signerPrivateKey,
    userId: author.signerUserId,
  });
  let projectionReads = 0;
  let evictions = 0;
  let submissions = 0;
  const { close, execSql } = await createTestExecSql(
    "document-create-persistent-projection-rollback",
  );

  try {
    await expect(
      createRemoteDocument({
        apiClient: {
          createDocument: async () => {
            submissions += 1;
            return null;
          },
          evictContainerWriterProjection: () => {
            evictions += 1;
          },
          getContainerWriterProjection: async () => {
            projectionReads += 1;
            return projection;
          },
          primeDocumentWriterProjection: () => undefined,
        },
        author,
        containerId: projection.containerId,
        execSql,
        resolveProjectionUserKey: async () => {
          throw new KeyingVerificationError(
            "rollback",
            "refetched projection remains behind the local checkpoint",
          );
        },
        targetSecretKey: keyPair.secretKey,
      }),
    ).rejects.toMatchObject({ code: "rollback" });
    expect(projectionReads).toBe(2);
    expect(evictions).toBe(1);
    expect(submissions).toBe(0);
  } finally {
    close();
  }
});

test.each([
  "equivocation",
  "object_mismatch",
  "stale_predecessor",
] as const)("createRemoteDocument does not retry integrity failure %s", async (code) => {
  const { author } = await createAuthor();
  const keyPair = generateKemSeedAndKeyPair();
  const projection = await createContainerWriterProjectionFixture({
    containerId: `${code}-create-container`,
    encapsulationPublicKey: keyPair.publicKey,
    organizationId: author.organizationId,
    signerKeyFingerprint: author.signerKeyFingerprint,
    signerPrivateKey: author.signerPrivateKey,
    userId: author.signerUserId,
  });
  let projectionReads = 0;
  let evictions = 0;
  let submissions = 0;
  const { close, execSql } = await createTestExecSql(`document-create-${code}`);

  try {
    await expect(
      createRemoteDocument({
        apiClient: {
          createDocument: async () => {
            submissions += 1;
            return null;
          },
          evictContainerWriterProjection: () => {
            evictions += 1;
          },
          getContainerWriterProjection: async () => {
            projectionReads += 1;
            return projection;
          },
          primeDocumentWriterProjection: () => undefined,
        },
        author,
        containerId: projection.containerId,
        execSql,
        resolveProjectionUserKey: async () => {
          throw new KeyingVerificationError(
            code,
            "container key could not be unwrapped after integrity failure",
          );
        },
        targetSecretKey: keyPair.secretKey,
      }),
    ).rejects.toMatchObject({ code });
    expect(projectionReads).toBe(1);
    expect(evictions).toBe(0);
    expect(submissions).toBe(0);
  } finally {
    close();
  }
});
