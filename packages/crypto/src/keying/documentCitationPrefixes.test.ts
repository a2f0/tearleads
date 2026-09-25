import { expect, test } from "bun:test";
import { fixtureContainerKekMaterialId } from "./containerKekMaterial.testFixtures";
import { citationScopeFixture } from "./documentCitationScope.testFixtures";
import {
  verifyAttachmentBindingEvent,
  verifyAttachmentDetachEvent,
  verifyContainerKekState,
  verifyWriteHeader,
} from "./index";
import {
  createContainerKeyEpochFixture,
  createContainerKeyWrap,
  createContainerManifestFixture,
  createSignedAttachmentEvent,
  createVerifiedAttachmentBinding,
  createVerifiedContainerKekStateFixture,
  createWriteHeaderFixture,
  deriveRequiredBlobKekTargets,
  deriveRequiredDocumentKekTargets,
} from "./testFixtures";

async function prefixFixture() {
  const fixture = await citationScopeFixture();
  const { first, signer, signerUserId, organizationId } = fixture;
  const child = await createContainerManifestFixture({
    containerId: "child",
    parentContainerId: first.state.containerId,
    parentManifestHash: first.manifestHash,
    directGrants: [],
    containerKeyEpochId: await fixtureContainerKekMaterialId("child", "child"),
    organizationId,
    signer,
    signerUserId,
  });
  const paths = [[first], [first, child]];
  const document = await fixture.transition(
    "document.link",
    child,
    null,
    paths,
  );
  const parentKek = await createVerifiedContainerKekStateFixture({
    manifest: first,
    recipientUserId: signerUserId,
  });
  const keyEpoch = await createContainerKeyEpochFixture({
    manifest: child,
    parentContainerKeyEpochId: parentKek.containerKeyEpochId,
  });
  const verifiedKek = await verifyContainerKekState({
    containerManifest: child,
    keyEpoch,
    parentKekState: parentKek,
    parentManifestHistory: [first],
    wraps: [
      await createContainerKeyWrap({
        containerKeyEpochId: keyEpoch.id,
        recipientKind: "container",
        recipientId: parentKek.containerId,
        recipientKeyEpochId: parentKek.containerKeyEpochId,
        recipientKeyFingerprint: parentKek.keyEpochHash,
        wrapManifestHash: child.manifestHash,
      }),
    ],
  });
  if (!verifiedKek.ok) throw verifiedKek.error;
  const kek = verifiedKek.value;
  const documentKekTargets = await deriveRequiredDocumentKekTargets({
    documentManifest: document,
    linkedContainerManifests: [child],
    containerKekStates: [kek],
  });
  const binding = await createVerifiedAttachmentBinding({
    bindingId: "binding",
    blobId: "blob",
    documentManifest: document,
    signer,
    signerUserId,
    slotId: "slot",
    writePath: [first, child],
  });
  const blobKekTargets = await deriveRequiredBlobKekTargets({
    activeBindings: [binding],
    blobId: "blob",
    containerKekStates: [kek],
    documentManifests: [document],
    linkedContainerManifests: [child],
  });
  return {
    ...fixture,
    child,
    paths,
    document,
    documentKekTargets,
    blobKekTargets,
  };
}

test.each(["document", "blob"] as const)(
  "historical %s content accepts reconstructed ancestor prefixes",
  async (objectKind) => {
    const f = await prefixFixture();
    const header = await createWriteHeaderFixture({
      dependencyManifestHashes: [f.first.manifestHash, f.child.manifestHash],
      accessManifestHash:
        objectKind === "document"
          ? f.document.manifestHash
          : f.blobKekTargets.blobAccessManifestHash,
      objectId: objectKind,
      objectKind,
      organizationId: f.organizationId,
      signing: f.signer,
      writerUserId: f.signerUserId,
      targetHash:
        objectKind === "document"
          ? f.documentKekTargets.documentKeyTargetHash
          : f.blobKekTargets.blobKeyTargetHash,
    });
    for (const authorizationMembership of ["current", "referenced"] as const) {
      const result = await verifyWriteHeader({
        authorizationMembership,
        header,
        writerPublicKey: f.signer.signingPublicKey,
        ...(objectKind === "document"
          ? {
              documentAuthorization: {
                documentManifest: f.document,
                documentKekTargets: f.documentKekTargets,
                authorizingContainerPaths: f.paths,
              },
            }
          : {
              blobAuthorization: {
                blobKekTargets: f.blobKekTargets,
                authorizingContainerPaths: f.paths,
              },
            }),
      });
      expect(result.ok, JSON.stringify(result)).toBe(true);
    }
  },
);

test.each(["attachment.bind", "attachment.detach"] as const)(
  "%s accepts reconstructed ancestor prefixes",
  async (eventType) => {
    const f = await prefixFixture();
    const body = {
      bindingId: "binding",
      blobId: "blob",
      documentId: "document",
      documentManifestHash: f.document.manifestHash,
      slotId: "slot",
      ...(eventType === "attachment.bind"
        ? { eventType, expectedBindingId: null }
        : { eventType }),
    };
    const event = await createSignedAttachmentEvent({
      body,
      dependencyManifestHashes: [
        f.document.manifestHash,
        f.first.manifestHash,
        f.child.manifestHash,
      ],
      objectId: "blob",
      organizationId: f.organizationId,
      signer: f.signer,
      signerUserId: f.signerUserId,
    });
    const verify =
      eventType === "attachment.bind"
        ? verifyAttachmentBindingEvent
        : verifyAttachmentDetachEvent;
    for (const authorizationMembership of ["current", "referenced"] as const) {
      const result = await verify({
        authorizationMembership,
        body,
        event,
        signerPublicKey: f.signer.signingPublicKey,
        documentManifest: f.document,
        authorizingContainerPaths: f.paths,
      });
      expect(result.ok, JSON.stringify(result)).toBe(true);
    }
  },
);
