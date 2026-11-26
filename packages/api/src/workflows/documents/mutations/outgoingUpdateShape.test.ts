import { expect, test } from "bun:test";
import {
  CONTENT_RECORD_ENCRYPTION_SUITE,
  computeContentRecordNonceDomainHash,
  type WriteHeader,
} from "@tearleads/crypto";
import {
  emptyVersionVector,
  encodeVersionVectorCounters,
} from "@tearleads/loro";
import {
  CONTENT_KEY_COMMITMENT_FIXTURE,
  documentEnvelopeFixture,
} from "../../../../test/helpers/documentEnvelopeFixture";
import {
  assertOutgoingDeclaredDependencies,
  assertOutgoingDeclaredSpan,
  assertOutgoingEnvelopeCommitsToEpochKey,
  assertOutgoingEnvelopeMatchesHeader,
  assertOutgoingSpanOrEmptyBaseline,
} from "./outgoingUpdateShape";

const DOCUMENT_ID = "6f1b1f8e-4f5a-4c4e-9a52-6f0a1b2c3d4e";
const RECORD_ID = "0e7c4d7a-1b2c-4d3e-8f90-a1b2c3d4e5f6";

function vector(counters: Record<string, number>): string {
  return encodeVersionVectorCounters(counters);
}

test("a declared span must name at least one operation", () => {
  expect(() =>
    assertOutgoingDeclaredSpan({
      partialStartVersionVector: vector({ "7": 3 }),
      partialEndVersionVector: vector({ "7": 5 }),
    }),
  ).not.toThrow();
  for (const empty of [
    { start: emptyVersionVector(), end: emptyVersionVector() },
    { start: vector({ "7": 3 }), end: vector({ "7": 3 }) },
  ]) {
    expect(() =>
      assertOutgoingDeclaredSpan({
        partialStartVersionVector: empty.start,
        partialEndVersionVector: empty.end,
      }),
    ).toThrow("Document update declares no operations");
  }
});

test("only the whole of an empty baseline may declare no operations", () => {
  const empty = {
    partialEndVersionVector: emptyVersionVector(),
    partialStartVersionVector: emptyVersionVector(),
  };
  const wholeEmptyBaseline = {
    ...empty,
    baselineSegmentCount: 1,
    baselineSegmentIndex: 0,
    coversThroughUpdateId: RECORD_ID,
  };
  expect(() =>
    assertOutgoingSpanOrEmptyBaseline(wholeEmptyBaseline),
  ).not.toThrow();
  for (const refused of [
    // No cursor: nothing says which updates its author voided.
    { ...wholeEmptyBaseline, coversThroughUpdateId: undefined },
    // One segment of several, final or not.
    { ...wholeEmptyBaseline, baselineSegmentCount: 2, baselineSegmentIndex: 1 },
    { ...empty, baselineSegmentIndex: 0 },
    { ...empty, coversThroughUpdateId: RECORD_ID },
    empty,
  ]) {
    expect(() => assertOutgoingSpanOrEmptyBaseline(refused)).toThrow(
      "Document update declares no operations",
    );
  }
  expect(() =>
    assertOutgoingSpanOrEmptyBaseline({
      partialEndVersionVector: vector({ "7": 5 }),
      partialStartVersionVector: vector({ "7": 3 }),
    }),
  ).not.toThrow();
  // An empty baseline's vectors must still be vectors.
  expect(() =>
    assertOutgoingSpanOrEmptyBaseline({
      ...wholeEmptyBaseline,
      partialEndVersionVector: "not-a-vector",
    }),
  ).toThrow("Document update version vectors are invalid");
});

test("declared dependencies must be a version vector", () => {
  for (const dependencyVersionVector of [
    emptyVersionVector(),
    vector({ "7": 3 }),
  ]) {
    expect(() =>
      assertOutgoingDeclaredDependencies({ dependencyVersionVector }),
    ).not.toThrow();
  }
  expect(() =>
    assertOutgoingDeclaredDependencies({
      dependencyVersionVector: "not-a-vector",
    }),
  ).toThrow("Document update dependency version vector is invalid");
});

test("a declared span whose end does not cover its start is refused", () => {
  for (const inverted of [
    { start: vector({ "7": 5 }), end: vector({ "7": 3 }) },
    // A start peer the end omits is an end below the start for that peer.
    { start: vector({ "7": 1, "9": 2 }), end: vector({ "9": 4 }) },
  ]) {
    expect(() =>
      assertOutgoingDeclaredSpan({
        partialStartVersionVector: inverted.start,
        partialEndVersionVector: inverted.end,
      }),
    ).toThrow("Document update version vectors are invalid");
  }
  expect(() =>
    assertOutgoingDeclaredSpan({
      partialStartVersionVector: "not-a-vector",
      partialEndVersionVector: vector({ "7": 1 }),
    }),
  ).toThrow("Document update version vectors are invalid");
});

