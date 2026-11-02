import { describe, expect, test } from "bun:test";
import { CONTENT_RECORD_ENCRYPTION_SUITE } from "@tearleads/crypto";
import {
  readBindBodyClaim,
  readWriteHeader as readBlobWriteHeader,
  readDetachBodyClaim,
} from "../../../blobs/mutations/records";
import { BlobMutationError } from "../../../blobs/mutations/types";
import { DocumentMutationError } from "../errors";
import { readWriteHeader as readDocumentWriteHeader } from "./records";

function rejection(read: () => unknown): string {
  try {
    read();
  } catch (error) {
    if (
      (error instanceof DocumentMutationError ||
        error instanceof BlobMutationError) &&
      error.status === 400
    ) {
      return `${error.constructor.name}: ${error.message}`;
    }
    throw error;
  }
  throw new Error("expected the reader to reject");
}

function writeHeader(): Record<string, unknown> {
  return {
    version: 1,
    organizationId: "organization-id",
    objectKind: "document",
    objectId: "document-id",
    accessManifestHash: "access-manifest-hash",
    dependencyManifestHashes: ["dependency-hash"],
    contentKeyEpoch: 2,
    targetHash: "target-hash",
    encryptionSuite: CONTENT_RECORD_ENCRYPTION_SUITE,
    contentRecordId: "content-record-id",
    nonceDomainHash: "nonce-domain-hash",
    metadataHash: "metadata-hash",
    ciphertextHash: "ciphertext-hash",
    writerUserId: "writer-user",
    writerDeviceId: "writer-device",
    writerKeyFingerprint: "writer-fingerprint",
    signedAt: "2026-01-01T00:00:00.000Z",
    signature: "signature",
  };
}

const without = (base: Record<string, unknown>, key: string) => {
  const copy = { ...base };
  Reflect.deleteProperty(copy, key);
  return copy;
};

const stringFields = [
  "organizationId",
  "objectId",
  "accessManifestHash",
  "targetHash",
  "contentRecordId",
  "nonceDomainHash",
  "metadataHash",
  "ciphertextHash",
  "writerUserId",
  "writerDeviceId",
  "writerKeyFingerprint",
  "signedAt",
  "signature",
];

const headerCases: [string, unknown, string][] = [
  ["null", null, "Header is invalid"],
  ["an array", [], "Header is invalid"],
  ["a date", new Date(0), "Header is invalid"],
  ...stringFields.flatMap((key): [string, unknown, string][] => [
    [`missing ${key}`, without(writeHeader(), key), `Header.${key} is invalid`],
    [
      `empty ${key}`,
      { ...writeHeader(), [key]: "" },
      `Header.${key} is invalid`,
    ],
    [
      `numeric ${key}`,
      { ...writeHeader(), [key]: 7 },
      `Header.${key} is invalid`,
    ],
  ]),
  [
    "a container objectKind",
    { ...writeHeader(), objectKind: "container" },
    "Header.objectKind is invalid",
  ],
  [
    "another suite",
    { ...writeHeader(), encryptionSuite: "aes-cbc" },
    "Header.encryptionSuite is invalid",
  ],
  ["version 2", { ...writeHeader(), version: 2 }, "Header.version is invalid"],
  [
    "missing version",
    without(writeHeader(), "version"),
    "Header.version is invalid",
  ],
  [
    "epoch 0",
    { ...writeHeader(), contentKeyEpoch: 0 },
    "Header.contentKeyEpoch is invalid",
  ],
  [
    "fractional epoch",
    { ...writeHeader(), contentKeyEpoch: 1.5 },
    "Header.contentKeyEpoch is invalid",
  ],
  [
    "string epoch",
    { ...writeHeader(), contentKeyEpoch: "2" },
    "Header.contentKeyEpoch is invalid",
  ],
  [
    "dependency string",
    { ...writeHeader(), dependencyManifestHashes: "x" },
    "Header.dependencyManifestHashes is invalid",
  ],
  [
    "dependency entry",
    { ...writeHeader(), dependencyManifestHashes: [null] },
    "Header.dependencyManifestHashes is invalid",
  ],
  [
    "bad kind and suite",
    { ...writeHeader(), objectKind: 1, encryptionSuite: 1 },
    "Header.objectKind is invalid",
  ],
  [
    "bad suite and version",
    { ...writeHeader(), encryptionSuite: 1, version: 2 },
    "Header.encryptionSuite is invalid",
  ],
  [
    "bad version and dependencies",
    { ...writeHeader(), version: 2, dependencyManifestHashes: 1 },
    "Header.version is invalid",
  ],
  [
    "bad dependencies and organization",
    { ...writeHeader(), dependencyManifestHashes: 1, organizationId: "" },
    "Header.dependencyManifestHashes is invalid",
  ],
  [
    "bad organization and object",
    { ...writeHeader(), organizationId: "", objectId: "" },
    "Header.organizationId is invalid",
  ],
  [
    "bad manifest hash and epoch",
    { ...writeHeader(), accessManifestHash: "", contentKeyEpoch: 0 },
    "Header.accessManifestHash is invalid",
  ],
  [
    "bad epoch and target",
    { ...writeHeader(), contentKeyEpoch: 0, targetHash: "" },
    "Header.contentKeyEpoch is invalid",
  ],
];

