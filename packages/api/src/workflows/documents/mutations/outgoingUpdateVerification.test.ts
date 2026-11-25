import { expect, test } from "bun:test";
import type { DocumentOutgoingUpdate } from "@tearleads/validators/request";
import { sha256Hex } from "../../../utils/sha256";
import {
  storedDocumentUpdateMatchesOutgoingContent,
  uniqueOutgoingUpdates,
} from "./outgoingUpdateVerification";

const stored = {
  dependencyVersionVector: "dependency-vector",
  encryptedData: "encrypted-update",
  partialEndVersionVector: "end-vector",
  partialStartVersionVector: "start-vector",
  plaintextHash: "plaintext-hmac",
};

// What Postgres returns for the stored row: digests of its UTF-8 content.
const storedDigests = {
  dependencyVersionVectorSha256: sha256Hex(stored.dependencyVersionVector),
  encryptedDataSha256: sha256Hex(stored.encryptedData),
  partialEndVersionVectorSha256: sha256Hex(stored.partialEndVersionVector),
  partialStartVersionVectorSha256: sha256Hex(stored.partialStartVersionVector),
  plaintextHashSha256: sha256Hex(stored.plaintextHash),
};

test("stored update matching commits to every persisted content field", () => {
  expect(
    storedDocumentUpdateMatchesOutgoingContent(storedDigests, stored),
  ).toBe(true);

  for (const changed of [
    { ...stored, dependencyVersionVector: "other-dependency-vector" },
    { ...stored, encryptedData: "other-encrypted-update" },
    { ...stored, partialEndVersionVector: "other-end-vector" },
    { ...stored, partialStartVersionVector: "other-start-vector" },
    { ...stored, plaintextHash: "other-plaintext-hmac" },
  ]) {
    expect(
      storedDocumentUpdateMatchesOutgoingContent(storedDigests, changed),
    ).toBe(false);
  }

  expect(storedDocumentUpdateMatchesOutgoingContent(undefined, stored)).toBe(
    false,
  );
});

test("duplicate outgoing ids reject a changed plaintext hash", () => {
  const update = {
    ...stored,
    id: "duplicate-update-id",
    writeHeader: {},
  } as unknown as DocumentOutgoingUpdate;

  expect(uniqueOutgoingUpdates([update, update])).toEqual([update]);
  expect(() =>
    uniqueOutgoingUpdates([
      update,
      { ...update, plaintextHash: "duplicate-plaintext-hash-conflict" },
    ]),
  ).toThrow("Document update id conflict");
});
