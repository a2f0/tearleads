import { expect, test } from "bun:test";
import { generateSigningSeedAndKeyPair } from "../signing/generateKeyPair";
import { fixtureContainerKekMaterialId } from "./containerKekMaterial.testFixtures";
import { deriveBlobKekTargets } from "./index";
import {
  createContainerManifestFixture,
  createDocumentLinkSetManifestFixture,
  createVerifiedAttachmentBinding,
  createVerifiedContainerKekStateFixture,
  createVerifiedDocumentAccessEvent,
  expectVerificationError,
} from "./testFixtures";

async function createOrganizationBlobBinding(input: {
  blobId: string;
  containerId: string;
  documentId: string;
  organizationId: string;
  signer: ReturnType<typeof generateSigningSeedAndKeyPair>;
  writerUserId: string;
}) {
  const container = await createContainerManifestFixture({
    containerId: input.containerId,
    containerKeyEpochId: await fixtureContainerKekMaterialId(
      `${input.containerId}-key-epoch-1`,
    ),
    directGrants: [
      {
        accessLevel: "write",
        subjectId: input.writerUserId,
        subjectType: "user",
      },
    ],
    organizationId: input.organizationId,
    signer: input.signer,
    signerUserId: input.writerUserId,
  });
  const documentEvent = await createVerifiedDocumentAccessEvent({
    body: {
      containerId: container.state.containerId,
      containerManifestHash: container.manifestHash,
      eventType: "document.link",
    },
    dependencyManifestHashes: [container.manifestHash],
    objectId: input.documentId,
    organizationId: input.organizationId,
    previousManifestHash: null,
    signer: input.signer,
    signerUserId: input.writerUserId,
  });
  const documentManifest = await createDocumentLinkSetManifestFixture({
    documentId: input.documentId,
    event: documentEvent,
    linkedContainerIds: [container.state.containerId],
    organizationId: input.organizationId,
  });
  const containerKekState = await createVerifiedContainerKekStateFixture({
    manifest: container,
    recipientUserId: input.writerUserId,
  });
  const binding = await createVerifiedAttachmentBinding({
    bindingId: `${input.documentId}-binding`,
    blobId: input.blobId,
    documentManifest,
    signer: input.signer,
    signerUserId: input.writerUserId,
    slotId: "image",
    writePath: [container],
  });

  return { binding, container, containerKekState, documentManifest };
}

test("blob KEK targets reject active bindings across organizations", async () => {
  const blobId = "cross-organization-blob";
  const writerUserId = "writer-user";
  const signer = generateSigningSeedAndKeyPair();
  const personal = await createOrganizationBlobBinding({
    blobId,
    containerId: "personal-container",
    documentId: "personal-document",
    organizationId: "personal-organization",
    signer,
    writerUserId,
  });
  const custom = await createOrganizationBlobBinding({
    blobId,
    containerId: "custom-container",
    documentId: "custom-document",
    organizationId: "custom-organization",
    signer,
    writerUserId,
  });

  const result = await deriveBlobKekTargets({
    activeBindings: [personal.binding, custom.binding],
    blobId,
    containerKekStates: [personal.containerKekState, custom.containerKekState],
    documentManifests: [personal.documentManifest, custom.documentManifest],
    linkedContainerManifests: [personal.container, custom.container],
  });

  expectVerificationError(result, "object_mismatch");
  if (result.ok) {
    throw new Error("Expected cross-organization blob targets to fail.");
  }
  expect(result.error.message).toContain("must stay within one organization");
});
