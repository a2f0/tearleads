import {
  type DocumentAttributionInterval,
  signingIdentityKey,
} from "./editAttributionTypes";

interface OpIdAttribution {
  writerUserId: string;
  writerKeyFingerprint: string;
  authorityKind: "direct" | "baseline";
}

interface CharacterOpId {
  readonly peerId: string;
  readonly counter: number;
}

interface DocumentBlameSource {
  readonly codePoints: readonly string[];
  readonly opIds: readonly CharacterOpId[];
}

interface DocumentCharacterBlame {
  writerUserId: string;
  writerKeyFingerprint: string;
  /** Characters (code points) currently attributed to this signing identity. */
  characterCount: number;
  /** Live characters credited through ordinary incremental updates. */
  directCharacterCount: number;
  /** Live characters credited through rotate_baseline re-assertions. */
  baselineCharacterCount: number;
  hasDirectAuthority: boolean;
  hasBaselineAuthority: boolean;
}

export interface DocumentCharacterBlameSummary {
  /** Per-signing-identity breakdown, ordered by `characterCount` desc. */
  writers: DocumentCharacterBlame[];
  totalCharacterCount: number;
  /** Characters not covered by the current remote attribution intervals. */
  unattributedCharacterCount: number;
}

export interface DocumentBlameRange {
  /** Code-point start index (inclusive) of this run in the current text. */
  startIndex: number;
  /** Code-point end index (exclusive). */
  endIndex: number;
  text: string;
  writerUserId: string | null;
  writerKeyFingerprint: string | null;
  authorityKind: "direct" | "baseline" | null;
}

interface DocumentBlameSummary {
  characterBlame: DocumentCharacterBlameSummary;
  blameRanges: DocumentBlameRange[];
}

/** Build a sorted per-peer interval index and binary-search each op counter. */
function createOpIdResolver(
  segments: readonly DocumentAttributionInterval[],
): (peerId: string, counter: number) => OpIdAttribution | null {
  const segmentsByPeer = new Map<string, DocumentAttributionInterval[]>();
  for (const segment of segments) {
    if (segment.endCounter <= segment.startCounter) {
      continue;
    }
    const existing = segmentsByPeer.get(segment.peerId);
    if (existing) {
      existing.push(segment);
    } else {
      segmentsByPeer.set(segment.peerId, [segment]);
    }
  }
  for (const peerSegments of segmentsByPeer.values()) {
    peerSegments.sort(
      (left, right) =>
        left.startCounter - right.startCounter ||
        left.endCounter - right.endCounter,
    );
  }

  return (peerId, counter) => {
    const peerSegments = segmentsByPeer.get(peerId);
    if (!peerSegments) {
      return null;
    }
    let low = 0;
    let high = peerSegments.length;
    while (low < high) {
      const middle = low + Math.floor((high - low) / 2);
      const segment = peerSegments[middle];
      if (!segment || segment.startCounter > counter) {
        high = middle;
      } else {
        low = middle + 1;
      }
    }
    const segment = peerSegments[low - 1];
    if (!segment || counter >= segment.endCounter) {
      return null;
    }
    return {
      writerUserId: segment.writerUserId,
      writerKeyFingerprint: segment.writerKeyFingerprint,
      authorityKind: segment.authorityKind,
    };
  };
}

/** Resolve one op id. Reuse the summary functions for whole-document sweeps. */
export function resolveOpIdAttribution(
  segments: readonly DocumentAttributionInterval[],
  peerId: string,
  counter: number,
): OpIdAttribution | null {
  return createOpIdResolver(segments)(peerId, counter);
}

function countCharacter(
  byWriter: Map<string, DocumentCharacterBlame>,
  attribution: OpIdAttribution,
): void {
  const identityKey = signingIdentityKey(attribution);
  const existing = byWriter.get(identityKey);
  if (existing) {
    existing.characterCount += 1;
    existing.directCharacterCount +=
      attribution.authorityKind === "direct" ? 1 : 0;
    existing.baselineCharacterCount +=
      attribution.authorityKind === "baseline" ? 1 : 0;
    existing.hasDirectAuthority ||= attribution.authorityKind === "direct";
    existing.hasBaselineAuthority ||= attribution.authorityKind === "baseline";
    return;
  }
  byWriter.set(identityKey, {
    writerUserId: attribution.writerUserId,
    writerKeyFingerprint: attribution.writerKeyFingerprint,
    characterCount: 1,
    directCharacterCount: attribution.authorityKind === "direct" ? 1 : 0,
    baselineCharacterCount: attribution.authorityKind === "baseline" ? 1 : 0,
    hasDirectAuthority: attribution.authorityKind === "direct",
    hasBaselineAuthority: attribution.authorityKind === "baseline",
  });
}

