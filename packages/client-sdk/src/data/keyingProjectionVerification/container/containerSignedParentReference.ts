import {
  KeyingVerificationError,
  type VerifiedContainerAccessManifest,
} from "@tearleads/crypto";
import { isPlainObject } from "@tearleads/validators/isPlainObject";
import type { AccessManifestBundleWireResponse } from "@tearleads/validators/response";
import { readKeyingVerificationShape } from "../error";
import { readRecordNullableString, readRecordString } from "../readers";

export interface ContainerParentReference {
  readonly parentContainerId: string | null;
  readonly parentManifestHash: string | null;
}

type Bundles = ReadonlyMap<string, AccessManifestBundleWireResponse>;

interface SignedContainerEvent {
  readonly eventType: string;
  readonly previousManifestHash: string | null;
  readonly body: Record<string, unknown>;
}

function readRecord(value: unknown, label: string): Record<string, unknown> {
  if (!isPlainObject(value)) throw new Error(`${label} must be an object`);
  return value;
}

/** The signed fields the parent pin follows; verification checks them all. */
function readSignedContainerEvent(
  bundle: AccessManifestBundleWireResponse,
  label: string,
): SignedContainerEvent {
  return readKeyingVerificationShape(() => {
    const event = readRecord(bundle.event.event, `${label} signed event`);
    return {
      eventType: readRecordString(event, "eventType", `${label} signed event`),
      previousManifestHash: readRecordNullableString(
        event,
        "previousManifestHash",
        `${label} signed event`,
      ),
      body: readRecord(bundle.event.body, `${label} event body`),
    };
  });
}

function readBodyHead(event: SignedContainerEvent, label: string) {
  return readKeyingVerificationShape(() =>
    readRecordNullableString(
      event.body,
      "parentManifestHash",
      `${label} event body`,
    ),
  );
}

function readBodyParent(
  event: SignedContainerEvent,
  label: string,
): ContainerParentReference {
  return {
    parentContainerId: readKeyingVerificationShape(() =>
      readRecordNullableString(
        event.body,
        "parentContainerId",
        `${label} event body`,
      ),
    ),
    parentManifestHash: readBodyHead(event, label),
  };
}

function knownParent(
  state: ContainerParentReference | undefined,
): ContainerParentReference | null {
  return state
    ? {
        parentContainerId: state.parentContainerId,
        parentManifestHash: state.parentManifestHash,
      }
    : null;
}

// Each hash in one projection's bundles pins one parent, so a pass that
// resolves heads and then each of their predecessors reads each body once.
const resolvedByBundles = new WeakMap<
  Bundles,
  Map<string, ContainerParentReference>
>();

type PinInput = {
  readonly bundle: AccessManifestBundleWireResponse;
  readonly bundlesByHash: Bundles;
  readonly label: string;
  readonly verifiedByHash: ReadonlyMap<string, VerifiedContainerAccessManifest>;
};

interface PendingEvent {
  readonly hash: string;
  readonly event: SignedContainerEvent;
}

function nextBundle(
  input: PinInput,
  event: SignedContainerEvent,
  walked: ReadonlySet<string>,
): string {
  const previousHash = event.previousManifestHash;
  if (previousHash === null) {
    throw new KeyingVerificationError(
      "missing_dependency",
      `${input.label} ${event.eventType} requires the previous container manifest`,
    );
  }
  if (walked.has(previousHash)) {
    throw new KeyingVerificationError(
      "object_mismatch",
      `${input.label} refers back to a manifest whose verification it is part of`,
    );
  }
  return previousHash;
}

/**
 * Walks back to a pinned or already known parent: the base the pending
 * events, newest first, fold onto.
 */
function walkToPinnedParent(
  input: PinInput,
  known: (hash: string) => ContainerParentReference | null,
  resolved: Map<string, ContainerParentReference>,
) {
  const pending: PendingEvent[] = [];
  const walked = new Set<string>();
  let bundle = input.bundle;
  for (;;) {
    const event = readSignedContainerEvent(bundle, input.label);
    if (
      event.eventType === "container.create" ||
      event.eventType === "container.move"
    ) {
      const base = readBodyParent(event, input.label);
      resolved.set(bundle.manifestHash, base);
      return { base, pending };
    }
    pending.push({ hash: bundle.manifestHash, event });
    walked.add(bundle.manifestHash);
    const previousHash = nextBundle(input, event, walked);
    const base = known(previousHash);
    if (base) return { base, pending };
    const previous = input.bundlesByHash.get(previousHash);
    if (!previous) {
      throw new KeyingVerificationError(
        "missing_dependency",
        `${input.label} previous manifest ${previousHash} is missing`,
      );
    }
    bundle = previous;
  }
}

/**
 * The parent a container manifest pins, from signed bytes, before the
 * manifest verifies: a create or move body names the parent and its head; a
 * rekey or revoke keeps its predecessor's parent and re-cites a head in its
 * body; a grant or recitation keeps both. A predecessor this pass already
 * verified answers with its derived state, any other with its served signed
 * body. Verification derives the state from the recursively verified
 * predecessor and then requires this exact pin.
 */
export function readSignedContainerParentReference(
  input: PinInput,
): ContainerParentReference {
  const resolved =
    resolvedByBundles.get(input.bundlesByHash) ??
    new Map<string, ContainerParentReference>();
  resolvedByBundles.set(input.bundlesByHash, resolved);
  const known = (hash: string) =>
    knownParent(input.verifiedByHash.get(hash)?.state ?? resolved.get(hash));

  const head = known(input.bundle.manifestHash);
  if (head) return head;
  const walk = walkToPinnedParent(input, known, resolved);
  let reference = walk.base;
  for (const { hash, event } of walk.pending.reverse()) {
    if (
      event.eventType === "container.rekey" ||
      event.eventType === "container.revoke"
    ) {
      reference = {
        parentContainerId: reference.parentContainerId,
        parentManifestHash: readBodyHead(event, input.label),
      };
    }
    resolved.set(hash, reference);
  }
  return reference;
}

/** The parent path was resolved from the pin the derived state now proves. */
export function assertSignedContainerParentPin(
  input: PinInput,
  verified: VerifiedContainerAccessManifest,
): void {
  const pin = readSignedContainerParentReference(input);
  if (
    pin.parentContainerId !== verified.state.parentContainerId ||
    pin.parentManifestHash !== verified.state.parentManifestHash
  ) {
    throw new KeyingVerificationError(
      "object_mismatch",
      `${input.label} parent pin differs from its derived state`,
    );
  }
}
