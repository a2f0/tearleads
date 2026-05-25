import { expect, test } from "bun:test";
import {
  CONTENT_RECORD_ENCRYPTION_SUITE,
  toFingerprint,
  type WriteHeader,
} from "@tearleads/crypto";
import { bytesToBase64 } from "@tearleads/encoding";
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

test("createDocumentWriterPublicKeyResolver uses the local signing key when allowed", async () => {
  const signingPublicKey = Uint8Array.from([1, 2, 3, 4]);
  const signingFingerprint = await toFingerprint(signingPublicKey);
  let remoteFetchCount = 0;
  const resolver = createDocumentWriterPublicKeyResolver({
    logPrefix: "Documents",
    runtime: {
      apiClient: {
        getEncapsulationKey: async () => {
          remoteFetchCount += 1;
          return null;
        },
      },
      auth: {
        userId: "user-1",
      },
      crypto: {
        signingFingerprint,
        signingKeyPair: { signingPublicKey },
      },
      util: {
        log: () => {},
      },
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
  expect(remoteFetchCount).toBe(0);
});

test("createDocumentWriterPublicKeyResolver caches remote writer keys", async () => {
  const signingPublicKey = Uint8Array.from([5, 6, 7, 8]);
  const signingFingerprint = await toFingerprint(signingPublicKey);
  let remoteFetchCount = 0;
  const resolver = createDocumentWriterPublicKeyResolver({
    includeLocalSigningKey: false,
    logPrefix: "Container documents",
    runtime: {
      apiClient: {
        getEncapsulationKey: async (userId) => {
          remoteFetchCount += 1;
          return {
            userId,
            encapsulationPublicKey: "encapsulation-public-key",
            signingKeyFingerprint: signingFingerprint,
            signingPublicKey: bytesToBase64(signingPublicKey),
          };
        },
      },
      auth: {
        userId: "user-1",
      },
      crypto: {
        signingFingerprint,
        signingKeyPair: { signingPublicKey },
      },
      util: {
        log: () => {},
      },
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
  expect(remoteFetchCount).toBe(1);
});

test("createDocumentWriterPublicKeyResolver logs mismatched remote writer keys", async () => {
  const responsePublicKey = Uint8Array.from([9, 10, 11, 12]);
  const responseFingerprint = await toFingerprint(responsePublicKey);
  const authorFingerprint = await toFingerprint(Uint8Array.from([13, 14]));
  const logs: string[] = [];
  const resolver = createDocumentWriterPublicKeyResolver({
    logPrefix: "Documents",
    runtime: {
      apiClient: {
        getEncapsulationKey: async (userId) => ({
          userId,
          encapsulationPublicKey: "encapsulation-public-key",
          signingKeyFingerprint: responseFingerprint,
          signingPublicKey: bytesToBase64(responsePublicKey),
        }),
      },
      auth: {},
      crypto: {},
      util: {
        log: (message) => logs.push(message),
      },
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
    "Documents: skipped writer key for user-2 because the signing fingerprint does not match the public key.",
  ]);
});
