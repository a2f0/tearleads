import {
  decodeVersionVector,
  encodeVersionVector,
  exportAllUpdates,
  exportUpdatesSince,
  getImportBlobMetadata,
  listVersionVectorSpans,
  type VersionVectorSpan,
} from "@tearleads/loro";
import type { DocumentPeerFrontier } from "@tearleads/validators/response";
import { documentOnPeer, type TestDocument } from "./peerRebase.testFixtures";
import {
  type PeerRefusal,
  planPeerRefusalRecovery,
} from "./peerRefusalRecovery";

interface CommittedPeer {
  readonly committedEndCounter: number;
  readonly ownerUserId: string | null;
}

type PeerVerdict =
  | { readonly kind: "accepted"; readonly claimedPeerIds: readonly string[] }
  | {
      readonly kind: PeerRefusal["kind"];
      readonly peerFrontiers: readonly DocumentPeerFrontier[];
    };

type JudgePeerSpans = (input: {
  readonly committedPeers: ReadonlyMap<string, CommittedPeer>;
  readonly updates: readonly {
    readonly dependencies: readonly {
      readonly endCounter: number;
      readonly peerId: string;
    }[];
    readonly spans: readonly VersionVectorSpan[];
  }[];
  readonly userId: string;
}) => PeerVerdict;

// The API's own rule, so these scenarios meet the verdicts production gives.
// The SDK cannot depend on the API package, and a static import of its source
// would pull it into this TypeScript project, so the module is read at run
// time and typed here. `turbo.json` declares the files as test inputs.
const judgeModule: { readonly judgeDocumentPeerSpans: JudgePeerSpans } =
  await import(
    new URL(
      "../../../../../../api/src/documents/documentPeerOwners.ts",
      import.meta.url,
    ).href
  );

/** The peer ids and users of the scenarios, as issue #3263 names them. */
export const MEMBER_PEER = "11";
export const OWNER_DEVICE_PEER = "22";
export const STALE_PEER = "33";
export const MEMBER = "user-member";
export const OWNER = "user-owner";

export function append(doc: TestDocument, text: string): void {
  const content = doc.getText("text");
  content.insert(content.length, text);
  doc.commit();
}

export function pull(into: TestDocument, from: TestDocument): void {
  into.import(from.export({ mode: "update" }));
}

export function textOf(doc: TestDocument): string {
  return doc.getText("text").toString();
}

function updatePeers(update: Uint8Array) {
  const metadata = getImportBlobMetadata(update);
  return {
    dependencies: [
      ...decodeVersionVector(metadata.dependencyVersionVector).toJSON(),
    ]
      .filter(([, endCounter]) => endCounter > 0)
      .map(([peerId, endCounter]) => ({ endCounter, peerId })),
    spans: listVersionVectorSpans(metadata),
  };
}

/** One document's committed peers and update log, judged by the API's rule. */
export class PeerServer {
  readonly committed = new Map<string, CommittedPeer>();
  readonly log: Uint8Array[] = [];

  /** One request: every update is committed, or none and the refusal returns. */
  submit(userId: string, updates: readonly Uint8Array[]): PeerVerdict {
    const peers = updates.map(updatePeers);
    const verdict = judgeModule.judgeDocumentPeerSpans({
      committedPeers: this.committed,
      updates: peers,
      userId,
    });
    if (verdict.kind !== "accepted") return verdict;
    for (const span of peers.flatMap((update) => update.spans)) {
      const known = this.committed.get(span.peerId);
      this.committed.set(span.peerId, {
        committedEndCounter: Math.max(
          known?.committedEndCounter ?? 0,
          span.endCounter,
        ),
        ownerUserId:
          known?.ownerUserId ??
          (verdict.claimedPeerIds.includes(span.peerId) ? userId : null),
      });
    }
    this.log.push(...updates);
    return verdict;
  }

  /** A device republishes everything it holds, as a remote reset does. */
  republish(userId: string, device: TestDocument): PeerVerdict {
    return this.submit(userId, [exportAllUpdates(device)]);
  }

  /** What a device that never saw the document reads from the log. */
  async readerText(): Promise<string> {
    const reader = await documentOnPeer(777);
    for (const update of this.log) reader.import(update);
    const text = textOf(reader);
    reader.free();
    return text;
  }
}

