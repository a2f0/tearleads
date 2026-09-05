import { expect, test } from "bun:test";
import { computeAccessEventHash } from "@tearleads/crypto";
import {
  createDocumentLinkSetManifestFixture,
  createSignedAttachmentEvent,
  createVerifiedDocumentAccessEvent,
} from "@tearleads/crypto/test-fixtures";
import { createScenario } from "../../../test/helpers/ancestorCitationScenario";
import { assertAttachmentBindingVerified } from "./attachmentBindingVerification";

async function historicalBinding(omitAncestor = false) {
  const scenario = await createScenario();
  const { root1, root2, child1, mallory } = scenario;
  const documentEvent = await createVerifiedDocumentAccessEvent({
    body: {
      eventType: "document.link",
      containerId: child1.state.containerId,
      containerManifestHash: child1.manifestHash,
    },
    dependencyManifestHashes: [root1.manifestHash, child1.manifestHash],
    objectId: "historical-attachment-document",
    organizationId: root1.state.organizationId,
    previousManifestHash: null,
    signer: mallory.keyPair,
    signerUserId: mallory.userId,
  });
  const documentManifest = await createDocumentLinkSetManifestFixture({
    documentId: documentEvent.event.objectId,
    event: documentEvent,
    linkedContainerIds: [child1.state.containerId],
    organizationId: root1.state.organizationId,
  });
  const body = {
    eventType: "attachment.bind" as const,
    bindingId: "historical-binding",
    blobId: "historical-blob",
    documentId: documentManifest.state.documentId,
    documentManifestHash: documentManifest.manifestHash,
    slotId: "preview",
    expectedBindingId: null,
  };
  const event = await createSignedAttachmentEvent({
    body,
    dependencyManifestHashes: [
      documentManifest.manifestHash,
      child1.manifestHash,
      ...(omitAncestor ? [] : [root1.manifestHash]),
    ],
    objectId: body.blobId,
    organizationId: root1.state.organizationId,
    signer: mallory.keyPair,
    signerUserId: mallory.userId,
  });
  return {
    input: {
      authorization: {
        // Historical evidence is deliberately rootless and the served current
        // ancestor has revoked this signer. Only the signed old path authorizes.
        containerPathByManifestHash: new Map(
          [root1, root2, child1].map((head) => [head.manifestHash, [head]]),
        ),
        documentManifestByHash: new Map([
          [documentManifest.manifestHash, documentManifest],
        ]),
        principalPolicies: [],
      },
      binding: {
        bindingId: body.bindingId,
        blobId: body.blobId,
        bindingEvent: {
          body,
          event: { ...event },
          eventHash: await computeAccessEventHash(event),
        },
        documentManifestHash: documentManifest.manifestHash,
        previousBindingId: null,
      },
      expectedDocumentId: body.documentId,
      expectedSlotId: body.slotId,
      resolveProjectionUserKey: scenario.resolveUserKey,
    },
  };
}

test("a historical binding reconstructs inherited authority from its own full citations", async () => {
  const { input } = await historicalBinding();
  await expect(assertAttachmentBindingVerified(input)).resolves.toBeUndefined();
});

test("a historical binding cannot borrow an uncited ancestor from verified history", async () => {
  const { input } = await historicalBinding(true);
  await expect(assertAttachmentBindingVerified(input)).rejects.toThrow(
    "does not cite ancestor",
  );
});
