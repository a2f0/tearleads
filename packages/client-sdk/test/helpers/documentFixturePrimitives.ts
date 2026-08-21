import {
  generateSigningSeedAndKeyPair,
  toFingerprint,
  wrapDekForRecipients,
} from "@symcrypt/crypto";
import { bytesToBase64 } from "@symcrypt/encoding";
import type { ContainerWriterProjectionResponse } from "@symcrypt/validators/response";
import type {
  DocumentCreateAuthor,
  DocumentWriterPublicKeyResolver,
} from "../../src/data/documents/shared/types";

export async function fixtureHash(label: string): Promise<string> {
  return toFingerprint(new TextEncoder().encode(`document:${label}`));
}

interface DeepNonCanonicalRecord {
  next?: DeepNonCanonicalRecord;
  notJson?: undefined;
}

export function createDeepNonCanonicalRecord(
  depth: number,
): DeepNonCanonicalRecord {
  const root: DeepNonCanonicalRecord = {};
  let cursor = root;

  for (let index = 0; index < depth; index += 1) {
    const next: DeepNonCanonicalRecord = {};
    cursor.next = next;
    cursor = next;
  }

  cursor.notJson = undefined;
  return root;
}

export async function createUserContainerWrap(input: {
  containerKeyEpochId: string;
  containerKek: Uint8Array;
  publicKey: Uint8Array;
  recipientKeyEpochId?: string | undefined;
  userId: string;
  wrapManifestHash: string;
}) {
  const [recipient] = await wrapDekForRecipients(input.containerKek, [
    input.publicKey,
  ]);
  if (!recipient) {
    throw new Error("Expected recipient wrap");
  }

  return {
    containerKeyEpochId: input.containerKeyEpochId,
    recipientKind: "user" as const,
    recipientId: input.userId,
    recipientKeyEpochId:
      input.recipientKeyEpochId ?? `user:${input.userId}:epoch-1`,
    recipientKeyFingerprint: recipient.keyFingerprint,
    kemCipherText: bytesToBase64(recipient.kemCipherText),
    wrappedKey: bytesToBase64(recipient.wrappedKey),
    wrapManifestHash: input.wrapManifestHash,
  };
}

export async function createProjection(): Promise<ContainerWriterProjectionResponse> {
  const containerId = "container-1";
  const organizationId = "organization-1";
  const manifestHash = await fixtureHash("container-manifest");
  const keyEpochHash = await fixtureHash("container-key-epoch");
  const keyTargetHash = await fixtureHash("container-key-target");

  return {
    containerId,
    organizationId,
    path: [
      {
        event: {
          event: {},
          body: {},
          eventHash: await fixtureHash("container-event"),
        },
        manifest: {},
        manifestHash,
        state: {
          containerId,
          organizationId,
        },
      },
    ],
    containerKeks: [
      {
        containerId,
        accessManifestHash: manifestHash,
        containerKeyEpochId: "container-key-epoch-1",
        containerKeyEpoch: 1,
        keyEpoch: {},
        keyEpochHash,
        keyTargetHash,
        parentContainerKeyEpochId: null,
        containerManifestHistory: [],
        keyring: null,
        recipientTargets: [{}],
        wraps: [{}],
      },
    ],
  };
}

export async function createAuthor(input?: {
  organizationId?: string;
  userId?: string;
}): Promise<{
  author: DocumentCreateAuthor;
  signingPublicKey: Uint8Array;
}> {
  const signingKeyPair = generateSigningSeedAndKeyPair();
  const signerKeyFingerprint = await toFingerprint(
    signingKeyPair.signingPublicKey,
  );

  return {
    author: {
      organizationId: input?.organizationId ?? "organization-1",
      signerDeviceId: "test-device-1",
      signerKeyFingerprint,
      signerPrivateKey: signingKeyPair.signingPrivateKey,
      signerUserId: input?.userId ?? "user-1",
    },
    signingPublicKey: signingKeyPair.signingPublicKey,
  };
}

export function writerKeyResolver(input: {
  author: DocumentCreateAuthor;
  signingPublicKey: Uint8Array;
}): DocumentWriterPublicKeyResolver {
  return async ({ writerSigningKeyFingerprint, writerUserId }) => {
    if (
      writerUserId !== input.author.signerUserId ||
      writerSigningKeyFingerprint !== input.author.signerKeyFingerprint
    ) {
      return null;
    }
    return input.signingPublicKey;
  };
}