interface QueuedUpdate {
  readonly committedVersionVector: string | null;
  readonly partialEndVersionVector: string;
  readonly partialStartVersionVector: string;
  readonly update: Uint8Array;
}

function queuedUpdate(
  update: Uint8Array,
  committedVersionVector: string | null,
): QueuedUpdate {
  const { partialEndVersionVector, partialStartVersionVector } =
    getImportBlobMetadata(update);
  return {
    committedVersionVector,
    partialEndVersionVector,
    partialStartVersionVector,
    update,
  };
}

export type PassOutcome =
  | "accepted"
  | ReturnType<typeof planPeerRefusalRecovery>["kind"];

/**
 * A device as the document store keeps it: the live document, its pending
 * base and its queue. A pass submits the queue and answers a refusal with
 * the recovery the SDK plans, applied the way the store's install applies it.
 */
export class QueueDevice {
  queue: QueuedUpdate[] = [];
  private freshPeer = 900;
  private pendingBase: string;

  constructor(
    public doc: TestDocument,
    private readonly userId: string,
  ) {
    this.pendingBase = encodeVersionVector(doc);
  }

  edit(text: string): void {
    append(this.doc, text);
    this.queue.push(
      queuedUpdate(exportUpdatesSince(this.doc, this.pendingBase), null),
    );
    this.pendingBase = encodeVersionVector(this.doc);
  }

  pass(server: PeerServer): PassOutcome {
    const verdict = server.submit(
      this.userId,
      this.queue.map((row) => row.update),
    );
    if (verdict.kind === "accepted") {
      this.queue = [];
      return "accepted";
    }
    this.freshPeer += 1;
    const recovery = planPeerRefusalRecovery({
      live: this.doc,
      newPeer: `${this.freshPeer}`,
      pendingBases: [this.pendingBase],
      queued: this.queue,
      refusal: verdict,
    });
    if (recovery.kind === "rebase") {
      this.doc = recovery.fork;
      this.pendingBase = encodeVersionVector(recovery.fork);
    }
    if (recovery.kind === "rebase" || recovery.kind === "relay") {
      this.queue = [
        queuedUpdate(recovery.update, recovery.committedVersionVector),
      ];
    }
    return recovery.kind;
  }

  /** Passes until one is accepted or changes nothing. */
  passes(server: PeerServer): PassOutcome[] {
    const outcomes: PassOutcome[] = [];
    for (let round = 0; round < 8; round += 1) {
      const outcome = this.pass(server);
      outcomes.push(outcome);
      if (outcome !== "rebase" && outcome !== "relay") return outcomes;
    }
    throw new Error(`recovery did not settle: ${outcomes.join(", ")}`);
  }
}

/**
 * The stale device writes "seed " and goes offline. The member's device
 * writes "aaa "; with `interleaved`, the owner's second device then writes
 * "bbb " on it and the member "ccc " on that. Both devices end holding
 * everything, all of it committed before the purge.
 */
export async function alternatingHistory(interleaved: boolean) {
  const stale = await documentOnPeer(Number(STALE_PEER));
  append(stale, "seed ");
  const member = await documentOnPeer(Number(MEMBER_PEER));
  pull(member, stale);
  append(member, "aaa ");
  const ownerDevice = await documentOnPeer(Number(OWNER_DEVICE_PEER));
  pull(ownerDevice, member);
  if (interleaved) {
    append(ownerDevice, "bbb ");
    pull(member, ownerDevice);
    append(member, "ccc ");
    pull(ownerDevice, member);
  }
  return { member, ownerDevice, stale };
}

/**
 * The stale device saw the member's first run ("aaa ") and nothing after.
 * The member's later committed runs, and the owner's second device's change
 * between them when `foreignChange` is set, are lost by a recreation from it.
 */
export async function partlySeenHistory(foreignChange: boolean) {
  const stale = await documentOnPeer(Number(STALE_PEER));
  append(stale, "seed ");
  const member = await documentOnPeer(Number(MEMBER_PEER));
  pull(member, stale);
  append(member, "aaa ");
  pull(stale, member);
  append(member, "ccc ");
  const ownerDevice = await documentOnPeer(Number(OWNER_DEVICE_PEER));
  pull(ownerDevice, member);
  if (foreignChange) {
    append(ownerDevice, "bbb ");
    pull(member, ownerDevice);
    append(member, "eee ");
  }
  return { member, ownerDevice, stale };
}