function finishCharacterSummary(
  byWriter: Map<string, DocumentCharacterBlame>,
  totalCharacterCount: number,
  unattributedCharacterCount: number,
): DocumentCharacterBlameSummary {
  return {
    writers: [...byWriter.values()].sort(
      (left, right) =>
        right.characterCount - left.characterCount ||
        left.writerUserId.localeCompare(right.writerUserId) ||
        left.writerKeyFingerprint.localeCompare(right.writerKeyFingerprint),
    ),
    totalCharacterCount,
    unattributedCharacterCount,
  };
}

function appendRange(
  ranges: DocumentBlameRange[],
  index: number,
  attribution: OpIdAttribution | null,
): void {
  const writerUserId = attribution?.writerUserId ?? null;
  const writerKeyFingerprint = attribution?.writerKeyFingerprint ?? null;
  const authorityKind = attribution?.authorityKind ?? null;
  const current = ranges.at(-1);
  if (
    current &&
    current.writerUserId === writerUserId &&
    current.writerKeyFingerprint === writerKeyFingerprint &&
    current.authorityKind === authorityKind
  ) {
    current.endIndex = index + 1;
    return;
  }
  ranges.push({
    startIndex: index,
    endIndex: index + 1,
    text: "",
    writerUserId,
    writerKeyFingerprint,
    authorityKind,
  });
}

function fillRangeText(
  ranges: DocumentBlameRange[],
  codePoints: readonly string[],
): void {
  for (const range of ranges) {
    range.text = codePoints.slice(range.startIndex, range.endIndex).join("");
  }
}

/** Count current characters by signing identity. */
export function summarizeCharacterBlame(
  charOpIds: readonly CharacterOpId[],
  segments: readonly DocumentAttributionInterval[],
): DocumentCharacterBlameSummary {
  const resolveOpId = createOpIdResolver(segments);
  const byWriter = new Map<string, DocumentCharacterBlame>();
  let unattributedCharacterCount = 0;
  for (const { peerId, counter } of charOpIds) {
    const attribution = resolveOpId(peerId, counter);
    if (attribution) {
      countCharacter(byWriter, attribution);
    } else {
      unattributedCharacterCount += 1;
    }
  }
  return finishCharacterSummary(
    byWriter,
    charOpIds.length,
    unattributedCharacterCount,
  );
}

/** Coalesce current prose into homogeneous signing-identity/authority runs. */
export function summarizeBlameRanges(
  source: DocumentBlameSource,
  segments: readonly DocumentAttributionInterval[],
): DocumentBlameRange[] {
  const resolveOpId = createOpIdResolver(segments);
  const ranges: DocumentBlameRange[] = [];
  for (let index = 0; index < source.codePoints.length; index += 1) {
    const opId = source.opIds[index];
    appendRange(
      ranges,
      index,
      opId ? resolveOpId(opId.peerId, opId.counter) : null,
    );
  }
  fillRangeText(ranges, source.codePoints);
  return ranges;
}

/**
 * Derive character totals and prose runs with one interval lookup per code point.
 * The standalone summary functions remain available for callers needing one view.
 */
export function summarizeDocumentBlame(
  source: DocumentBlameSource,
  segments: readonly DocumentAttributionInterval[],
): DocumentBlameSummary {
  const resolveOpId = createOpIdResolver(segments);
  const byWriter = new Map<string, DocumentCharacterBlame>();
  const blameRanges: DocumentBlameRange[] = [];
  let unattributedCharacterCount = 0;
  for (let index = 0; index < source.codePoints.length; index += 1) {
    const opId = source.opIds[index];
    const attribution = opId ? resolveOpId(opId.peerId, opId.counter) : null;
    if (attribution) {
      countCharacter(byWriter, attribution);
    } else {
      unattributedCharacterCount += 1;
    }
    appendRange(blameRanges, index, attribution);
  }
  fillRangeText(blameRanges, source.codePoints);
  return {
    characterBlame: finishCharacterSummary(
      byWriter,
      source.codePoints.length,
      unattributedCharacterCount,
    ),
    blameRanges,
  };
}
