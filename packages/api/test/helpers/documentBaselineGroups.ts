import {
  CONTENT_RECORD_ENCRYPTION_SUITE,
  compareCanonicalStrings,
  computeContentRecordNonceDomainHash,
  computeDocumentBaselineSegmentsDigest,
  computeDocumentContentRecordMetadataHash,
  type DocumentBaselineSegmentDigestEntry,
} from "@tearleads/crypto";
import {
  decodeVersionVector,
  emptyVersionVector,
  encodeVersionVectorCounters,
} from "@tearleads/loro";
import type { TestUser } from "@tearleads/test-utils";
import type { DocumentOutgoingUpdate } from "@tearleads/validators/request";
import { signWithDocumentEnvelope } from "./documentEnvelopeFixture";

/**
 * The range one baseline segment declares. The API never reads a payload, so
 * a route test's segment is its signed vectors over placeholder ciphertext.
 */
export interface BaselineSegmentRange {
  /** Defaults to what the range builds on: its start. */
  readonly dependencyVersionVector?: string | undefined;
  readonly partialEndVersionVector: string;
  readonly partialStartVersionVector: string;
}

/** The baseline fields a segment signs. */
export interface BaselineSegmentFields {
  baselineId: string;
  baselineSegmentCount?: number | undefined;
  baselineSegmentIndex: number;
  baselineSegmentsDigest?: string | undefined;
  coversThroughUpdateId?: string | undefined;
}

/**
 * Cut `frontier` into `pieces` ranges that carry it gapless from zero: peers
 * in canonical order, each range a run of counters that starts every peer
 * where the earlier ranges left it. A frontier with fewer counters than
 * pieces gives one range per counter, and an empty one gives the single
 * empty range of an empty baseline.
 */
export function baselineSegmentRanges(
  frontier: string,
  pieces = 1,
): BaselineSegmentRange[] {
  const peers = [...decodeVersionVector(frontier).toJSON()]
    .filter(([, end]) => end > 0)
    .sort(([left], [right]) => compareCanonicalStrings(left, right));
  const total = peers.reduce((sum, [, end]) => sum + end, 0);
  if (total === 0) {
    const empty = emptyVersionVector();
    return [
      { partialEndVersionVector: empty, partialStartVersionVector: empty },
    ];
  }
  const size = Math.ceil(total / Math.min(pieces, total));
  const ranges: BaselineSegmentRange[] = [];
  let starts: Record<string, number> = {};
  let ends: Record<string, number> = {};
  let filled = 0;
  const flush = () => {
    ranges.push({
      partialEndVersionVector: encodeVersionVectorCounters(ends),
      partialStartVersionVector: encodeVersionVectorCounters(starts),
    });
    starts = {};
    ends = {};
    filled = 0;
  };
  for (const [peer, end] of peers) {
    for (let at = 0; at < end; ) {
      const take = Math.min(size - filled, end - at);
      if (at > 0) starts[peer] = at;
      ends[peer] = at + take;
      at += take;
      filled += take;
      if (filled === size) flush();
    }
  }
  if (filled > 0) flush();
  return ranges;
}

/** What a group's writer signs with, shared by every segment. */
export interface BaselineGroupSigner {
  readonly accessManifestHash: string;
  readonly contentKeyCommitment?: string | undefined;
  readonly contentKeyEpoch: number;
  readonly dependencyManifestHashes: readonly string[];
  readonly documentId: string;
  readonly organizationId: string;
  readonly owner: TestUser;
  readonly targetHash: string;
}

