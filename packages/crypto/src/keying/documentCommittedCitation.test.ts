import { test } from "bun:test";
import { citationScopeFixture } from "./documentCitationScope.testFixtures";
import { verifyWriteHeader } from "./index";
import {
  createContainerManifestFixture,
  createVerifiedAttachmentBinding,
  createVerifiedContainerKekStateFixture,
  createWriteHeaderFixture,
  deriveRequiredBlobKekTargets,
  deriveRequiredDocumentKekTargets,
  expectVerificationError,
} from "./testFixtures";

test.each(["document", "blob"] as const)(
  "%s writes refuse a linked container at a non-target head even after valid authority",
  async (objectKind) => {
    const fixture = await citationScopeFixture();
    const { first, second, signer, signerUserId, organizationId } = fixture;
    const document = await fixture.transition(
      "document.link",
      second,
      fixture.document,
      [[first]],
    );
    const otherSecond = await createContainerManifestFixture({
      ...second.state,
      epoch: second.state.epoch + 1,
      previousManifestHash: second.manifestHash,
      signer,
      signerUserId,
    });
    const keks = await Promise.all(
      [first, second].map((manifest) =>
        createVerifiedContainerKekStateFixture({
          manifest,
          recipientUserId: signerUserId,
        }),
      ),
    );
    const documentKekTargets = await deriveRequiredDocumentKekTargets({
      documentManifest: document,
      linkedContainerManifests: [first, second],
      containerKekStates: keks,
    });
    const binding = await createVerifiedAttachmentBinding({
      bindingId: "binding",
      blobId: "blob",
      documentManifest: document,
      signer,
      signerUserId,
      slotId: "slot",
      writePath: [first],
    });
    const blobKekTargets = await deriveRequiredBlobKekTargets({
      activeBindings: [binding],
      blobId: "blob",
      containerKekStates: keks,
      documentManifests: [document],
      linkedContainerManifests: [first, second],
    });
    const paths = [[first], [otherSecond]];
    const header = await createWriteHeaderFixture({
      dependencyManifestHashes: paths.flat().map((head) => head.manifestHash),
      accessManifestHash:
        objectKind === "document"
          ? document.manifestHash
          : blobKekTargets.blobAccessManifestHash,
      objectId: objectKind,
      objectKind,
      organizationId,
      signing: signer,
      targetHash:
        objectKind === "document"
          ? documentKekTargets.documentKeyTargetHash
          : blobKekTargets.blobKeyTargetHash,
      writerUserId: signerUserId,
    });
    expectVerificationError(
      await verifyWriteHeader({
        header,
        writerPublicKey: signer.signingPublicKey,
        ...(objectKind === "document"
          ? {
              documentAuthorization: {
                documentManifest: document,
                documentKekTargets,
                authorizingContainerPaths: paths,
              },
            }
          : {
              blobAuthorization: {
                blobKekTargets,
                authorizingContainerPaths: paths,
              },
            }),
      }),
      "object_mismatch",
    );
  },
);