describe.each([
  ["DocumentMutationError", readDocumentWriteHeader],
  ["BlobMutationError", readBlobWriteHeader],
])("%s write header reader", (errorName, read) => {
  test.each(headerCases)("rejects %s", (_name, value, message) => {
    expect(rejection(() => read(value, "Header"))).toBe(
      `${errorName}: ${message}`,
    );
  });

  test("rebuilds the header in field order without unknown keys", () => {
    const stored = {
      ...writeHeader(),
      objectKind: "blob",
      dependencyManifestHashes: [""],
      extension: true,
    };
    const header = read(stored, "Header");
    expect(Object.keys(header)).toEqual([
      "version",
      "dependencyManifestHashes",
      "organizationId",
      "objectKind",
      "objectId",
      "accessManifestHash",
      "contentKeyEpoch",
      "targetHash",
      "encryptionSuite",
      "contentRecordId",
      "nonceDomainHash",
      "metadataHash",
      "ciphertextHash",
      "writerUserId",
      "writerDeviceId",
      "writerKeyFingerprint",
      "signedAt",
      "signature",
    ]);
    expect<unknown>(header).toEqual(without(stored, "extension"));
  });
});

function bindBody(): Record<string, unknown> {
  return {
    bindingId: "binding-id",
    blobId: "blob-id",
    documentId: "document-id",
    slotId: "slot-id",
    expectedBindingId: null,
    documentManifestHash: "document-manifest-hash",
  };
}

const bindCases: [string, unknown, string][] = [
  ["null", null, "attachment.bind body.bindingId is required"],
  ["a string", "body", "attachment.bind body.bindingId is required"],
  ["an array", [], "attachment.bind body.bindingId is required"],
  [
    "a function",
    () => bindBody(),
    "attachment.bind body.bindingId is required",
  ],
  [
    "an empty binding id",
    { ...bindBody(), bindingId: "" },
    "attachment.bind body.bindingId is required",
  ],
  [
    "a missing blob id",
    without(bindBody(), "blobId"),
    "attachment.bind body.blobId is required",
  ],
  [
    "a numeric document id",
    { ...bindBody(), documentId: 1 },
    "attachment.bind body.documentId is required",
  ],
  [
    "a null slot id",
    { ...bindBody(), slotId: null },
    "attachment.bind body.slotId is required",
  ],
  [
    "an empty expected binding",
    { ...bindBody(), expectedBindingId: "" },
    "attachment.bind body.expectedBindingId is required",
  ],
  [
    "a missing expected binding",
    without(bindBody(), "expectedBindingId"),
    "attachment.bind body.expectedBindingId is required",
  ],
  [
    "an empty manifest hash",
    { ...bindBody(), documentManifestHash: "" },
    "attachment.bind body.documentManifestHash is required",
  ],
  [
    "a bad slot and manifest",
    { ...bindBody(), slotId: "", documentManifestHash: "" },
    "attachment.bind body.slotId is required",
  ],
];

describe("attachment body claims", () => {
  test.each(bindCases)("bind rejects %s", (_name, value, message) => {
    expect(rejection(() => readBindBodyClaim(value))).toBe(
      `BlobMutationError: ${message}`,
    );
  });

  test("detach rejects a body without its manifest hash", () => {
    expect(
      rejection(() =>
        readDetachBodyClaim(without(bindBody(), "documentManifestHash")),
      ),
    ).toBe(
      "BlobMutationError: attachment.detach body.documentManifestHash is required",
    );
    expect(rejection(() => readDetachBodyClaim([]))).toBe(
      "BlobMutationError: attachment.detach body.bindingId is required",
    );
  });

  test("bind keeps the claim field order and drops unknown keys", () => {
    const claims = readBindBodyClaim({
      ...bindBody(),
      expectedBindingId: "previous-binding",
      eventType: "ignored",
    });
    expect(Object.keys(claims)).toEqual([
      "eventType",
      "bindingId",
      "blobId",
      "documentId",
      "slotId",
      "expectedBindingId",
      "documentManifestHash",
    ]);
    expect(claims.eventType).toBe("attachment.bind");
    expect(claims.expectedBindingId).toBe("previous-binding");
  });
});
