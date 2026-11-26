/**
 * The fields that place an update in a rotation baseline: an ordered group
 * of ordinary updates, its segments, written at the epoch a rotation opened,
 * that together carry the document's whole history. Its writer signs them in
 * the update's content-record metadata, so a reader recomputes that hash
 * from them and a server cannot move a segment to another place or group.
 */
export interface DocumentBaselineSegmentFields {
  /** The group the segment belongs to. */
  baselineId: string;
  /** The segment's place in the group, from zero. */
  baselineSegmentIndex: number;
  /** On the final segment only: how many segments the group has. */
  baselineSegmentCount?: number | undefined;
  /**
   * On the final segment only: the digest of the segments before it
   * (`computeDocumentBaselineSegmentsDigest`).
   */
  baselineSegmentsDigest?: string | undefined;
  /**
   * On the final segment only, its author's processed cursor: every update
   * committed at or before it was imported into the baseline or void for
   * the author, so the API asks the group to cover only later updates.
   */
  coversThroughUpdateId?: string | undefined;
}

/** An update's baseline fields; an ordinary update has none. */
export interface OptionalDocumentBaselineSegmentFields {
  baselineId?: string | undefined;
  baselineSegmentIndex?: number | undefined;
  baselineSegmentCount?: number | undefined;
  baselineSegmentsDigest?: string | undefined;
  coversThroughUpdateId?: string | undefined;
}

/**
 * The baseline fields `update` carries, with absent ones left out, so the
 * result spreads into a record that signs or sends exactly those fields.
 */
export function documentBaselineSegmentFields(
  update: OptionalDocumentBaselineSegmentFields,
): OptionalDocumentBaselineSegmentFields {
  return {
    ...(update.baselineId === undefined
      ? {}
      : { baselineId: update.baselineId }),
    ...(update.baselineSegmentIndex === undefined
      ? {}
      : { baselineSegmentIndex: update.baselineSegmentIndex }),
    ...(update.baselineSegmentCount === undefined
      ? {}
      : { baselineSegmentCount: update.baselineSegmentCount }),
    ...(update.baselineSegmentsDigest === undefined
      ? {}
      : { baselineSegmentsDigest: update.baselineSegmentsDigest }),
    ...(update.coversThroughUpdateId === undefined
      ? {}
      : { coversThroughUpdateId: update.coversThroughUpdateId }),
  };
}

/** Whether `update` is a segment of a rotation baseline. */
export function isDocumentBaselineSegment(update: {
  readonly baselineId?: string | undefined;
}): boolean {
  return update.baselineId !== undefined;
}
