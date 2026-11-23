import { expect, test } from "bun:test";
import { bytesToBase64 } from "@tearleads/encoding";
import {
  DOCUMENT_ENCRYPTED_LORO_UPDATE_FORMAT,
  parseDocumentEncryptedUpdate,
} from "./documentEncryptedUpdate";
import { CONTENT_RECORD_ENCRYPTION_SUITE } from "./keying/writeHeaderTypes";

const iv = new Uint8Array(12).fill(7);
const ciphertext = new Uint8Array([1, 2, 3, 4]);

const envelope = {
  ciphertext: bytesToBase64(ciphertext),
  contentKeyEpoch: 2,
  contentRecordId: "content-record",
  encryptionSuite: CONTENT_RECORD_ENCRYPTION_SUITE,
  format: DOCUMENT_ENCRYPTED_LORO_UPDATE_FORMAT,
  iv: bytesToBase64(iv),
  metadataHash: "metadata-hash",
  nonceDomainHash: "nonce-domain-hash",
  version: 1,
};

function parse(overrides: Record<string, unknown>) {
  return () =>
    parseDocumentEncryptedUpdate(JSON.stringify({ ...envelope, ...overrides }));
}

test("an envelope every reader can open parses to its fields", () => {
  expect(parseDocumentEncryptedUpdate(JSON.stringify(envelope))).toEqual({
    ciphertext,
    contentKeyEpoch: 2,
    contentRecordId: "content-record",
    iv,
    metadataHash: "metadata-hash",
    nonceDomainHash: "nonce-domain-hash",
  });
});

test("an envelope that is not one object of the known keys is refused", () => {
  expect(() => parseDocumentEncryptedUpdate("{")).toThrow("invalid JSON");
  expect(() => parseDocumentEncryptedUpdate("[]")).toThrow("must be an object");
  expect(parse({ extra: true })).toThrow('unexpected keys: "extra"');
});

test("an envelope of another format, version, or suite is refused", () => {
  expect(parse({ format: "other" })).toThrow("format is invalid");
  expect(parse({ version: 2 })).toThrow("version 2 is invalid");
  expect(parse({ encryptionSuite: "other" })).toThrow("suite is invalid");
  expect(parse({ iv: bytesToBase64(new Uint8Array(8)) })).toThrow(
    "IV is invalid",
  );
});

test("each field must be present and well formed", () => {
  for (const key of [
    "ciphertext",
    "contentRecordId",
    "metadataHash",
    "nonceDomainHash",
  ]) {
    expect(parse({ [key]: "" })).toThrow(`${key} must be a non-empty string`);
  }
  for (const contentKeyEpoch of [0, -1, 1.5, "2", 2 ** 53]) {
    expect(parse({ contentKeyEpoch })).toThrow(
      "contentKeyEpoch must be a positive integer",
    );
  }
});
