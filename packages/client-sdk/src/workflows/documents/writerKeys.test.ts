import { expect, test } from "bun:test";
import { KeyingVerificationError, toFingerprint } from "@tearleads/crypto";
import { createTestTrustedUserIdentity } from "../../../test/helpers/trustedUserIdentity";
import { DatabaseUnavailableError } from "../../data/sync/databaseUnavailable";
import { createDocumentWriterPublicKeyResolver } from "./writerKeys";

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
    writerSigningKeyFingerprint: signingFingerprint,
    writerUserId: "user-1",
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
  const firstResolved = await resolver({
    writerSigningKeyFingerprint: signingFingerprint,
    writerUserId: "user-1",
  });
  const secondResolved = await resolver({
    writerSigningKeyFingerprint: signingFingerprint,
    writerUserId: "user-1",
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
    writerSigningKeyFingerprint: authorFingerprint,
    writerUserId: "user-2",
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
      writerSigningKeyFingerprint: "fingerprint",
      writerUserId: "user-2",
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
      writerSigningKeyFingerprint: "fingerprint",
      writerUserId: "user-2",
    }),
  ).rejects.toBe(integrityError);
});
