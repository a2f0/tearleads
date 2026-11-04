import { compareCanonicalStrings } from "@tearleads/crypto";
import type { DocumentEditAttributionRangeResponse } from "@tearleads/validators/response";
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
      compareCanonicalStrings(left.writerUserId, right.writerUserId) ||
      compareCanonicalStrings(
        left.writerKeyFingerprint,
        right.writerKeyFingerprint,
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
    .sort((left, right) =>
      compareCanonicalStrings(left.fieldKey, right.fieldKey),
    );
}
