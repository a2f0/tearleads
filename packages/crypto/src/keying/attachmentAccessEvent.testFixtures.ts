import { toFingerprint } from "../fingerprint";
import type { generateSigningSeedAndKeyPair } from "../signing/generateKeyPair";
import type {
  AttachmentAccessEventBody,
  AttachmentBindAccessEventBody,
  KeyingCanonicalJson,
  VerifiedContainerAccessManifest,
  VerifiedDocumentLinkSetManifest,
} from "./index";
import {
  computeAccessEventBodyHash,
  signAccessEvent,
  verifyAttachmentBindingEvent,
} from "./index";

export async function createSignedAttachmentEvent(input: {
  readonly body: AttachmentAccessEventBody;
  readonly dependencyManifestHashes: readonly string[];
  readonly objectId: string;
  readonly organizationId: string;
  readonly signer: ReturnType<typeof generateSigningSeedAndKeyPair>;
  readonly signerUserId: string;
}) {
  return signAccessEvent(
    {
      version: 1,
      eventId: crypto.randomUUID(),
      eventType: input.body.eventType,
      objectKind: "blob",
      objectId: input.objectId,
      organizationId: input.organizationId,
      previousManifestHash: null,
      dependencyManifestHashes: [...input.dependencyManifestHashes],
      bodyHash: await computeAccessEventBodyHash(
        input.body as unknown as KeyingCanonicalJson,
      ),
      signerUserId: input.signerUserId,
      signerDeviceId: "device-1",
      signerKeyFingerprint: await toFingerprint(input.signer.signingPublicKey),
      signedAt: "2026-04-25T12:00:00.000Z",
    },
    input.signer.signingPrivateKey,
  );
}

export async function createVerifiedAttachmentBinding(input: {
  readonly bindingId: string;
  readonly blobId: string;
  readonly documentManifest: VerifiedDocumentLinkSetManifest;
  readonly expectedBindingId?: string | null;
  readonly signer: ReturnType<typeof generateSigningSeedAndKeyPair>;
  readonly signerUserId: string;
  readonly slotId: string;
  readonly writePath: readonly VerifiedContainerAccessManifest[];
}) {
  const body: AttachmentBindAccessEventBody = {
    eventType: "attachment.bind",
    bindingId: input.bindingId,
    blobId: input.blobId,
    documentId: input.documentManifest.state.documentId,
    slotId: input.slotId,
    expectedBindingId: input.expectedBindingId ?? null,
    documentManifestHash: input.documentManifest.manifestHash,
  };
  const writeManifest = input.writePath.at(-1);
  if (!writeManifest) {
    throw new Error("Attachment binding fixture requires a write path");
  }
  const event = await createSignedAttachmentEvent({
    body,
    dependencyManifestHashes: [
      input.documentManifest.manifestHash,
      writeManifest.manifestHash,
    ],
    objectId: input.blobId,
    organizationId: input.documentManifest.state.organizationId,
    signer: input.signer,
    signerUserId: input.signerUserId,
  });
  const verifiedBinding = await verifyAttachmentBindingEvent({
    body: body as unknown as KeyingCanonicalJson,
    event,
    signerPublicKey: input.signer.signingPublicKey,
    documentManifest: input.documentManifest,
    authorizingContainerPaths: [input.writePath],
  });

  if (!verifiedBinding.ok) {
    throw verifiedBinding.error;
  }

  return verifiedBinding.value;
}
