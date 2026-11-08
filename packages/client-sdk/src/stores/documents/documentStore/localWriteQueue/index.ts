import type { DocumentStoreState } from "../state";

/**
 * Lanes whose queued local writes coalesce. A write still waiting on the write
 * chain when a newer write in its lane is queued is superseded:
 * - `text`: `setText` carries the whole value, so a superseded write skips
 *   entirely and the newest one applies the latest text.
 * - `structuredFields`: patches are partial, so a superseded write still
 *   applies its fields and skips only its durable persist.
 * Either way the newest write's persist exports every op since
 * `pendingBaseVersion`, which covers what the superseded writes left in the
 * doc, so a typing burst costs at most one commit in flight plus one queued.
 */
export type CoalescedLocalWriteLane =
  keyof DocumentStoreState["latestLocalWriteTickets"];

export interface LocalWriteTicket {
  readonly lane: CoalescedLocalWriteLane;
  readonly sequence: number;
}

/** Issues `lane`'s newest ticket, superseding every earlier write in it. */
export function issueLocalWriteTicket(
  state: DocumentStoreState,
  lane: CoalescedLocalWriteLane,
): LocalWriteTicket {
  state.latestLocalWriteTickets[lane] += 1;
  return { lane, sequence: state.latestLocalWriteTickets[lane] };
}

/** Whether a newer write in the ticket's lane was queued after it. */
export function isLocalWriteSuperseded(
  state: DocumentStoreState,
  ticket: LocalWriteTicket | null,
): boolean {
  return (
    ticket !== null &&
    state.latestLocalWriteTickets[ticket.lane] !== ticket.sequence
  );
}

/**
 * Counts `write` in `queuedWrites` until it settles. Counted synchronously, so
 * a write started while a removal runs is visible to its commit guard.
 */
export function countQueuedWrite<T>(
  state: DocumentStoreState,
  write: Promise<T>,
): Promise<T> {
  state.queuedWrites += 1;
  const settle = () => {
    state.queuedWrites -= 1;
  };
  void write.then(settle, settle);
  return write;
}

/** Installs `link` as the store's write chain, counted until it settles. */
export function chainQueuedWrite(
  state: DocumentStoreState,
  link: Promise<void>,
): Promise<void> {
  state.writeChain = countQueuedWrite(state, link);
  return state.writeChain;
}
