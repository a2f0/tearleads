import { expect, test } from "bun:test";
import { db } from "@symcrypt/api-shared/postgres";
import { attachmentBindings } from "@symcrypt/api-shared/schema";
import {
  type AttachmentBindAccessEventBody,
  type AttachmentDetachAccessEventBody,
  computeAccessEventBodyHash,
  computeKeyingDomainHash,
  type KeyingCanonicalJson,
  type VerifiedAccessEvent,
  type VerifiedAttachmentBinding,
  type VerifiedAttachmentDetach,
} from "@symcrypt/crypto";
import { eq } from "drizzle-orm";
import {
  storeVerifiedAttachmentBinding,
  storeVerifiedAttachmentDetach,
} from "./attachmentBindingStore";

async function hashOf(label: string): Promise<string> {
  return computeKeyingDomainHash("symcrypt.keying.access-event-body", {
    label,
  });
}

async function verifiedAttachmentEvent(
  body: AttachmentBindAccessEventBody | AttachmentDetachAccessEventBody,
  organizationId: string,
): Promise<VerifiedAccessEvent> {
  const eventHash = await hashOf(`${body.eventType}:${body.bindingId}:event`);

  return {
    event: {
      version: 1,
      eventId: crypto.randomUUID(),
      eventType: body.eventType,
      objectKind: "blob",
      objectId: body.blobId,
      organizationId,
      previousManifestHash: null,
      dependencyManifestHashes: [body.documentManifestHash],
      bodyHash: await computeAccessEventBodyHash(
        body as unknown as KeyingCanonicalJson,
      ),
      signerUserId: crypto.randomUUID(),
      signerDeviceId: "device-1",
      signerKeyFingerprint: await hashOf(`${body.eventType}:signer`),
      signedAt: new Date().toISOString(),
      signature: `signature:${eventHash}`,
    },
    body: body as unknown as KeyingCanonicalJson,
    eventHash,
  } as unknown as VerifiedAccessEvent;
}

test("storeVerifiedAttachmentBinding projects signed bind and detach events", async () => {
  const organizationId = crypto.randomUUID();
  const bindingId = crypto.randomUUID();
  const blobId = crypto.randomUUID();
  const documentId = crypto.randomUUID();
  const documentManifestHash = await hashOf(`${documentId}:manifest`);
  const body: AttachmentBindAccessEventBody = {
    eventType: "attachment.bind",
    bindingId,
    blobId,
    documentId,
    slotId: "slot-a",
    expectedBindingId: null,
    documentManifestHash,
  };
  const event = await verifiedAttachmentEvent(body, organizationId);
  const binding = {
    bindingId,
    blobId,
    documentId,
    slotId: body.slotId,
    documentManifestHash,
    event,
    body,
  } as unknown as VerifiedAttachmentBinding;

  const stored = await storeVerifiedAttachmentBinding(binding, db);
  expect(stored).toMatchObject({
    id: bindingId,
    blobId,
    documentId,
    slotId: "slot-a",
    attachmentEventHash: event.eventHash,
    documentManifestHash,
  });

  await expect(
    storeVerifiedAttachmentBinding(binding, db),
  ).resolves.toMatchObject({
    id: bindingId,
  });

  const detachBody: AttachmentDetachAccessEventBody = {
    eventType: "attachment.detach",
    bindingId,
    blobId,
    documentId,
    slotId: body.slotId,
    documentManifestHash: await hashOf(`${documentId}:detach-manifest`),
  };
  const detachEvent = await verifiedAttachmentEvent(detachBody, organizationId);
  const detach = {
    bindingId,
    blobId,
    documentId,
    slotId: body.slotId,
    documentManifestHash: detachBody.documentManifestHash,
    event: detachEvent,
    body: detachBody,
  } as unknown as VerifiedAttachmentDetach;

  await storeVerifiedAttachmentDetach(detach, db);

  const [row] = await db
    .select({ detachedAt: attachmentBindings.detachedAt })
    .from(attachmentBindings)
    .where(eq(attachmentBindings.id, bindingId))
    .limit(1);
  expect(row?.detachedAt).toBeInstanceOf(Date);
});
