import { expect, test } from "bun:test";
import type { DocumentOutgoingUpdate } from "@tearleads/validators/request";
import {
  storedDocumentUpdateMatchesOutgoingContent,
  uniqueOutgoingUpdates,
} from "./outgoingUpdateVerification";

const stored = {
  encryptedData: "encrypted-update",
  partialEndVersionVector: "end-vector",
  partialStartVersionVector: "start-vector",
  plaintextHash: "plaintext-hmac",
};

test("stored update matching commits to every persisted content field", () => {
  expect(storedDocumentUpdateMatchesOutgoingContent(stored, stored)).toBe(true);

  for (const changed of [
    { ...stored, encryptedData: "other-encrypted-update" },
    { ...stored, partialEndVersionVector: "other-end-vector" },
    { ...stored, partialStartVersionVector: "other-start-vector" },
    { ...stored, plaintextHash: "other-plaintext-hmac" },
  ]) {
    expect(storedDocumentUpdateMatchesOutgoingContent(stored, changed)).toBe(
      false,
    );
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