async function signBaselineSegment(
  signer: BaselineGroupSigner,
  range: BaselineSegmentRange,
  fields: BaselineSegmentFields,
): Promise<{
  readonly entry: DocumentBaselineSegmentDigestEntry;
  readonly update: DocumentOutgoingUpdate;
}> {
  const id = crypto.randomUUID();
  const plaintextHash = `plaintext-hash:${id}`;
  const dependencyVersionVector =
    range.dependencyVersionVector ?? range.partialStartVersionVector;
  const { encryptedData, writeHeader } = await signWithDocumentEnvelope(
    `encrypted-rotation-baseline-segment:${id}`,
    {
      version: 1,
      dependencyManifestHashes: [...signer.dependencyManifestHashes].sort(),
      organizationId: signer.organizationId,
      objectKind: "document",
      objectId: signer.documentId,
      accessManifestHash: signer.accessManifestHash,
      contentKeyEpoch: signer.contentKeyEpoch,
      targetHash: signer.targetHash,
      encryptionSuite: CONTENT_RECORD_ENCRYPTION_SUITE,
      contentRecordId: id,
      nonceDomainHash: await computeContentRecordNonceDomainHash({
        version: 1,
        organizationId: signer.organizationId,
        objectKind: "document",
        objectId: signer.documentId,
        contentKeyEpoch: signer.contentKeyEpoch,
        encryptionSuite: CONTENT_RECORD_ENCRYPTION_SUITE,
        contentRecordId: id,
      }),
      metadataHash: await computeDocumentContentRecordMetadataHash({
        ...fields,
        dependencyVersionVector,
        documentId: signer.documentId,
        partialEndVersionVector: range.partialEndVersionVector,
        partialStartVersionVector: range.partialStartVersionVector,
        plaintextHash,
        updateId: id,
      }),
      writerUserId: signer.owner.userId,
      writerDeviceId: "test-device",
      writerKeyFingerprint: signer.owner.fingerprint,
      signedAt: "2026-07-14T12:00:00.000Z",
    },
    signer.owner.signing.signingPrivateKey,
    signer.contentKeyCommitment,
  );
  return {
    entry: {
      ciphertextHash: writeHeader.ciphertextHash,
      metadataHash: writeHeader.metadataHash,
      updateId: id,
    },
    update: {
      ...fields,
      dependencyVersionVector,
      encryptedData,
      id,
      partialEndVersionVector: range.partialEndVersionVector,
      partialStartVersionVector: range.partialStartVersionVector,
      plaintextHash,
      writeHeader: { ...writeHeader },
    },
  };
}

/**
 * Sign `ranges` as one rotation baseline, in order: every segment names the
 * baseline and its index, and the final one the count, the digest of the
 * segments before it, and the cursor. `override` changes what a segment
 * signs, after the honest fields are worked out, so a test can sign a group
 * that breaks one rule and is otherwise authentic.
 */
export async function createSignedBaselineGroup(
  input: BaselineGroupSigner & {
    readonly baselineId?: string | undefined;
    readonly coversThroughUpdateId?: string | undefined;
    readonly override?:
      | ((
          fields: BaselineSegmentFields,
          position: number,
        ) => BaselineSegmentFields)
      | undefined;
    readonly ranges: readonly BaselineSegmentRange[];
  },
): Promise<DocumentOutgoingUpdate[]> {
  const baselineId = input.baselineId ?? crypto.randomUUID();
  const entries: DocumentBaselineSegmentDigestEntry[] = [];
  const updates: DocumentOutgoingUpdate[] = [];
  for (const [position, range] of input.ranges.entries()) {
    const final = position === input.ranges.length - 1;
    const honest: BaselineSegmentFields = {
      baselineId,
      baselineSegmentIndex: position,
      ...(final
        ? {
            baselineSegmentCount: input.ranges.length,
            baselineSegmentsDigest: await computeDocumentBaselineSegmentsDigest(
              {
                baselineId,
                documentId: input.documentId,
                segments: entries,
              },
            ),
            ...(input.coversThroughUpdateId === undefined
              ? {}
              : { coversThroughUpdateId: input.coversThroughUpdateId }),
          }
        : {}),
    };
    const { entry, update } = await signBaselineSegment(
      input,
      range,
      input.override ? input.override(honest, position) : honest,
    );
    entries.push(entry);
    updates.push(update);
  }
  return updates;
}
