import type { DocumentStoreState } from "../state";

/**
 * Queued local writes coalesce per key: `text` for `setText`, and
 * `field:<name>` per structured field a non-deferred patch sets. A write still
 * waiting on the write chain is superseded once a newer write claims EVERY key
 * it covers. It then skips entirely — no apply, no persist — because the newer
 * writes carry each of its values, and the persist that applies them exports
 * every op since `pendingBaseVersion`. A write with any key still its own runs
 * in full, so its values never live only in memory, where a durable reload
 * between it and a newer write would drop them. A typing burst in one field
 * thus costs at most one commit in flight plus one queued.
 */
export type LocalWriteKey = "text" | `field:${string}`;

export interface LocalWriteTicket {
  readonly keys: readonly LocalWriteKey[];
  readonly sequence: number;
}

/** Issues the newest ticket for `keys`, superseding older claims on them. */
export function issueLocalWriteTicket(
  state: DocumentStoreState,
  keys: readonly LocalWriteKey[],
): LocalWriteTicket {
  const tickets = state.localWriteTickets;
  tickets.issued += 1;
  for (const key of keys) {
    tickets.latestByKey.set(key, tickets.issued);
  }
  return { keys, sequence: tickets.issued };
}

/** Whether newer queued writes claimed every key of a (non-empty) ticket. */
export function isLocalWriteSuperseded(
  state: DocumentStoreState,
  ticket: LocalWriteTicket | null,
): boolean {
  if (ticket === null || ticket.keys.length === 0) return false;
  const { latestByKey } = state.localWriteTickets;
  return ticket.keys.every((key) => latestByKey.get(key) !== ticket.sequence);
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