async function signedHeaderFields(): Promise<WriteHeader> {
  const nonceDomainHash = await computeContentRecordNonceDomainHash({
    version: 1,
    organizationId: "organization-1",
    objectKind: "document",
    objectId: DOCUMENT_ID,
    contentKeyEpoch: 2,
    encryptionSuite: CONTENT_RECORD_ENCRYPTION_SUITE,
    contentRecordId: RECORD_ID,
  });
  // Only the bindings the envelope repeats matter here.
  return {
    contentKeyEpoch: 2,
    contentRecordId: RECORD_ID,
    metadataHash: "metadata-hash",
    nonceDomainHash,
    organizationId: "organization-1",
  } as WriteHeader;
}

function envelopeFor(
  header: WriteHeader,
  override: Partial<Parameters<typeof documentEnvelopeFixture>[0]> = {},
): string {
  return documentEnvelopeFixture({
    contentKeyEpoch: header.contentKeyEpoch,
    contentRecordId: header.contentRecordId,
    label: "payload",
    metadataHash: header.metadataHash,
    nonceDomainHash: header.nonceDomainHash,
    ...override,
  });
}

test("an envelope carrying its header's bindings is accepted", async () => {
  const header = await signedHeaderFields();
  await expect(
    assertOutgoingEnvelopeMatchesHeader({
      documentId: DOCUMENT_ID,
      header,
      update: { encryptedData: envelopeFor(header) },
    }),
  ).resolves.toMatchObject({
    contentKeyCommitment: CONTENT_KEY_COMMITMENT_FIXTURE,
    contentRecordId: RECORD_ID,
  });
});

test("an envelope must commit to its epoch's content key", () => {
  const envelope = { contentKeyCommitment: CONTENT_KEY_COMMITMENT_FIXTURE };
  expect(() =>
    assertOutgoingEnvelopeCommitsToEpochKey(
      envelope,
      CONTENT_KEY_COMMITMENT_FIXTURE,
    ),
  ).not.toThrow();
  expect(() =>
    assertOutgoingEnvelopeCommitsToEpochKey(envelope, "d".repeat(64)),
  ).toThrow(
    "Document update envelope does not commit to its epoch's content key",
  );
});

test("an envelope naming another epoch, record, metadata, or nonce domain is refused", async () => {
  const header = await signedHeaderFields();
  for (const override of [
    { contentKeyEpoch: 3 },
    { contentRecordId: "1e7c4d7a-1b2c-4d3e-8f90-a1b2c3d4e5f6" },
    { metadataHash: "other-metadata-hash" },
    { nonceDomainHash: "other-nonce-domain-hash" },
  ]) {
    await expect(
      assertOutgoingEnvelopeMatchesHeader({
        documentId: DOCUMENT_ID,
        header,
        update: { encryptedData: envelopeFor(header, override) },
      }),
    ).rejects.toThrow(
      "Document update envelope does not match its write header",
    );
  }
});

test("a header whose nonce domain belongs to another document is refused", async () => {
  const header = await signedHeaderFields();
  await expect(
    assertOutgoingEnvelopeMatchesHeader({
      documentId: "7f1b1f8e-4f5a-4c4e-9a52-6f0a1b2c3d4e",
      header,
      update: { encryptedData: envelopeFor(header) },
    }),
  ).rejects.toThrow("Document update envelope does not match its write header");
});

test("an envelope no reader could parse is refused", async () => {
  const header = await signedHeaderFields();
  const envelope = JSON.parse(envelopeFor(header)) as Record<string, unknown>;
  for (const encryptedData of [
    "not-json",
    JSON.stringify([]),
    JSON.stringify({ ...envelope, extra: true }),
    JSON.stringify({ ...envelope, format: "other" }),
    JSON.stringify({ ...envelope, version: 2 }),
    JSON.stringify({ ...envelope, encryptionSuite: "other" }),
    JSON.stringify({ ...envelope, iv: "AAAA" }),
  ]) {
    await expect(
      assertOutgoingEnvelopeMatchesHeader({
        documentId: DOCUMENT_ID,
        header,
        update: { encryptedData },
      }),
    ).rejects.toThrow("Document update envelope is invalid");
  }
});
