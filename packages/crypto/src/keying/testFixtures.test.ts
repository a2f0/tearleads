import { expect, test } from "bun:test";
import { generateSigningSeedAndKeyPair } from "../signing/generateKeyPair";
import { containerWrappingPublicKeyForTest } from "./containerWrapping.testFixtures";
import { verifySignedAccessEvent } from "./index";
import {
  createVerifiedContainerAccessEvent,
  fixtureHash,
} from "./testFixtures";

// The fixture brands its own event as verified without running the verifier;
// this pins that shortcut to what the verifier returns for the same event.
test("a fixture-verified access event equals the verifier's result", async () => {
  const signer = generateSigningSeedAndKeyPair();
  const verified = await createVerifiedContainerAccessEvent({
    body: {
      containerKeyEpochId: "child-key-epoch-1",
      containerKeyPublicKey:
        containerWrappingPublicKeyForTest("child-key-epoch-1"),
      directGrants: [
        { accessLevel: "admin", subjectId: "user-1", subjectType: "user" },
      ],
      eventType: "container.create",
      metadataDocumentId: "child-metadata-document",
      parentContainerId: "parent-container",
      parentManifestHash: await fixtureHash("parent-manifest"),
      referencedPrincipalHeads: [],
      systemSlot: null,
    },
    dependencyManifestHashes: [
      await fixtureHash("dependency-b"),
      await fixtureHash("dependency-a"),
    ],
    objectId: "child-container",
    organizationId: "organization-1",
    previousManifestHash: null,
    signer,
    signerUserId: "user-1",
  });

  const result = await verifySignedAccessEvent({
    body: verified.body,
    event: verified.event,
    signerPublicKey: signer.signingPublicKey,
  });

  expect(result.ok).toBe(true);
  if (result.ok) {
    expect(result.value).toEqual(verified);
  }
});
