import { isPlainObject } from "@tearleads/validators/isPlainObject";
import { normalizeAccessEvent } from "./accessEvent";
import type { AccessEvent } from "./accessEventTypes";
import { readKeyingCanonicalJson } from "./canonicalJsonGuard";
import { normalizeContainerAccessEventBody } from "./containerAccessBodies";
import { containerAccessStateAfterEvent } from "./containerAccessSuccessor";
import type { ContainerAccessManifestState } from "./containerAccessTypes";
import { normalizeDocumentAccessEventBody } from "./documentAccessBody";
import type { DocumentLinkSetManifestState } from "./documentAccessTypes";
import { documentLinkSetStateAfterEvent } from "./documentLinkSetSuccessor";

export type ReconstructedAccessManifestState =
  | ContainerAccessManifestState
  | DocumentLinkSetManifestState;

/** A served bundle as the wire carries it: no derived state. */
export interface ServedAccessManifestBundle {
  readonly event: unknown;
  readonly manifestHash: string;
}

interface ServedEvent {
  readonly event: AccessEvent;
  readonly body: unknown;
  readonly eventHash: string;
}

interface Predecessor<State> {
  readonly manifestHash: string;
  readonly state: State;
}

function readServedEvent(bundle: ServedAccessManifestBundle): ServedEvent {
  const eventBundle = bundle.event;
  if (!isPlainObject(eventBundle)) throw new Error("event bundle is invalid");
  const { body, event, eventHash } = eventBundle;
  if (typeof eventHash !== "string") throw new Error("eventHash is invalid");
  return { body, event: normalizeAccessEvent(event), eventHash };
}

function isContainerState(
  state: ReconstructedAccessManifestState,
): state is ContainerAccessManifestState {
  return "containerId" in state;
}

function sameKind<State extends ReconstructedAccessManifestState>(
  previous: Predecessor<ReconstructedAccessManifestState> | null,
  isKind: (state: ReconstructedAccessManifestState) => state is State,
): Predecessor<State> | null {
  if (previous === null) return null;
  const { manifestHash, state } = previous;
  if (!isKind(state)) throw new Error("predecessor is another object kind");
  return { manifestHash, state };
}

function stateAfter(
  served: ServedEvent,
  previous: Predecessor<ReconstructedAccessManifestState> | null,
): ReconstructedAccessManifestState {
  const body = readKeyingCanonicalJson(served.body, "event body");
  const common = {
    eventHash: served.eventHash,
    objectId: served.event.objectId,
    organizationId: served.event.organizationId,
  };
  if (served.event.objectKind === "container") {
    return containerAccessStateAfterEvent({
      ...common,
      body: normalizeContainerAccessEventBody(body),
      previous: sameKind(previous, isContainerState),
    });
  }
  if (served.event.objectKind === "document") {
    return documentLinkSetStateAfterEvent({
      ...common,
      body: normalizeDocumentAccessEventBody(body),
      previous: sameKind(
        previous,
        (state): state is DocumentLinkSetManifestState =>
          !isContainerState(state),
      ),
    });
  }
  throw new Error("only container and document manifests derive this state");
}

function tryRead<T>(read: () => T): T | null {
  try {
    return read();
  } catch {
    return null;
  }
}

type States = Map<string, ReconstructedAccessManifestState | null>;

interface PendingLink {
  readonly hash: string;
  readonly served: ServedEvent | null;
}

/**
 * Walks back from `start` to a state already rebuilt or to a genesis. The
 * links come newest first; `complete` says whether folding them can succeed.
 */
function walkBack(
  bundles: ReadonlyMap<string, ServedAccessManifestBundle>,
  states: States,
  start: string,
) {
  const pending: PendingLink[] = [];
  const walked = new Set<string>();
  let hash: string | null = start;
  while (hash !== null && !states.has(hash)) {
    const bundle = bundles.get(hash);
    if (!bundle || walked.has(hash)) return { pending, previous: null };
    walked.add(hash);
    const served = tryRead(() => readServedEvent(bundle));
    pending.push({ hash, served });
    if (served === null) return { pending, previous: null };
    hash = served.event.previousManifestHash;
  }
  if (hash === null) return { pending, previous: "genesis" as const };
  const state = states.get(hash) ?? null;
  return { pending, previous: state && { manifestHash: hash, state } };
}

/**
 * The derived state each served bundle commits to, rebuilt from the signed
 * bodies along its served predecessor chain: the value the API stores beside
 * the manifest. It is unverified, as the served state it replaces was, and
 * the verifier still requires it to equal the state it derives from the
 * recursively verified predecessor. A bundle whose chain is not served,
 * cycles, or does not parse gets null; verifying it fails as it always did.
 */
export function reconstructServedAccessManifestStates(
  bundles: ReadonlyMap<string, ServedAccessManifestBundle>,
): Map<string, ReconstructedAccessManifestState | null> {
  const states: States = new Map();
  for (const start of bundles.keys()) {
    const walk = walkBack(bundles, states, start);
    let previous = walk.previous === "genesis" ? null : walk.previous;
    let complete = walk.previous !== null;
    for (const { hash, served } of walk.pending.reverse()) {
      const state =
        complete && served !== null
          ? tryRead(() => stateAfter(served, previous))
          : null;
      states.set(hash, state);
      complete = state !== null;
      previous = state && { manifestHash: hash, state };
    }
  }
  return states;
}
