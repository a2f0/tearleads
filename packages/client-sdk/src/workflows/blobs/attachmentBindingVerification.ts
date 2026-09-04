import {
  type VerifiedContainerAccessManifest,
  verifyAttachmentBindingEvent,
} from "@tearleads/crypto";
import type { DecryptDocumentAttachmentBlobInput } from "../../data/documents/blob/shared/types";
import {
  readCanonicalJson,
  readCanonicalRecord,
} from "../../data/keyingCanonicalJson";
import {
  type DocumentWriterProjectionAuthorization,
  type ProjectionUserKeyResolver,
  readAccessEvent,
  readRecordString,
  readRequiredRecordValue,
  resolveEventContainerPaths,
} from "../../data/keyingProjectionVerification";

export async function assertAttachmentBindingVerified(input: {
  readonly authorization: DocumentWriterProjectionAuthorization | undefined;
  readonly binding: Pick<
    DecryptDocumentAttachmentBlobInput["binding"],
    | "bindingEvent"
    | "documentManifestHash"
    | "previousBindingId"
    | "bindingId"
    | "blobId"
  >;
  readonly expectedDocumentId: string;
  readonly expectedSlotId: string;
  readonly resolveProjectionUserKey: ProjectionUserKeyResolver;
}): Promise<VerifiedContainerAccessManifest[][]> {
  if (!input.authorization) {
    throw new Error("Attachment binding lacks verified document authority");
  }
  if (
    !input.binding.bindingEvent ||
    !input.binding.documentManifestHash ||
    input.binding.previousBindingId === undefined
  ) {
    throw new Error("Attachment binding lacks signed verification material");
  }
  const eventBundle = readCanonicalRecord(
    input.binding.bindingEvent,
    "Attachment binding event bundle",
  );
  const event = readAccessEvent(
    readRequiredRecordValue(
      eventBundle,
      "event",
      "Attachment binding event bundle",
    ),
    "Attachment binding event",
  );
  const signer = await input.resolveProjectionUserKey(event.signerUserId);
  if (!signer) {
    throw new Error("Attachment binding signer identity is unavailable");
  }
  const documentManifest = input.authorization.documentManifestByHash.get(
    input.binding.documentManifestHash,
  );
  if (!documentManifest) {
    throw new Error("Attachment binding document manifest is unverified");
  }
  const { dependencyContainerPaths } = resolveEventContainerPaths({
    containerPathByManifestHash:
      input.authorization.containerPathByManifestHash,
    dependencyManifestHashes: event.dependencyManifestHashes.filter(
      (hash) => hash !== input.binding.documentManifestHash,
    ),
  });
  const verified = await verifyAttachmentBindingEvent({
    authorizingContainerPaths: dependencyContainerPaths,
    body: readCanonicalJson(
      readRequiredRecordValue(
        eventBundle,
        "body",
        "Attachment binding event bundle",
      ),
      "Attachment binding event body",
    ),
    documentManifest,
    event,
    expectedBindingId: input.binding.bindingId,
    expectedBlobId: input.binding.blobId,
    expectedDocumentId: input.expectedDocumentId,
    expectedDocumentManifestHash: input.binding.documentManifestHash,
    expectedPreviousBindingId: input.binding.previousBindingId,
    principalPolicies: input.authorization.principalPolicies,
    signerPublicKey: signer.signingPublicKey,
  });
  if (!verified.ok) {
    throw verified.error;
  }
  if (
    verified.value.slotId !== input.expectedSlotId ||
    readRecordString(
      eventBundle,
      "eventHash",
      "Attachment binding event bundle",
    ) !== verified.value.event.eventHash
  ) {
    throw new Error("Attachment binding slot or event hash is inconsistent");
  }
  return dependencyContainerPaths;
}
