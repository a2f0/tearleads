import { expect, test } from "bun:test";
import {
  CONTENT_RECORD_ENCRYPTION_SUITE,
  KeyingVerificationError,
  toFingerprint,
  type WriteHeader,
} from "@tearleads/crypto";
import { createTestTrustedUserIdentity } from "../../../test/helpers/trustedUserIdentity";
import { DatabaseUnavailableError } from "../../data/sync/databaseUnavailable";
import { createDocumentWriterPublicKeyResolver } from "./writerKeys";

function createWriteHeader(input: {
  authorFingerprint: string;
  writerUserId: string;
}): WriteHeader {
  return {
    version: 1,
    organizationId: "organization-1",
    objectKind: "document",
    objectId: "document-1",
    accessManifestHash: "manifest-hash",
    contentKeyEpoch: 1,
    targetHash: "target-hash",
    encryptionSuite: CONTENT_RECORD_ENCRYPTION_SUITE,
    contentRecordId: "update-1",
    nonceDomainHash: "nonce-domain-hash",
    metadataHash: "metadata-hash",
    ciphertextHash: "ciphertext-hash",
    writerUserId: input.writerUserId,
    writerDeviceId: "device-1",
    writerKeyFingerprint: input.authorFingerprint,
    signedAt: "2026-04-27T00:00:00.000Z",
    signature: "signature",
  };
}

test("createDocumentWriterPublicKeyResolver uses a trusted signing identity", async () => {
  const signingPublicKey = Uint8Array.from([1, 2, 3, 4]);
  const signingFingerprint = await toFingerprint(signingPublicKey);
  const resolver = createDocumentWriterPublicKeyResolver({
    logPrefix: "Documents",
    runtime: {
      resolveTrustedUserIdentity: async (userId) =>
        createTestTrustedUserIdentity({
          signingKeyFingerprint: signingFingerprint,
          signingPublicKey,
          userId,
        }),
      util: { log: () => {} },
    },
    writerKeyLabel: "writer key",
  });

  const resolved = await resolver({
    authorFingerprint: signingFingerprint,
    header: createWriteHeader({
      authorFingerprint: signingFingerprint,
      writerUserId: "user-1",
    }),
    update: {} as never,
  });

  expect(resolved).toBe(signingPublicKey);
});

test("createDocumentWriterPublicKeyResolver caches trusted writer keys", async () => {
  const signingPublicKey = Uint8Array.from([5, 6, 7, 8]);
  const signingFingerprint = await toFingerprint(signingPublicKey);
  let resolveCount = 0;
  const resolver = createDocumentWriterPublicKeyResolver({
    logPrefix: "Container documents",
    runtime: {
      resolveTrustedUserIdentity: async (userId) => {
        resolveCount += 1;
        return createTestTrustedUserIdentity({
          signingKeyFingerprint: signingFingerprint,
          signingPublicKey,
          userId,
        });
      },
      util: { log: () => {} },
    },
    writerKeyLabel: "metadata writer key",
  });
  const header = createWriteHeader({
    authorFingerprint: signingFingerprint,
    writerUserId: "user-1",
  });

  const firstResolved = await resolver({
    authorFingerprint: signingFingerprint,
    header,
    update: {} as never,
  });
  const secondResolved = await resolver({
    authorFingerprint: signingFingerprint,
    header,
    update: {} as never,
  });

  expect(Array.from(firstResolved ?? [])).toEqual(Array.from(signingPublicKey));
  expect(Array.from(secondResolved ?? [])).toEqual(
    Array.from(signingPublicKey),
  );
  expect(resolveCount).toBe(1);
});

test("createDocumentWriterPublicKeyResolver logs a writer fingerprint mismatch", async () => {
  const responsePublicKey = Uint8Array.from([9, 10, 11, 12]);
  const responseFingerprint = await toFingerprint(responsePublicKey);
  const authorFingerprint = await toFingerprint(Uint8Array.from([13, 14]));
  const logs: string[] = [];
  const resolver = createDocumentWriterPublicKeyResolver({
    logPrefix: "Documents",
    runtime: {
      resolveTrustedUserIdentity: async (userId) =>
        createTestTrustedUserIdentity({
          signingKeyFingerprint: responseFingerprint,
          signingPublicKey: responsePublicKey,
          userId,
        }),
      util: { log: (message) => logs.push(message) },
    },
    writerKeyLabel: "writer key",
  });

  const resolved = await resolver({
    authorFingerprint,
    header: createWriteHeader({
      authorFingerprint,
      writerUserId: "user-2",
    }),
    update: {} as never,
  });

  expect(resolved).toBeNull();
  expect(logs).toEqual([
    "Documents: skipped writer key for user-2 because the signing fingerprint does not match the writer.",
  ]);
});

test("createDocumentWriterPublicKeyResolver preserves database-unavailable errors", async () => {
  // A vanished database must keep its type so sync lanes classify the run as
  // benign infrastructure loss; nulling it here would resurface downstream as a
  // generic "writer public key missing" failure that kills the lane.
  const unavailableError = new DatabaseUnavailableError(
    "Trusted user identity resolution requires a ready SQLite trust store",
  );
  const logs: string[] = [];
  const resolver = createDocumentWriterPublicKeyResolver({
    logPrefix: "Documents",
    runtime: {
      resolveTrustedUserIdentity: async () => {
        throw unavailableError;
      },
      util: { log: (message) => logs.push(message) },
    },
    writerKeyLabel: "writer key",
  });

  await expect(
    resolver({
      authorFingerprint: "fingerprint",
      header: createWriteHeader({
        authorFingerprint: "fingerprint",
        writerUserId: "user-2",
      }),
      update: {} as never,
    }),
  ).rejects.toBe(unavailableError);
  expect(logs).toEqual([]);
});

test("createDocumentWriterPublicKeyResolver preserves identity integrity errors", async () => {
  const integrityError = new KeyingVerificationError(
    "equivocation",
    "identity changed",
  );
  const resolver = createDocumentWriterPublicKeyResolver({
    logPrefix: "Documents",
    runtime: {
      resolveTrustedUserIdentity: async () => {
        throw integrityError;
      },
      util: { log: () => {} },
    },
    writerKeyLabel: "writer key",
  });

  await expect(
    resolver({
      authorFingerprint: "fingerprint",
      header: createWriteHeader({
        authorFingerprint: "fingerprint",
        writerUserId: "user-2",
      }),
      update: {} as never,
    }),
  ).rejects.toBe(integrityError);
});
