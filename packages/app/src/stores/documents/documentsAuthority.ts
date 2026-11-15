import type { DocumentsRuntime, Tearleads } from "@tearleads/client-sdk";
import { useTearleads } from "../../providers/sdk/TearleadsProvider";
import { useTearleadsExternalValue } from "../../providers/sdk/useTearleadsSubscription";

/**
 * The documents authority: the domain, database, principal and keys that
 * local document work is admitted under. The SDK bumps `runtime.version` on
 * every notification (realtime events, connect attempts, network, sync mode,
 * billing); only a change to these fields revokes captured work.
 */
export interface DocumentsAuthoritySnapshot {
  readonly state: Pick<DocumentsRuntime["state"], "domainScope">;
  readonly infra: Pick<DocumentsRuntime["infra"], "dbStatus" | "execSql">;
  readonly auth: Pick<
    DocumentsRuntime["auth"],
    "isAuthenticated" | "organizationId" | "userId"
  >;
  readonly crypto: Pick<
    DocumentsRuntime["crypto"],
    "encapsulationKeyPair" | "signingFingerprint" | "signingKeyPair"
  >;
}

/** Field equality only; it cannot tell A from A after A -> B -> A. */
export function sameDocumentsAuthority(
  left: DocumentsAuthoritySnapshot,
  right: DocumentsAuthoritySnapshot,
): boolean {
  return (
    left.state.domainScope === right.state.domainScope &&
    left.infra.execSql === right.infra.execSql &&
    left.infra.dbStatus === right.infra.dbStatus &&
    left.auth.userId === right.auth.userId &&
    left.auth.organizationId === right.auth.organizationId &&
    left.auth.isAuthenticated === right.auth.isAuthenticated &&
    left.crypto.signingFingerprint === right.crypto.signingFingerprint &&
    left.crypto.signingKeyPair === right.crypto.signingKeyPair &&
    left.crypto.encapsulationKeyPair === right.crypto.encapsulationKeyPair
  );
}

interface DocumentsAuthorityTracker {
  generation: number;
  snapshot: DocumentsAuthoritySnapshot;
}

const trackers = new WeakMap<Tearleads, DocumentsAuthorityTracker>();

function reconcile(sdk: Tearleads, tracker: DocumentsAuthorityTracker): number {
  const snapshot = sdk.runtime.input(null);
  if (!sameDocumentsAuthority(tracker.snapshot, snapshot)) {
    tracker.snapshot = snapshot;
    tracker.generation += 1;
  }
  return tracker.generation;
}

/**
 * Advances only when the documents authority changes. Every notification is
 * reconciled, so A -> B -> A still yields a new generation; reads reconcile
 * too, covering a change the SDK has applied but not yet announced.
 */
export function documentsAuthorityGeneration(sdk: Tearleads): number {
  const tracker = trackers.get(sdk);
  if (tracker) return reconcile(sdk, tracker);
  const created = { generation: 0, snapshot: sdk.runtime.input(null) };
  trackers.set(sdk, created);
  sdk.runtime.subscribe(() => reconcile(sdk, created));
  return created.generation;
}

export function isDocumentsAuthorityCurrent(
  sdk: Tearleads,
  generation: number,
): boolean {
  return documentsAuthorityGeneration(sdk) === generation;
}

/** Admits async work only while the authority it started under remains. */
export function captureDocumentsAuthority(sdk: Tearleads): () => boolean {
  const generation = documentsAuthorityGeneration(sdk);
  return () => isDocumentsAuthorityCurrent(sdk, generation);
}

/** A memo key that, unlike the runtime snapshot, survives notifications
 * which leave the documents authority unchanged. */
export function useDocumentsAuthorityGeneration(): number {
  const sdk = useTearleads();
  return useTearleadsExternalValue(sdk.runtime.subscribe, () =>
    documentsAuthorityGeneration(sdk),
  );
}
