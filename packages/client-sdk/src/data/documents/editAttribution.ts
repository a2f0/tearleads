import type { DocumentEditAttributionResponse } from "@tearleads/validators/response";

export type DocumentEditAttributionSegment =
  DocumentEditAttributionResponse["segments"][number];

export interface DocumentContributor {
  writerUserId: string;
  writerKeyFingerprint: string;
  /** Total Loro op counters attributed to this writer across the document. */
  opCount: number;
  /** This writer has at least one ordinary (incremental) attributed range. */
  hasDirectAuthority: boolean;
  /** This writer is credited only via a rotate_baseline re-assertion somewhere. */
  hasBaselineAuthority: boolean;
}

/**
 * Aggregate attribution segments into a per-writer contributor summary, ordered
 * by op count (desc). Writers are keyed by signing identity (`writerUserId` /
 * `writerKeyFingerprint`) — no roster/profile decryption needed; the fingerprint
 * is resolvable via the plaintext org directory.
 */
export function summarizeDocumentContributors(
  segments: readonly DocumentEditAttributionSegment[],
): DocumentContributor[] {
  const byWriter = new Map<string, DocumentContributor>();
  for (const segment of segments) {
    const opCount = segment.endCounter - segment.startCounter;
    if (opCount <= 0) {
      continue;
    }
    const existing = byWriter.get(segment.writerUserId);
    if (existing) {
      existing.opCount += opCount;
      existing.hasDirectAuthority ||= segment.authorityKind === "direct";
      existing.hasBaselineAuthority ||= segment.authorityKind === "baseline";
      continue;
    }
    byWriter.set(segment.writerUserId, {
      writerUserId: segment.writerUserId,
      writerKeyFingerprint: segment.writerKeyFingerprint,
      opCount,
      hasDirectAuthority: segment.authorityKind === "direct",
      hasBaselineAuthority: segment.authorityKind === "baseline",
    });
  }
  return [...byWriter.values()].sort(
    (left, right) =>
      right.opCount - left.opCount ||
      left.writerUserId.localeCompare(right.writerUserId),
  );
}

export interface DocumentAttributionSegment {
  peerId: string;
  startCounter: number;
  endCounter: number;
  /** Loro op counters in this contiguous range (`endCounter - startCounter`). */
  opCount: number;
  /** The signed upload (`document_updates.id`) that delivered this range. */
  updateId: string;
  /** Server receive order of that upload (`document_updates.sequence`). */
  updateSequence: number;
  writerUserId: string;
  writerKeyFingerprint: string;
  authorityKind: "direct" | "baseline";
}

/**
 * Normalize attribution segments into the granular per-range list behind the
 * contributor rollup: empty ranges dropped, each tagged with its op count, and
 * ordered to mirror {@link summarizeDocumentContributors} (writers by total op
 * count desc, then each writer's ranges in counter order). This is the
 * drill-down detail — "who wrote which ranges, direct vs re-asserted" — that the
 * `N edits` summary collapses away.
 */
export function listDocumentAttributionSegments(
  segments: readonly DocumentEditAttributionSegment[],
): DocumentAttributionSegment[] {
  const rangesByWriter = new Map<string, DocumentAttributionSegment[]>();
  for (const segment of segments) {
    if (segment.endCounter <= segment.startCounter) {
      continue;
    }
    const range: DocumentAttributionSegment = {
      peerId: segment.peerId,
      startCounter: segment.startCounter,
      endCounter: segment.endCounter,
      opCount: segment.endCounter - segment.startCounter,
      updateId: segment.updateId,
      updateSequence: segment.updateSequence,
      writerUserId: segment.writerUserId,
      writerKeyFingerprint: segment.writerKeyFingerprint,
      authorityKind: segment.authorityKind,
    };
    const existing = rangesByWriter.get(segment.writerUserId);
    if (existing) {
      existing.push(range);
    } else {
      rangesByWriter.set(segment.writerUserId, [range]);
    }
  }
  // summarizeDocumentContributors credits every writer with an op-bearing range,
  // and rangesByWriter is grouped from those same ranges, so each contributor has
  // a group here — flat-mapping by contributor order aligns the drill-down with
  // the Contributors section and drops nothing.
  return summarizeDocumentContributors(segments).flatMap((contributor) =>
    (rangesByWriter.get(contributor.writerUserId) ?? []).sort(
      (left, right) =>
        left.startCounter - right.startCounter ||
        left.peerId.localeCompare(right.peerId),
    ),
  );
}

interface PeerWriterAttribution {
  writerUserId: string;
  writerKeyFingerprint: string;
}

interface OpIdAttribution {
  writerUserId: string;
  writerKeyFingerprint: string;
  authorityKind: "direct" | "baseline";
}

