import type { LoroDoc } from "loro-crdt";

/**
 * The longest span, in seconds, that one change may cover after its own
 * timestamp. Loro folds a peer's consecutive commits into one change while
 * they fall inside this window, and a change carries exactly one timestamp,
 * so this is the time resolution of a document's history: an operation was
 * committed no later than this many seconds after its change's timestamp.
 *
 * A wider window stores fewer changes and coarser times. One second costs at
 * most one change per second of activity, which measured as roughly a fifth
 * more snapshot bytes for the slowest possible typist (one character every
 * one to three seconds) and far less for ordinary bursts.
 */
export const DOCUMENT_CHANGE_MERGE_INTERVAL_SECONDS = 1;

/**
 * Make every change this document authors carry the Unix time, in seconds, of
 * its commit. History is the only durable record of when an edit happened:
 * uploads coalesce local writes, and local tail rows fold into checkpoints.
 *
 * The setting belongs to the document instance, not to its exported bytes, so
 * it must be applied to every document that can author. A document without it
 * stamps the largest timestamp it has imported instead of the current time,
 * which silently back-dates its edits. `fork()` copies the setting.
 */
export function recordChangeTimestamps(doc: LoroDoc): void {
  doc.setRecordTimestamp(true);
  doc.setChangeMergeInterval(DOCUMENT_CHANGE_MERGE_INTERVAL_SECONDS);
}
