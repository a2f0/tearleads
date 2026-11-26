import { computeKeyingDomainHash } from "./canonical";

const BASELINE_SEGMENTS_DOMAIN = "tearleads.document.baseline-segments";

/** What a baseline's digest takes from one segment before its final one. */
export interface DocumentBaselineSegmentDigestEntry {
  /** The hash of the segment's ciphertext envelope, as its header signs it. */
  readonly ciphertextHash: string;
  /** The hash of the segment's content-record metadata, as signed. */
  readonly metadataHash: string;
  readonly updateId: string;
}

/**
 * The digest of a baseline that has no segment before its final one, and the
 * value every longer baseline's digest starts from. It names the document
 * and the baseline, so a digest never stands for another group.
 */
export function startDocumentBaselineSegmentsDigest(input: {
  readonly baselineId: string;
  readonly documentId: string;
}): Promise<string> {
  return computeKeyingDomainHash(BASELINE_SEGMENTS_DOMAIN, {
    version: 1,
    step: "start",
    documentId: input.documentId,
    baselineId: input.baselineId,
  });
}

/**
 * The digest after one more segment: a hash of the digest before it and of
 * the segment's index, update id, metadata hash and ciphertext hash. Each
 * step takes one segment, so a writer, the API, or a reader that meets a
 * baseline's segments one at a time keeps one hash and never the list.
 */
export function extendDocumentBaselineSegmentsDigest(
  previousDigest: string,
  segment: DocumentBaselineSegmentDigestEntry & {
    readonly segmentIndex: number;
  },
): Promise<string> {
  return computeKeyingDomainHash(BASELINE_SEGMENTS_DOMAIN, {
    version: 1,
    step: "segment",
    previousDigest,
    segmentIndex: segment.segmentIndex,
    updateId: segment.updateId,
    metadataHash: segment.metadataHash,
    ciphertextHash: segment.ciphertextHash,
  });
}

/**
 * The digest a baseline's final segment signs as `baselineSegmentsDigest`:
 * the chain above over every segment before the final one, in index order.
 * The final segment is not in it. Its own signed metadata carries the
 * digest, its index and the count, and its ciphertext is bound to that
 * metadata, so it cannot also be an input.
 */
export async function computeDocumentBaselineSegmentsDigest(input: {
  readonly baselineId: string;
  readonly documentId: string;
  /** The segments before the final one, in index order from zero. */
  readonly segments: readonly DocumentBaselineSegmentDigestEntry[];
}): Promise<string> {
  let digest = await startDocumentBaselineSegmentsDigest(input);
  for (const [segmentIndex, segment] of input.segments.entries()) {
    digest = await extendDocumentBaselineSegmentsDigest(digest, {
      ...segment,
      segmentIndex,
    });
  }
  return digest;
}
