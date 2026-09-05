import { expect, test } from "bun:test";
import { verifySignedAccessEvent } from "@tearleads/crypto";
import { createAuthor } from "../../../../../test/helpers/documentFixturePrimitives";
import { readCanonicalJson } from "../../../keyingCanonicalJson";
import {
  signBlobAttachmentDetachEvent,
  signBlobAttachmentEvent,
} from "./events";

test("attachment bind and detach sign every authorization path head exactly once", async () => {
  const { author, signingPublicKey } = await createAuthor();
  const rootHash = "a".repeat(64);
  const firstHash = "b".repeat(64);
  const secondHash = "c".repeat(64);
  const documentHash = "d".repeat(64);
  const input = {
    author,
    authorizingContainerPathRefs: [
      [
        { containerId: "root", manifestHash: rootHash },
        { containerId: "first", manifestHash: firstHash },
      ],
      [
        { containerId: "root", manifestHash: rootHash },
        { containerId: "second", manifestHash: secondHash },
      ],
    ],
    bindingId: "binding",
    blobId: "blob",
    documentId: "document",
    eventId: "event",
    manifestIdentity: {
      documentId: "document",
      manifestHash: documentHash,
      organizationId: author.organizationId,
    },
    signedAt: "2026-09-04T12:00:00.000Z",
    slotId: "slot",
  };
  const results = [
    await signBlobAttachmentEvent({ ...input, expectedBindingId: null }),
    await signBlobAttachmentDetachEvent(input),
  ];
  for (const { body, event } of results) {
    expect(event.dependencyManifestHashes).toEqual([
      rootHash,
      firstHash,
      secondHash,
      documentHash,
    ]);
    expect(
      (
        await verifySignedAccessEvent({
          body: readCanonicalJson(body, "Attachment event test body"),
          event,
          signerPublicKey: signingPublicKey,
        })
      ).ok,
    ).toBe(true);
  }
});
