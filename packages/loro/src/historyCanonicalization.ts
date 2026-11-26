import {
  idStrToId,
  type JsonChange,
  type JsonSchema,
  type PeerID,
} from "loro-crdt";
import {
  compareCanonicalIdentity,
  serializeCanonicalHistoryValue,
} from "./historyCanonicalValue";
import { type CanonicalOperation, RunEncoder } from "./historyUnitRuns";

interface CanonicalChange {
  readonly deps: string[];
  readonly id: string;
  readonly lamport: number;
  readonly msg: string | null;
  readonly ops: CanonicalOperation[];
  readonly timestamp: number;
}

/** A canonical change still taking units: its first unit's facts and its runs. */
interface OpenChange {
  readonly change: JsonChange;
  readonly counter: number;
  readonly encoder: RunEncoder;
}

interface PeerChange {
  readonly change: JsonChange;
  readonly counter: number;
}

/**
 * Whether the first unit of `next` continues the canonical change `open`: it
 * depends on the counter before it and nothing else, its Lamport time is the
 * next one, and it carries the same commit time and message. Those are the
 * facts of every unit after a change's first, so a change Loro stored in two
 * parts, or a reader received in two updates, reads as the one it is. A
 * change with any other dependency, time or message starts a canonical
 * change for every holder.
 */
function continuesChange(
  open: OpenChange,
  next: PeerChange,
  peer: PeerID,
): boolean {
  const { change, counter } = next;
  return (
    change.deps.length === 1 &&
    change.deps[0] === `${counter - 1}@${peer}` &&
    change.lamport === open.change.lamport + (counter - open.counter) &&
    change.timestamp === open.change.timestamp &&
    (change.msg ?? null) === (open.change.msg ?? null)
  );
}

function closeChange(open: OpenChange): CanonicalChange {
  const { deps, id, lamport, msg, timestamp } = open.change;
  return {
    // Dependencies are a set: the order Loro lists them in is not a fact.
    deps: [...deps].sort(compareCanonicalIdentity),
    id,
    lamport,
    msg: msg ?? null,
    ops: open.encoder.finish(),
    timestamp,
  };
}

/** One peer's changes, in counter order, as its canonical changes. */
function canonicalPeerChanges(
  peer: PeerID,
  changes: readonly PeerChange[],
): CanonicalChange[] {
  const canonical: CanonicalChange[] = [];
  let open: OpenChange | null = null;
  for (const next of changes) {
    if (open === null || !continuesChange(open, next, peer)) {
      if (open !== null) canonical.push(closeChange(open));
      open = { ...next, encoder: new RunEncoder() };
    }
    for (const operation of next.change.ops) open.encoder.push(operation);
  }
  if (open !== null) canonical.push(closeChange(open));
  return canonical;
}

/**
 * The canonical form of `history`, a whole history or the range one export
 * holds. It depends only on the history's units, one per operation counter:
 * what each did, and the dependencies, Lamport time, commit time and message
 * it carries. How Loro grouped the units into operations and changes varies
 * with the path that brought them and leaves no trace here, and each run and
 * canonical change says exactly what its units are, so two histories share a
 * form only when they hold the same units.
 *
 * An export's `start_version` is left out: it is the frontier of the range's
 * start as the exporting document sees it, which a holder of more peers
 * reports differently for the same range. A range's first counters say where
 * it starts.
 */
export function serializeCanonicalHistory(history: JsonSchema): string {
  const byPeer = new Map<PeerID, PeerChange[]>();
  for (const change of history.changes) {
    const { counter, peer } = idStrToId(change.id);
    const changes = byPeer.get(peer);
    if (changes) changes.push({ change, counter });
    else byPeer.set(peer, [{ change, counter }]);
  }
  const changes = [...byPeer.entries()]
    .sort(([left], [right]) => compareCanonicalIdentity(left, right))
    .flatMap(([peer, peerChanges]) =>
      canonicalPeerChanges(
        peer,
        peerChanges.sort((left, right) => left.counter - right.counter),
      ),
    );
  const { peers, schema_version } = history;
  return serializeCanonicalHistoryValue({ changes, peers, schema_version });
}