/**
 * Resolve a single Loro op id `(peerId, counter)` — e.g. one character's op id
 * from `listTextCharOpIds` — to the writer authoritatively credited with it, by
 * intersecting it against the attribution segments. This is the character-level
 * counterpart to the per-range drill-down: unlike {@link writerByPeerId} it is
 * exact even when a peer is split across writers by a re-assertion, because it
 * matches the specific counter rather than the whole peer. Segments are
 * non-overlapping, so the first covering segment is the only one. Returns null
 * when no segment covers the op id — e.g. a locally authored op whose span the
 * attribution feed has not delivered yet.
 */
export function resolveOpIdAttribution(
  segments: readonly DocumentEditAttributionSegment[],
  peerId: string,
  counter: number,
): OpIdAttribution | null {
  for (const segment of segments) {
    if (
      segment.peerId === peerId &&
      counter >= segment.startCounter &&
      counter < segment.endCounter
    ) {
      return {
        writerUserId: segment.writerUserId,
        writerKeyFingerprint: segment.writerKeyFingerprint,
        authorityKind: segment.authorityKind,
      };
    }
  }
  return null;
}

/**
 * Map each Loro peer to its writer, for character-level blame: `getEditorOf(pos)`
 * returns a `PeerID`, and this resolves it to a writer. A peer is normally
 * written by a single member; if a re-assertion split the peer's range across
 * writers the peer maps to `null` (ambiguous) so callers fall back to the
 * authoritative per-range segment list instead of guessing.
 */
export function writerByPeerId(
  segments: readonly DocumentEditAttributionSegment[],
): Map<string, PeerWriterAttribution | null> {
  const byPeer = new Map<string, PeerWriterAttribution | null>();
  for (const segment of segments) {
    if (segment.endCounter <= segment.startCounter) {
      continue;
    }
    const existing = byPeer.get(segment.peerId);
    if (existing === undefined) {
      byPeer.set(segment.peerId, {
        writerUserId: segment.writerUserId,
        writerKeyFingerprint: segment.writerKeyFingerprint,
      });
      continue;
    }
    if (existing !== null && existing.writerUserId !== segment.writerUserId) {
      byPeer.set(segment.peerId, null);
    }
  }
  return byPeer;
}

export interface DocumentCharacterBlame {
  writerUserId: string;
  writerKeyFingerprint: string;
  /** Characters (code points) currently in the document attributed to this writer. */
  characterCount: number;
  /** At least one of this writer's live characters is an ordinary (direct) edit. */
  hasDirectAuthority: boolean;
  /** At least one is credited only via a rotate_baseline re-assertion. */
  hasBaselineAuthority: boolean;
}

export interface DocumentCharacterBlameSummary {
  /** Per-writer breakdown, ordered by `characterCount` desc. */
  writers: DocumentCharacterBlame[];
  /** Total characters (code points) currently in the document. */
  totalCharacterCount: number;
  /**
   * Characters no attribution segment covers — typically local edits not yet
   * reflected in the (remote) attribution feed.
   */
  unattributedCharacterCount: number;
}

/**
 * Roll up per-character "blame" for the current document: resolve each character's
 * Loro op id (from `listSnapshotCharOpIds` / `listTextCharOpIds`, in document
 * order) to its authoritative writer via {@link resolveOpIdAttribution}, then
 * count live characters per writer. Unlike {@link summarizeDocumentContributors}
 * — which sums op *counters* (every op ever, including superseded/deleted) — this
 * counts the characters actually present now, so it answers "who wrote how much of
 * the text as it stands". Characters no segment covers are tallied separately.
 */
export function summarizeCharacterBlame(
  charOpIds: ReadonlyArray<{
    readonly peerId: string;
    readonly counter: number;
  }>,
  segments: readonly DocumentEditAttributionSegment[],
): DocumentCharacterBlameSummary {
  const byWriter = new Map<string, DocumentCharacterBlame>();
  let unattributedCharacterCount = 0;
  for (const { peerId, counter } of charOpIds) {
    const attribution = resolveOpIdAttribution(segments, peerId, counter);
    if (!attribution) {
      unattributedCharacterCount += 1;
      continue;
    }
    const existing = byWriter.get(attribution.writerUserId);
    if (existing) {
      existing.characterCount += 1;
      existing.hasDirectAuthority ||= attribution.authorityKind === "direct";
      existing.hasBaselineAuthority ||=
        attribution.authorityKind === "baseline";
      continue;
    }
    byWriter.set(attribution.writerUserId, {
      writerUserId: attribution.writerUserId,
      writerKeyFingerprint: attribution.writerKeyFingerprint,
      characterCount: 1,
      hasDirectAuthority: attribution.authorityKind === "direct",
      hasBaselineAuthority: attribution.authorityKind === "baseline",
    });
  }
  const writers = [...byWriter.values()].sort(
    (left, right) =>
      right.characterCount - left.characterCount ||
      left.writerUserId.localeCompare(right.writerUserId),
  );
  return {
    writers,
    totalCharacterCount: charOpIds.length,
    unattributedCharacterCount,
  };
}
