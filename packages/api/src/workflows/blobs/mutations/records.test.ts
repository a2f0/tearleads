import { expect, test } from "bun:test";
import { readBindBodyClaim, readDetachBodyClaim } from "./records";
import { BlobMutationError } from "./types";

test("blob attachment body readers validate required session claims", () => {
  expect(
    readBindBodyClaim({
      bindingId: "binding-1",
      blobId: "blob-1",
      documentId: "document-1",
      slotId: "front",
      expectedBindingId: null,
      documentManifestHash: "document-manifest-hash",
    }),
  ).toEqual({
    eventType: "attachment.bind",
    bindingId: "binding-1",
    blobId: "blob-1",
    documentId: "document-1",
    slotId: "front",
    expectedBindingId: null,
    documentManifestHash: "document-manifest-hash",
  });

  expect(
    readDetachBodyClaim({
      bindingId: "binding-1",
      blobId: "blob-1",
      documentId: "document-1",
      slotId: "front",
      documentManifestHash: "document-manifest-hash",
    }),
  ).toEqual({
    eventType: "attachment.detach",
    bindingId: "binding-1",
    blobId: "blob-1",
    documentId: "document-1",
    slotId: "front",
    documentManifestHash: "document-manifest-hash",
  });
});

test("blob attachment body readers reject malformed optional binding claims", () => {
  expect(() =>
    readBindBodyClaim({
      bindingId: "binding-1",
      blobId: "blob-1",
      documentId: "document-1",
      slotId: "front",
      expectedBindingId: "",
      documentManifestHash: "document-manifest-hash",
    }),
  ).toThrow(
    new BlobMutationError(
      "attachment.bind body.expectedBindingId is required",
      400,
    ),
  );
});
