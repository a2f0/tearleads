import { listVersionVectorSpans } from "@tearleads/loro";
import type { DocumentEditAttributionRange } from "../../../data/documents/editAttribution";

/**
 * One run of a peer's operations and the signed upload that first carried it
 * in the server's history, as this device verified it. It has the shape of an
 * edit-attribution range, so one reader resolves a history stop's uploader
 * and upload time from either source.
 *
 * `authorityKind` is `direct` when an ordinary signed upload first carried
 * the operations, and `baseline` when only a rotation baseline did: those
 * remain whatever the baseline's signer asserted. `writerUserId`,
 * `writerKeyFingerprint`, and `signedAt` come from the verified write header;
 * `createdAt` is the server's own, unsigned.
 */
export type DocumentHistoryVerifiedRange = DocumentEditAttributionRange;

/** An accepted update of a raw history, as its verified header declares it. */
export interface CreditedHistoryUpdate {
  readonly authorityKind: DocumentHistoryVerifiedRange["authorityKind"];
  readonly createdAt: string;
  readonly partialEndVersionVector: string;
  readonly partialStartVersionVector: string;
  readonly signedAt: string;
  readonly updateId: string;
  readonly writerKeyFingerprint: string;
  readonly writerUserId: string;
}

/** Counters `[start, end)` of one peer. */
interface CounterSpan {
  readonly end: number;
  readonly start: number;
}

/** The parts of `span` that `covered` (sorted, disjoint) leaves out. */
function uncoveredSpans(
  covered: readonly CounterSpan[],
  span: CounterSpan,
): CounterSpan[] {
  const gaps: CounterSpan[] = [];
  let cursor = span.start;
  for (const held of covered) {
    if (cursor >= span.end || held.start >= span.end) break;
    if (held.end <= cursor) continue;
    if (held.start > cursor) gaps.push({ end: held.start, start: cursor });
    cursor = held.end;
  }
  if (cursor < span.end) gaps.push({ end: span.end, start: cursor });
  return gaps;
}

/** `covered` with `span` added: sorted, and merged where spans touch. */
function coverSpan(
  covered: readonly CounterSpan[],
  span: CounterSpan,
): CounterSpan[] {
  const merged: CounterSpan[] = [];
  const ordered = [...covered, span].sort(
    (left, right) => left.start - right.start,
  );
  for (const next of ordered) {
    const last = merged.at(-1);
    if (last !== undefined && next.start <= last.end) {
      merged[merged.length - 1] = {
        end: Math.max(last.end, next.end),
        start: last.start,
      };
    } else {
      merged.push(next);
    }
  }
  return merged;
}

function comparePeerIds(left: string, right: string): number {
  // Peer ids are decimal strings of unequal length: order them numerically.
  if (left.length !== right.length) return left.length - right.length;
  return left < right ? -1 : Number(left > right);
}

/**
 * Credits every operation of a raw history to the earliest accepted update
 * that carried it. `updates` are the accepted updates in server order, whose
 * spans the import judge checked against their payloads. The same operation
 * can be carried again by a later update, as a rotation baseline carries
 * every peer from its first counter, so a later carrier is credited only with
 * the counters no earlier update covered. Ranges come back ordered by peer,
 * then counter.
 */
export function creditDocumentHistoryUpdates(
  updates: readonly CreditedHistoryUpdate[],
): DocumentHistoryVerifiedRange[] {
  const coveredByPeer = new Map<string, CounterSpan[]>();
  const ranges: DocumentHistoryVerifiedRange[] = [];
  for (const update of updates) {
    for (const span of listVersionVectorSpans(update)) {
      const claim = { end: span.endCounter, start: span.startCounter };
      const covered = coveredByPeer.get(span.peerId) ?? [];
      for (const first of uncoveredSpans(covered, claim)) {
        ranges.push({
          authorityKind: update.authorityKind,
          createdAt: update.createdAt,
          endCounter: first.end,
          peerId: span.peerId,
          signedAt: update.signedAt,
          startCounter: first.start,
          updateId: update.updateId,
          writerKeyFingerprint: update.writerKeyFingerprint,
          writerUserId: update.writerUserId,
        });
      }
      coveredByPeer.set(span.peerId, coverSpan(covered, claim));
    }
  }
  return ranges.sort(
    (left, right) =>
      comparePeerIds(left.peerId, right.peerId) ||
      left.startCounter - right.startCounter,
  );
}
