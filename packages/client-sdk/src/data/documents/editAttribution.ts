import type { DocumentEditAttributionRangeResponse } from "@symcrypt/validators/response";
import {
  type DocumentAttributionInterval,
  signingIdentityKey,
} from "./editAttributionTypes";

export {
  type DocumentBlameRange,
  type DocumentCharacterBlameSummary,
  resolveOpIdAttribution,
  summarizeBlameRanges,
  summarizeCharacterBlame,
  summarizeDocumentBlame,
} from "./editAttributionBlame";
export type { DocumentAttributionInterval } from "./editAttributionTypes";

export type DocumentEditAttributionRange = DocumentEditAttributionRangeResponse;

export interface DocumentContributor {
  writerUserId: string;
  writerKeyFingerprint: string;
  /** Total Loro op counters attributed to this writer across the document. */
  opCount: number;
  /** Ordinary (incremental) op counters attributed to this signing identity. */
  directOpCount: number;
  /** Op counters credited via a rotate_baseline re-assertion. */
  baselineOpCount: number;
  /** This writer has at least one ordinary (incremental) attributed range. */
  hasDirectAuthority: boolean;
  /** This identity has at least one rotate_baseline re-asserted range. */
  hasBaselineAuthority: boolean;
}

/**
 * Aggregate attribution segments into a per-signing-identity summary, ordered
 * by op count (desc). Writers are keyed by signing identity (`writerUserId` /
 * `writerKeyFingerprint`) — no roster/profile decryption needed; the fingerprint
 * is resolvable via the plaintext org directory.
 */
export function summarizeDocumentContributors(
  segments: readonly DocumentAttributionInterval[],
): DocumentContributor[] {
  const byWriter = new Map<string, DocumentContributor>();
  for (const segment of segments) {
    const opCount = segment.endCounter - segment.startCounter;
    if (opCount <= 0) {
      continue;
    }
    const identityKey = signingIdentityKey(segment);
    const existing = byWriter.get(identityKey);
    if (existing) {
      existing.opCount += opCount;
      existing.directOpCount +=
        segment.authorityKind === "direct" ? opCount : 0;
      existing.baselineOpCount +=
        segment.authorityKind === "baseline" ? opCount : 0;
      existing.hasDirectAuthority ||= segment.authorityKind === "direct";
      existing.hasBaselineAuthority ||= segment.authorityKind === "baseline";
      continue;
    }
    byWriter.set(identityKey, {
      writerUserId: segment.writerUserId,
      writerKeyFingerprint: segment.writerKeyFingerprint,
      opCount,
      directOpCount: segment.authorityKind === "direct" ? opCount : 0,
      baselineOpCount: segment.authorityKind === "baseline" ? opCount : 0,
      hasDirectAuthority: segment.authorityKind === "direct",
      hasBaselineAuthority: segment.authorityKind === "baseline",
    });
  }
  return [...byWriter.values()].sort(
    (left, right) =>
      right.opCount - left.opCount ||
      left.writerUserId.localeCompare(right.writerUserId) ||
      left.writerKeyFingerprint.localeCompare(right.writerKeyFingerprint),
  );
}

interface DocumentAttributionSegment {
  peerId: string;
  startCounter: number;
  endCounter: number;
  /** Loro op counters in this contiguous range (`endCounter - startCounter`). */
  opCount: number;
  /** The signed upload (`document_updates.id`) that delivered this range. */
  updateId: string;
  writerUserId: string;
  writerKeyFingerprint: string;
  authorityKind: "direct" | "baseline";
}

/**
 * Normalize attribution segments into the granular per-range list behind the
 * contributor rollup: empty ranges dropped, each tagged with its op count, and
 * ordered to mirror {@link summarizeDocumentContributors} (identities by total
 * op count desc, then each identity's ranges in counter order). This is the
 * drill-down detail — "who wrote which ranges, direct vs re-asserted" — that the
 * `N edits` summary collapses away.
 */
export function listDocumentAttributionSegments(
  segments: readonly DocumentEditAttributionRange[],
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
      writerUserId: segment.writerUserId,
      writerKeyFingerprint: segment.writerKeyFingerprint,
      authorityKind: segment.authorityKind,
    };
    const identityKey = signingIdentityKey(segment);
    const existing = rangesByWriter.get(identityKey);
    if (existing) {
      existing.push(range);
    } else {
      rangesByWriter.set(identityKey, [range]);
    }
  }
  // summarizeDocumentContributors credits every writer with an op-bearing range,
  // and rangesByWriter is grouped from those same ranges, so each contributor has
  // a group here — flat-mapping by contributor order aligns the drill-down with
  // the Contributors section and drops nothing.
  return summarizeDocumentContributors(segments).flatMap((contributor) =>
    (rangesByWriter.get(signingIdentityKey(contributor)) ?? []).sort(
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

/**
 * Map each Loro peer to one signing identity. A peer spanning multiple users or
 * fingerprints maps to `null`; peer-only field metadata cannot choose the exact
 * interval without guessing. Authority changes do not obscure a stable identity.
 */
export function writerByPeerId(
  segments: readonly DocumentAttributionInterval[],
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
    if (
      existing !== null &&
      (existing.writerUserId !== segment.writerUserId ||
        existing.writerKeyFingerprint !== segment.writerKeyFingerprint)
    ) {
      byPeer.set(segment.peerId, null);
    }
  }
  return byPeer;
}

export interface DocumentFieldBlame {
  /** The structured field's map key (e.g. `firstName`, `cardNumber`). */
  fieldKey: string;
  /** Writer credited with the last edit, or null when unresolved. */
  writerUserId: string | null;
  /** null when unresolved. */
  writerKeyFingerprint: string | null;
}

/**
 * Per-field "blame" for a structured document (contact, card, license): resolve
 * the peer that last set each field — from `listSnapshotFieldEditors` — to a
 * writer. Unlike the character path, a field carries only its last-editor peer
 * (no op counter), so this resolves peer-level via {@link writerByPeerId}: a
 * field whose peer has no segment or spans signing identities is left
 * unattributed (`writerUserId: null`). Fields are sorted by key.
 */
export function summarizeFieldBlame(
  fieldEditors: ReadonlyArray<{
    readonly key: string;
    readonly peerId: string | null;
  }>,
  segments: readonly DocumentAttributionInterval[],
): DocumentFieldBlame[] {
  const byPeer = writerByPeerId(segments);
  return fieldEditors
    .map(({ key, peerId }) => {
      const writer = peerId === null ? null : (byPeer.get(peerId) ?? null);
      return {
        fieldKey: key,
        writerUserId: writer?.writerUserId ?? null,
        writerKeyFingerprint: writer?.writerKeyFingerprint ?? null,
      };
    })
    .sort((left, right) => left.fieldKey.localeCompare(right.fieldKey));
}
