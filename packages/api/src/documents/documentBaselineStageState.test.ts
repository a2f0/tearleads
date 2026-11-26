import { expect, test } from "bun:test";
import type { WriteHeader } from "@tearleads/crypto";
import {
  DOCUMENT_BASELINE_STAGE_IDLE_SECONDS,
  DOCUMENT_BASELINE_STAGE_MAX_SECONDS,
} from "@tearleads/validators/util";
import {
  type DocumentBaselineStageRow,
  documentBaselineStageExpiry,
  judgeDocumentBaselineStage,
  placeStagedSegment,
} from "./documentBaselineStageState";
import { writeHeaderAuthorizationHash } from "./writeHeaderAuthorizationHash";

const NOW = new Date("2026-11-26T12:00:00.000Z");
const OWNER = "8d0f3f0e-6f0a-4c7e-9a52-6f0a1b2c3d4e";

function stage(
  values: Partial<DocumentBaselineStageRow> = {},
): DocumentBaselineStageRow {
  return {
    contentKeyCommitment: "c".repeat(64),
    contentKeyEpoch: 3,
    createdAt: NOW,
    documentId: "6f1b1f8e-4f5a-4c4e-9a52-6f0a1b2c3d4e",
    expiresAt: new Date(NOW.getTime() + 1000),
    id: "0e7c4d7a-1b2c-4d3e-8f90-a1b2c3d4e5f6",
    nextSegmentIndex: 2,
    organizationId: "1e7c4d7a-1b2c-4d3e-8f90-a1b2c3d4e5f6",
    ownerUserId: OWNER,
    segmentsDigest: "0".repeat(64),
    stagedBytes: 0,
    ...values,
  };
}

test("a stage is open only to its owner and only until it expires", () => {
  const judge = (row: DocumentBaselineStageRow | undefined, userId = OWNER) =>
    judgeDocumentBaselineStage(row, { now: NOW, userId }).status;
  expect(judge(undefined)).toBe("absent");
  expect(judge(stage())).toBe("open");
  // Another user's stage is no stage to this caller, expired or not.
  expect(judge(stage(), "9d0f3f0e-6f0a-4c7e-9a52-6f0a1b2c3d4e")).toBe("absent");
  expect(
    judge(stage({ expiresAt: NOW }), "9d0f3f0e-6f0a-4c7e-9a52-6f0a1b2c3d4e"),
  ).toBe("absent");
  // The expiry instant itself is past.
  expect(judge(stage({ expiresAt: NOW }))).toBe("expired");
  expect(judge(stage({ expiresAt: new Date(NOW.getTime() - 1) }))).toBe(
    "expired",
  );
});

test("segments are placed strictly in order", () => {
  expect(placeStagedSegment(stage(), 2)).toEqual({ status: "append" });
  expect(placeStagedSegment(stage(), 0)).toEqual({ status: "staged" });
  expect(placeStagedSegment(stage(), 1)).toEqual({ status: "staged" });
  expect(placeStagedSegment(stage(), 3)).toEqual({
    nextSegmentIndex: 2,
    status: "out_of_order",
  });
  expect(placeStagedSegment(stage({ nextSegmentIndex: 0 }), 0)).toEqual({
    status: "append",
  });
});

test("each write extends a stage by the idle period, up to its maximum lifetime", () => {
  const idle = DOCUMENT_BASELINE_STAGE_IDLE_SECONDS * 1000;
  const max = DOCUMENT_BASELINE_STAGE_MAX_SECONDS * 1000;
  const after = (elapsed: number) =>
    documentBaselineStageExpiry(
      NOW,
      new Date(NOW.getTime() + elapsed),
    ).getTime() - NOW.getTime();
  expect(DOCUMENT_BASELINE_STAGE_IDLE_SECONDS).toBe(60 * 60);
  expect(DOCUMENT_BASELINE_STAGE_MAX_SECONDS).toBe(24 * 60 * 60);
  expect(after(0)).toBe(idle);
  expect(after(5 * idle)).toBe(6 * idle);
  // A write near the end of the lifetime cannot push the expiry past it.
  expect(after(max - idle)).toBe(max);
  expect(after(max - 1)).toBe(max);
  expect(after(max + idle)).toBe(max);
});

const HEADER = {
  accessManifestHash: "a".repeat(64),
  ciphertextHash: "1".repeat(64),
  contentKeyEpoch: 3,
  contentRecordId: "record",
  dependencyManifestHashes: ["d".repeat(64)],
  encryptionSuite: "suite",
  metadataHash: "2".repeat(64),
  nonceDomainHash: "3".repeat(64),
  objectId: "object",
  objectKind: "document",
  organizationId: "organization",
  signature: "signature",
  signedAt: "2026-11-26T12:00:00.000Z",
  targetHash: "b".repeat(64),
  version: 1,
  writerDeviceId: "device",
  writerKeyFingerprint: "f".repeat(64),
  writerUserId: "writer",
} as unknown as WriteHeader;

// A commit authorizes its staged headers by this hash alone, so it must
// move with every field an authorization check reads and with no other.
test("the authorization hash covers what authorizes a write and nothing per segment", () => {
  const hash = writeHeaderAuthorizationHash(HEADER);
  const authorizing: Partial<Record<keyof WriteHeader, unknown>> = {
    accessManifestHash: "9".repeat(64),
    contentKeyEpoch: 4,
    dependencyManifestHashes: [],
    encryptionSuite: "other-suite",
    objectId: "other-object",
    objectKind: "blob",
    organizationId: "other-organization",
    targetHash: "9".repeat(64),
    version: 2,
    writerKeyFingerprint: "9".repeat(64),
    writerUserId: "other-writer",
  };
  for (const [field, value] of Object.entries(authorizing)) {
    expect([
      field,
      writeHeaderAuthorizationHash({ ...HEADER, [field]: value }),
    ]).not.toEqual([field, hash]);
  }
  const perSegment: Partial<Record<keyof WriteHeader, unknown>> = {
    ciphertextHash: "9".repeat(64),
    contentRecordId: "other-record",
    metadataHash: "9".repeat(64),
    nonceDomainHash: "9".repeat(64),
    signature: "other-signature",
    signedAt: "2027-01-01T00:00:00.000Z",
    writerDeviceId: "other-device",
  };
  for (const [field, value] of Object.entries(perSegment)) {
    expect([
      field,
      writeHeaderAuthorizationHash({ ...HEADER, [field]: value }),
    ]).toEqual([field, hash]);
  }
  expect(Object.keys({ ...authorizing, ...perSegment }).sort()).toEqual(
    Object.keys(HEADER).sort(),
  );
});
