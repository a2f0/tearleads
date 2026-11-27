import {
  createReadOnlyDocument,
  emptyVersionVector,
  exportHistorySegmentRange,
  exportHistorySegments,
  getImportBlobMetadata,
  type HistorySegment,
  type HistorySegmentSizes,
  importSnapshot,
  versionVectorsEqual,
} from "@tearleads/loro";

/** A proven history, opened to be cut into a baseline's segments. */
export interface RotationHistory {
  /** Whether the history holds no operation. */
  readonly empty: boolean;
  /** The version the history reaches. */
  readonly version: string;
  /**
   * The history's segments in order, exported one at a time as they are
   * asked for; with `after`, only what the history holds past that version.
   */
  segments(
    sizes: HistorySegmentSizes,
    after?: string,
  ): Generator<HistorySegment, void, undefined>;
  /** The bytes of the segment that carries exactly `range`, if held. */
  segmentRange(
    range: Pick<
      HistorySegment,
      "partialEndVersionVector" | "partialStartVersionVector"
    >,
  ): Uint8Array | null;
  free(): void;
}

/**
 * Open the full-history snapshot a rotation proof returned. A holder
 * restored from a snapshot segments exactly as the document it came from,
 * so the segments carry the proven history and nothing else.
 */
export function openRotationHistory(input: {
  /** Names the caller in the error for a snapshot that is not one. */
  readonly purpose: string;
  readonly snapshot: Uint8Array;
}): RotationHistory {
  const metadata = getImportBlobMetadata(input.snapshot);
  if (
    metadata.mode !== "snapshot" ||
    !versionVectorsEqual(
      metadata.partialStartVersionVector,
      emptyVersionVector(),
    )
  ) {
    throw new Error(
      `${input.purpose} requires a full-history rotation snapshot`,
    );
  }
  const document = createReadOnlyDocument();
  try {
    importSnapshot(document, input.snapshot);
  } catch (error) {
    document.free();
    throw error;
  }
  return {
    empty: versionVectorsEqual(
      metadata.partialEndVersionVector,
      emptyVersionVector(),
    ),
    free: () => document.free(),
    segmentRange: (range) => exportHistorySegmentRange(document, range),
    segments: (sizes, after) => exportHistorySegments(document, sizes, after),
    version: metadata.partialEndVersionVector,
  };
}
