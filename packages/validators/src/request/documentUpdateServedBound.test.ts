// Every route that accepts an update holds it, whole, to what one sync
// request may carry, so a response page always has room to serve it with
// what the server adds. An unlink's route takes a larger body than a sync's,
// so its inline rotation baseline segments are held to the bound one by one.
import { expect, test } from "bun:test";
import { documentLinkSetBaselineSegmentBytesRefinement } from "../documentSyncRefinements";
import {
  MAX_DOCUMENT_BASELINE_SEGMENT_HEADER_REQUEST_BYTES,
  MAX_DOCUMENT_BASELINE_SEGMENT_REQUEST_BYTES,
  MAX_DOCUMENT_SYNC_CONTENT_KEY_TARGETS,
  MAX_DOCUMENT_SYNC_REQUEST_BYTES,
  MAX_DOCUMENT_SYNC_RESPONSE_UPDATE_PAGE_BYTES,
} from "../util";
import { serializedJsonBytes } from "../util/serializedJsonBytes";
import { DocumentLinkSetMutationRequestSchema } from "./document";
import { DocumentSyncOutgoingUpdateSchema } from "./documentSyncSchema";
import {
  createContainerMutationRequest,
  createDocumentContentKeyBundle,
} from "./requestTestFixtures";

const final = {
  baselineId: "550e8400-e29b-41d4-a716-446655440222",
  baselineSegmentCount: 1,
  baselineSegmentIndex: 0,
  baselineSegmentsDigest: "ab".repeat(32),
  coversThroughUpdateId: "550e8400-e29b-41d4-a716-446655440333",
  dependencyVersionVector: "{}",
  encryptedData: "ciphertext",
  id: "550e8400-e29b-41d4-a716-446655440111",
  partialEndVersionVector: '{"actor":1}',
  partialStartVersionVector: "{}",
  plaintextHash: "plaintext-hash",
  writeHeader: { updateId: "550e8400-e29b-41d4-a716-446655440111" },
};

/** The `rotationBaseline` issues an unlink carrying `segment` draws. */
function unlinkIssues(segment: Record<string, unknown>) {
  const parsed = DocumentLinkSetMutationRequestSchema.safeParse({
    authorizingContainerPathRefs: [
      [{ containerId: "container-1", manifestHash: "container-manifest-hash" }],
    ],
    body: { documentId: "550e8400-e29b-41d4-a716-446655440001" },
    containerRekeys: [createContainerMutationRequest()],
    contentKeyBundle: createDocumentContentKeyBundle(),
    event: { eventType: "document.unlink" },
    expectedManifestHash: "manifest-hash",
    rotationBaseline: [segment],
    targetContainerPathRefs: [
      { containerId: "container-1", manifestHash: "container-manifest-hash" },
    ],
  });
  return parsed.success
    ? []
    : parsed.error.issues.map((issue) => [issue.path.join("."), issue.message]);
}

const WHOLE = [
  "rotationBaseline.0",
  documentLinkSetBaselineSegmentBytesRefinement.description,
];

test("an unlink's inline segment is held, whole, to a sync request's bytes", () => {
  expect(unlinkIssues(final)).toEqual([]);
  const overhead = serializedJsonBytes(final) - final.encryptedData.length;
  const filling = (bytes: number) => "A".repeat(bytes - overhead);

  // At the bound, to the byte, and one past it.
  const atBound = {
    ...final,
    encryptedData: filling(MAX_DOCUMENT_SYNC_REQUEST_BYTES),
  };
  expect(serializedJsonBytes(atBound)).toBe(MAX_DOCUMENT_SYNC_REQUEST_BYTES);
  expect(unlinkIssues(atBound)).toEqual([]);
  expect(
    unlinkIssues({
      ...final,
      encryptedData: filling(MAX_DOCUMENT_SYNC_REQUEST_BYTES + 1),
    }),
  ).toEqual([WHOLE]);

  // Two strings that each pass an update's own field bounds, and a field
  // with no bound of its own: the segment is weighed as a whole.
  const half = "A".repeat(MAX_DOCUMENT_SYNC_REQUEST_BYTES / 2);
  for (const heavy of [
    { ...final, encryptedData: half, partialStartVersionVector: half },
    { ...final, plaintextHash: `${half}${half}` },
    { ...final, writeHeader: { padding: `${half}${half}` } },
  ]) {
    expect(DocumentSyncOutgoingUpdateSchema.safeParse(heavy).success).toBe(
      true,
    );
    expect(unlinkIssues(heavy)).toEqual([WHOLE]);
  }
  // A string past a sync update's field bound is refused as on a sync, too.
  const issues = unlinkIssues({
    ...final,
    encryptedData: "A".repeat(MAX_DOCUMENT_SYNC_REQUEST_BYTES + 1),
  });
  expect(issues).toContainEqual(WHOLE);
  expect(issues.map(([path]) => path)).toContain(
    "rotationBaseline.0.encryptedData",
  );
});

// Bytes, not characters: what a response serializes.
test("a value's serialized bytes count its escapes and its UTF-8", () => {
  for (const value of [
    "plain",
    'quote " and \\ backslash',
    "line\nbreak\u0001",
    "é€",
    "😀 pair",
    "\ud83d lone",
    { nested: ["€", 1, null, true] },
  ]) {
    expect([value, serializedJsonBytes(value)]).toEqual([
      value,
      new TextEncoder().encode(JSON.stringify(value)).length,
    ]);
  }
  expect(serializedJsonBytes(undefined)).toBe(0);
});

// The largest update a write route accepts is one sync request's bytes: a
// sync's whole request, a staged segment's whole request, or one inline
// segment of an unlink. A staged segment's header may be signed again, in a
// request of its own. The server serves an update with a few fields of its
// own and, to a reader that holds another target set, the document's
// content-key targets. A response page's share for updates holds all of
// that with room to spare, so no accepted update is one no page can serve.
test("a response page's update share holds the largest accepted update as it is served", () => {
  expect(MAX_DOCUMENT_BASELINE_SEGMENT_REQUEST_BYTES).toBe(
    MAX_DOCUMENT_SYNC_REQUEST_BYTES,
  );
  const largestAcceptedUpdate =
    MAX_DOCUMENT_SYNC_REQUEST_BYTES +
    MAX_DOCUMENT_BASELINE_SEGMENT_HEADER_REQUEST_BYTES;
  // What a served update adds to the one that was sent: its access epoch,
  // document id, author fingerprint and commit time, and the key targets,
  // each a container id, a manifest hash, a key epoch id and an epoch,
  // allowed a kibibyte apiece here.
  const servedFields = serializedJsonBytes({
    accessEpoch: Number.MAX_SAFE_INTEGER,
    authorFingerprint: "f".repeat(64),
    createdAt: "2026-01-01T00:00:00.000Z",
    documentId: "550e8400-e29b-41d4-a716-446655440001",
  });
  const servedEnvelope =
    servedFields + MAX_DOCUMENT_SYNC_CONTENT_KEY_TARGETS * 1024;
  expect(largestAcceptedUpdate + servedEnvelope).toBeLessThan(
    MAX_DOCUMENT_SYNC_RESPONSE_UPDATE_PAGE_BYTES,
  );
  // The margin is most of the share, not a coincidence of two ceilings.
  expect(
    MAX_DOCUMENT_SYNC_RESPONSE_UPDATE_PAGE_BYTES -
      (largestAcceptedUpdate + servedEnvelope),
  ).toBeGreaterThan(8 * 1024 * 1024);
});
