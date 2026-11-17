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

/**
 * The most grant, principal-head and linked-container entries one
 * reconstruction materializes across all its states. Each state repeats its
 * predecessor's lists, so a linear response could otherwise force quadratic
 * client memory before any signature is checked. The served state carried
 * every one of these entries on the wire, at least 80 bytes each, so a
 * projection near this bound was already beyond what a response could carry.
 */
export const MAX_RECONSTRUCTED_STATE_ENTRIES = 1 << 20;

interface ServedEvent {
  readonly event: AccessEvent;
  readonly body: unknown;
  readonly eventHash: string;
}

interface Predecessor {
  readonly manifestHash: string;
  readonly state: ReconstructedAccessManifestState;
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

function stateObjectId(state: ReconstructedAccessManifestState): string {
  return isContainerState(state) ? state.containerId : state.documentId;
}

/** A successor names its predecessor's object, organization and kind. */
function assertSamePredecessorObject(
  event: AccessEvent,
  previous: Predecessor | null,
): void {
  if (
    previous !== null &&
    (stateObjectId(previous.state) !== event.objectId ||
      previous.state.organizationId !== event.organizationId ||
      isContainerState(previous.state) !== (event.objectKind === "container"))
  ) {
    throw new Error("predecessor names another object");
  }
}

function stateAfter(
  served: ServedEvent,
  previous: Predecessor | null,
): ReconstructedAccessManifestState {
  assertSamePredecessorObject(served.event, previous);
  const body = readKeyingCanonicalJson(served.body, "event body");
  const common = {
    eventHash: served.eventHash,
    objectId: served.event.objectId,
    organizationId: served.event.organizationId,
  };
  const eventType = served.event.eventType;
  if (served.event.objectKind === "container") {
    const containerBody = normalizeContainerAccessEventBody(body);
    if (containerBody.eventType !== eventType)
      throw new Error("body names another event type");
    return containerAccessStateAfterEvent({
      ...common,
      body: containerBody,
      previous:
        previous && isContainerState(previous.state)
          ? { manifestHash: previous.manifestHash, state: previous.state }
          : null,
    });
  }
  if (served.event.objectKind === "document") {
    const documentBody = normalizeDocumentAccessEventBody(body);
    if (documentBody.eventType !== eventType)
      throw new Error("body names another event type");
    return documentLinkSetStateAfterEvent({
      ...common,
      body: documentBody,
      previous:
        previous && !isContainerState(previous.state)
          ? { manifestHash: previous.manifestHash, state: previous.state }
          : null,
    });
  }
  throw new Error("only container and document manifests derive this state");
}

function stateEntries(state: ReconstructedAccessManifestState): number {
  return isContainerState(state)
    ? state.directGrants.length + state.referencedPrincipalHeads.length
    : state.linkedContainerIds.length;
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

/** Where a walk back from a bundle ended, and so what the fold starts from. */
type FoldBase =
  | { readonly kind: "genesis" }
  | { readonly kind: "predecessor"; readonly previous: Predecessor }
  | { readonly kind: "broken" };

/**
 * Walks back from `start` to a genesis or a state already rebuilt; the links
 * come newest first. A missing, repeated or unreadable link breaks the walk.
 */
function walkBack(
  bundles: ReadonlyMap<string, ServedAccessManifestBundle>,
  states: States,
  start: string,
): { readonly base: FoldBase; readonly pending: PendingLink[] } {
  const pending: PendingLink[] = [];
  const walked = new Set<string>();
  let hash: string | null = start;
  while (hash !== null && !states.has(hash)) {
    const bundle = bundles.get(hash);
    if (!bundle || walked.has(hash))
      return { base: { kind: "broken" }, pending };
    walked.add(hash);
    const served = tryRead(() => readServedEvent(bundle));
    pending.push({ hash, served });
    if (served === null) return { base: { kind: "broken" }, pending };
    hash = served.event.previousManifestHash;
  }
  if (hash === null) return { base: { kind: "genesis" }, pending };
  const state = states.get(hash) ?? null;
  return {
    base: state
      ? { kind: "predecessor", previous: { manifestHash: hash, state } }
      : { kind: "broken" },
    pending,
  };
}

/** The state a link folds to from its base, or null when it cannot. */
function foldLink(
  base: FoldBase,
  served: ServedEvent | null,
): ReconstructedAccessManifestState | null {
  if (base.kind === "broken" || served === null) return null;
  const previous = base.kind === "predecessor" ? base.previous : null;
  return tryRead(() => stateAfter(served, previous));
}

/**
 * The derived state each served bundle commits to, rebuilt from the signed
 * bodies along its served predecessor chain: the value the API stores beside
 * the manifest. It is unverified, as the served state it replaces was, and
 * the verifier still requires it to equal the state it derives from the
 * recursively verified predecessor. A bundle whose chain is not served,
 * cycles, names another object, does not parse, or would pass the entry
 * budget gets null.
 */
export function reconstructServedAccessManifestStates(
  bundles: ReadonlyMap<string, ServedAccessManifestBundle>,
): Map<string, ReconstructedAccessManifestState | null> {
  const states: States = new Map();
  let entries = 0;
  for (const start of bundles.keys()) {
    const walk = walkBack(bundles, states, start);
    let base = walk.base;
    for (const { hash, served } of walk.pending.reverse()) {
      const state = foldLink(base, served);
      entries += state ? stateEntries(state) : 0;
      const kept = entries <= MAX_RECONSTRUCTED_STATE_ENTRIES ? state : null;
      states.set(hash, kept);
      base = kept
        ? { kind: "predecessor", previous: { manifestHash: hash, state: kept } }
        : { kind: "broken" };
    }
  }
  return states;
}
