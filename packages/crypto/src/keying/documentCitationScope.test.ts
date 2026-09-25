import { expect, test } from "bun:test";
import { citationScopeFixture } from "./documentCitationScope.testFixtures";
import {
  verifyAttachmentBindingEvent,
  verifyAttachmentDetachEvent,
  verifyDocumentLinkSetManifest,
  verifyWriteHeader,
} from "./index";
import {
  createContainerManifestFixture,
  createSignedAttachmentEvent,
  createVerifiedAttachmentBinding,
  createVerifiedContainerKekStateFixture,
  createWriteHeaderFixture,
  deriveRequiredBlobKekTargets,
  deriveRequiredDocumentKekTargets,
  expectVerificationError,
} from "./testFixtures";
import type {
  AttachmentAccessEventBody,
  VerifiedContainerAccessManifest,
  VerifiedDocumentLinkSetManifest,
} from "./types";

test.each(["unrelated", "foreign"] as const)(
  "link-set transitions reject %s citations in either order",
  async (kind) => {
    const fixture = await citationScopeFixture();
    const { first, second, document, transition } = fixture;
    const extra = fixture[kind];
    const check = (
      manifest: VerifiedDocumentLinkSetManifest,
      target: VerifiedContainerAccessManifest,
      previous: VerifiedDocumentLinkSetManifest | null,
      paths: VerifiedContainerAccessManifest[][],
    ) =>
      verifyDocumentLinkSetManifest({
        event: manifest.event,
        expectedManifestHash: manifest.manifestHash,
        manifest: manifest.manifest,
        previousManifest: previous,
        targetContainerPath: [target],
        authorizingContainerPaths: paths,
      });
    expect((await check(document, first, null, [])).ok).toBe(true);
    const initial = await transition("document.link", first, null, [[extra]]);
    expectVerificationError(
      await check(initial, first, null, [[extra]]),
      "object_mismatch",
    );
    const linked = await transition("document.link", second, document, [
      [first],
    ]);
    expect((await check(linked, second, document, [[first]])).ok).toBe(true);
    for (const paths of [
      [[first], [extra]],
      [[extra], [first]],
    ]) {
      const poisonedLink = await transition(
        "document.link",
        second,
        document,
        paths,
      );
      expectVerificationError(
        await check(poisonedLink, second, document, paths),
        "object_mismatch",
      );
      const poisonedUnlink = await transition(
        "document.unlink",
        second,
        linked,
        paths,
      );
      expectVerificationError(
        await check(poisonedUnlink, second, linked, paths),
        "object_mismatch",
      );
    }
  },
);

test.each(["unrelated", "foreign"] as const)(
  "attachment events reject %s citations",
  async (kind) => {
    const fixture = await citationScopeFixture();
    const { first, document, signer, signerUserId, organizationId } = fixture;
    for (const eventType of ["attachment.bind", "attachment.detach"] as const) {
      const body: AttachmentAccessEventBody = {
        bindingId: "binding",
        blobId: "blob",
        documentId: "document",
        documentManifestHash: document.manifestHash,
        slotId: "slot",
        ...(eventType === "attachment.bind"
          ? { eventType, expectedBindingId: null }
          : { eventType }),
      };
      const event = await createSignedAttachmentEvent({
        body,
        dependencyManifestHashes: [
          document.manifestHash,
          first.manifestHash,
          fixture[kind].manifestHash,
        ],
        objectId: "blob",
        organizationId,
        signer,
        signerUserId,
      });
      const verify =
        eventType === "attachment.bind"
          ? verifyAttachmentBindingEvent
          : verifyAttachmentDetachEvent;
      for (const authorizationMembership of [
        "current",
        "referenced",
      ] as const) {
        expectVerificationError<unknown>(
          await verify({
            authorizationMembership,
            body: { ...body },
            event,
            signerPublicKey: signer.signingPublicKey,
            documentManifest: document,
            authorizingContainerPaths: [[first], [fixture[kind]]],
          }),
          "object_mismatch",
        );
      }
    }
  },
);

test.each(["unrelated", "foreign"] as const)(
  "content writes reject %s citations",
  async (kind) => {
    const fixture = await citationScopeFixture();
    const { first, document, signer, signerUserId, organizationId } = fixture;
    const kek = await createVerifiedContainerKekStateFixture({
      manifest: first,
      recipientUserId: signerUserId,
    });
    const documentKekTargets = await deriveRequiredDocumentKekTargets({
      documentManifest: document,
      linkedContainerManifests: [first],
      containerKekStates: [kek],
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
      containerKekStates: [kek],
      documentManifests: [document],
      linkedContainerManifests: [first],
    });
    for (const paths of [
      [[first], [fixture[kind]]],
      [[fixture[kind]], [first]],
    ]) {
      for (const objectKind of ["document", "blob"] as const) {
        const header = await createWriteHeaderFixture({
          dependencyManifestHashes: paths
            .flat()
            .map((head) => head.manifestHash),
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
        const authorization =
          objectKind === "document"
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
              };
        expectVerificationError(
          await verifyWriteHeader({
            header,
            writerPublicKey: signer.signingPublicKey,
            ...authorization,
          }),
          "object_mismatch",
        );
      }
    }
  },
);

test("link-set history accepts reconstructed ancestor prefixes", async () => {
  const fixture = await citationScopeFixture();
  const { first, signer, signerUserId, organizationId } = fixture;
  const child = await createContainerManifestFixture({
    containerId: "child",
    parentContainerId: first.state.containerId,
    parentManifestHash: first.manifestHash,
    directGrants: [],
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
  for (const authorizationMembership of ["current", "referenced"] as const) {
    const result = await verifyDocumentLinkSetManifest({
      authorizationMembership,
      event: document.event,
      expectedManifestHash: document.manifestHash,
      manifest: document.manifest,
      previousManifest: null,
      targetContainerPath: [first, child],
      authorizingContainerPaths: paths,
    });
    expect(result.ok).toBe(true);
  }
});

test("a second path cannot disguise an unrelated citation as an ancestor", async () => {
  const fixture = await citationScopeFixture();
  const { first, second, unrelated, document } = fixture;
  const paths = [[first], [unrelated, first]];
  const linked = await fixture.transition(
    "document.link",
    second,
    document,
    paths,
  );
  const result = await verifyDocumentLinkSetManifest({
    event: linked.event,
    expectedManifestHash: linked.manifestHash,
    manifest: linked.manifest,
    previousManifest: document,
    targetContainerPath: [second],
    authorizingContainerPaths: paths,
  });
  expect(result.ok).toBe(false);
});
