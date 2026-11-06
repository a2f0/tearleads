import { toFingerprint } from "../fingerprint";
import type { generateSigningSeedAndKeyPair } from "../signing/generateKeyPair";
import { fixtureHash } from "./canonical.testFixtures";
import type { WriteHeader } from "./index";
import {
  CONTENT_RECORD_ENCRYPTION_SUITE,
  computeContentRecordNonceDomainHash,
  signWriteHeader,
} from "./index";

export async function createWriteHeaderFixture(input: {
  readonly dependencyManifestHashes?: readonly string[];
  readonly accessManifestHash: string;
  readonly contentRecordId?: string;
  readonly contentKeyEpoch?: number;
  readonly objectId: string;
  readonly objectKind?: "blob" | "document";
  readonly organizationId: string;
  readonly signing: ReturnType<typeof generateSigningSeedAndKeyPair>;
  readonly targetHash: string;
  readonly writerUserId: string;
}): Promise<WriteHeader> {
  const contentKeyEpoch = input.contentKeyEpoch ?? 1;
  const contentRecordId =
    input.contentRecordId ?? "11111111-1111-4111-8111-111111111111";

  return signWriteHeader(
    {
      version: 1,
      dependencyManifestHashes: [
        ...(input.dependencyManifestHashes ?? []),
      ].sort(),
      organizationId: input.organizationId,
      objectKind: input.objectKind ?? "document",
      objectId: input.objectId,
      accessManifestHash: input.accessManifestHash,
      contentKeyEpoch,
      targetHash: input.targetHash,
      encryptionSuite: CONTENT_RECORD_ENCRYPTION_SUITE,
      contentRecordId,
      nonceDomainHash: await computeContentRecordNonceDomainHash({
        version: 1,
        organizationId: input.organizationId,
        objectKind: input.objectKind ?? "document",
        objectId: input.objectId,
        contentKeyEpoch,
        encryptionSuite: CONTENT_RECORD_ENCRYPTION_SUITE,
        contentRecordId,
      }),
      metadataHash: await fixtureHash(`${contentRecordId}:metadata`),
      ciphertextHash: await fixtureHash(`${contentRecordId}:ciphertext`),
      writerUserId: input.writerUserId,
      writerDeviceId: "device-1",
      writerKeyFingerprint: await toFingerprint(input.signing.signingPublicKey),
      signedAt: "2026-04-25T12:00:00.000Z",
    },
    input.signing.signingPrivateKey,
  );
}
