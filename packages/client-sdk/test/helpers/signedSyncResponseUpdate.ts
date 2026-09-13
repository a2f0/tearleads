import {
  CONTENT_RECORD_ENCRYPTION_SUITE,
  computeDocumentContentRecordCiphertextHash,
  signWriteHeader,
} from "@tearleads/crypto";
import type { DocumentSyncResponse } from "@tearleads/validators/response";
import { targetEnvelopeReference } from "../../src/data/documents/shared/readers";
import type { DocumentCreateAuthor } from "../../src/data/documents/shared/types";
import type { buildDocumentSyncPlan } from "../../src/workflows/documents/syncPlanIdentity";
import { createDocumentEncryptedUpdateFixture } from "./documentEncryptedUpdateFixture";
import { fixtureHash } from "./documentFixturePrimitives";

export async function createSignedSyncResponseUpdate(input: {
  accessManifestHash: string;
  author: DocumentCreateAuthor;
  contentKeyEpoch?: number | undefined;
  id?: string | undefined;
  plan: Awaited<ReturnType<typeof buildDocumentSyncPlan>>;
  targetHash: string;
}): Promise<DocumentSyncResponse["updates"][number]> {
  const id = input.id ?? "550e8400-e29b-41d4-a716-446655440555";
  const partialStartVersionVector = "{}";
  const partialEndVersionVector = '{"actor":3}';
  const plaintextHash = await fixtureHash(`plaintext:${id}`);
  const contentKeyEpoch = input.contentKeyEpoch ?? input.plan.contentKeyEpoch;
  const nonceDomain = {
    version: 1 as const,
    organizationId: input.plan.organizationId,
    objectKind: "document" as const,
    objectId: input.plan.documentId,
    contentKeyEpoch,
    encryptionSuite: CONTENT_RECORD_ENCRYPTION_SUITE,
    contentRecordId: id,
  };
  const { encryptedData, metadataHash, nonceDomainHash } =
    await createDocumentEncryptedUpdateFixture({
      contentKeyEpoch,
      documentId: input.plan.documentId,
      id,
      organizationId: input.plan.organizationId,
      partialEndVersionVector,
      partialStartVersionVector,
      plaintextHash,
    });
  const writeHeader = await signWriteHeader(
    {
      ...nonceDomain,
      dependencyManifestHashes: [
        ...new Set(
          input.plan.sourceContentKeyBundle.targets.map(
            (target) => target.containerManifestHash,
          ),
        ),
      ].sort(),
      accessManifestHash: input.accessManifestHash,
      targetHash: input.targetHash,
      nonceDomainHash,
      metadataHash,
      ciphertextHash:
        await computeDocumentContentRecordCiphertextHash(encryptedData),
      writerUserId: input.author.signerUserId,
      writerDeviceId: input.author.signerDeviceId,
      writerKeyFingerprint: input.author.signerKeyFingerprint,
      signedAt: "2026-04-27T00:00:00.000Z",
    },
    input.author.signerPrivateKey,
  );

  return {
    accessEpoch: 1,
    authorizationTargets: input.plan.sourceContentKeyBundle.targets.map(
      targetEnvelopeReference,
    ),
    id,
    documentId: input.plan.documentId,
    authorFingerprint: input.author.signerKeyFingerprint,
    encryptedData,
    partialStartVersionVector,
    partialEndVersionVector,
    plaintextHash,
    createdAt: "2026-04-27T00:00:00.000Z",
    writeHeader: writeHeader as unknown as Record<string, unknown>,
  };
}
