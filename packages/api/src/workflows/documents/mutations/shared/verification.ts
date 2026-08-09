import type {
  DatabaseSession,
  DatabaseTransaction,
} from "@tearleads/api-shared/postgres";
import type {
  VerifiedAccessEvent,
  VerifiedContainerAccessManifest,
  VerifiedDocumentLinkSetManifest,
  VerifiedPrincipalPolicy,
} from "@tearleads/crypto";
import {
  computeAccessManifestHash,
  deriveDocumentLinkSetManifest,
  verifyDocumentLinkSetManifest,
  verifySignedAccessEvent,
} from "@tearleads/crypto";
import type {
  ContainerManifestRef,
  DocumentCreateRequest,
  DocumentLinkSetMutationRequest,
  DocumentSyncRequest,
} from "@tearleads/validators/request";
import {
  getAccessManifestBundles,
  getCurrentAccessManifestHead,
  getCurrentAccessManifestHeads,
} from "../../../../access/read/accessManifestStore";
import type { resolveCurrentDocumentKekTargets as resolveTargets } from "../../../../access/read/documentKekTargets";
import {
  readProjectionAccessEvent,
  readProjectionAccessManifest,
} from "../../../../keyingProjectionRecords";
import {
  canonicalJsonEquals,
  readKeyingCanonicalJson,
} from "../../../../utils/canonicalJson";
import { loadContainerManifestBundleByHash } from "../../../containers/writerProjection/accessPaths";
import { createContainerWriterProjectionContext } from "../../../containers/writerProjection/context";
import { toManifestBundleResponse } from "../../../containers/writerProjection/records";
import { verifyStoredContainerManifest } from "../../../containers/writerProjection/storedManifestVerification";
import { ContainerWriterProjectionError } from "../../../containers/writerProjection/types";
import { loadPrincipalPoliciesForContainerPaths } from "../../../principals/principalPolicyProjection";
import { loadSignerPublicKey } from "../../../signerPublicKey";
import {
  StoredDocumentManifestError,
  verifyStoredDocumentManifest,
} from "../../storedDocumentManifestVerification";
import {
  DocumentMutationError,
  documentShapeError,
  documentSyncStateStale,
} from "../errors";
import type { DocumentWriteAuthorizationProof } from "../types";
import { assertDocumentAccessEventDependenciesMatchRequest as assertDependencies } from "./eventDependencies";
import {
  readVerifiedDocumentManifest,
  verifiedDocumentKekTargetsFromResolved,
} from "./records";

type CurrentDocumentKekTargets = Awaited<ReturnType<typeof resolveTargets>>;

export async function verifyDocumentEvent(input: {
  readonly body: unknown;
  readonly executor: DatabaseTransaction;
  readonly expectedDocumentId?: string;
  readonly expectedEventType?: "document.link" | "document.unlink";
  readonly event: Record<string, unknown>;
  readonly fingerprint: string;
  readonly userId: string;
}): Promise<VerifiedAccessEvent> {
  const event = readProjectionAccessEvent(
    input.event,
    "Document event",
    documentShapeError,
  );

  if (
    event.signerUserId !== input.userId ||
    event.signerKeyFingerprint !== input.fingerprint
  ) {
    throw new DocumentMutationError("Forbidden", 403);
  }

  if (
    input.expectedEventType !== undefined &&
    event.eventType !== input.expectedEventType
  ) {
    throw new DocumentMutationError("Unexpected document event type", 400);
  }

  if (
    input.expectedDocumentId !== undefined &&
    event.objectId !== input.expectedDocumentId
  ) {
    throw new DocumentMutationError("Document id mismatch", 400);
  }

  const verifiedEvent = await verifySignedAccessEvent({
    body: readKeyingCanonicalJson(input.body, "Document access event body"),
    event,
    signerPublicKey: await loadSignerPublicKey(input.executor, {
      ...input,
      error: (message, status) => new DocumentMutationError(message, status),
    }),
  });

  if (!verifiedEvent.ok) {
    throw verifiedEvent.error;
  }

  return verifiedEvent.value;
}

async function assertDocumentManifestBundleConsistent(
  bundle: unknown,
  label: string,
): Promise<VerifiedDocumentLinkSetManifest> {
  const verified = readVerifiedDocumentManifest(bundle, label);
  const derivedManifest = await deriveDocumentLinkSetManifest(verified.state);
  const derivedManifestHash = await computeAccessManifestHash(derivedManifest);
  const suppliedManifestHash = await computeAccessManifestHash(
    verified.manifest,
  );

  if (
    verified.manifestHash !== derivedManifestHash ||
    verified.manifestHash !== suppliedManifestHash ||
    !canonicalJsonEquals(derivedManifest, verified.manifest)
  ) {
    throw new DocumentMutationError(
      `${label} manifest bundle is not self-consistent`,
      409,
    );
  }

  return verified;
}

/**
 * Resolve a flat list of {containerId, manifestHash} references to verified
 * container access manifests using the server's own stored bundles (never
 * client-supplied bytes), with the same current-head pin the full-bundle path
 * enforces. Stored bytes are re-verified here because database contents are not
 * a trust boundary.
 *
 * Resolution is batched into one bundle fetch and one head fetch for the whole
 * request rather than two roundtrips per reference. Order is preserved.
 */
async function resolveCurrentContainerManifestRefs(
  executor: DatabaseSession,
  flatRefs: readonly {
    readonly ref: ContainerManifestRef;
    readonly refLabel: string;
  }[],
): Promise<VerifiedContainerAccessManifest[]> {
  // Resolve every referenced manifest from storage in one batch.
  const storedBundles = await getAccessManifestBundles(
    flatRefs.map(({ ref }) => ref.manifestHash),
    executor,
  );

  const context = createContainerWriterProjectionContext(executor);
  const resolved = await Promise.all(
    flatRefs.map(async ({ ref, refLabel }) => {
      const stored = storedBundles.get(ref.manifestHash);
      if (!stored || stored.manifest.objectKind !== "container") {
        // 409, not 404 — a document-route 404 is the client's wipe signal.
        throw new DocumentMutationError(`${refLabel} head missing`, 409);
      }

      let manifest: VerifiedContainerAccessManifest;
      try {
        manifest = await verifyStoredContainerManifest({
          bundle: toManifestBundleResponse(stored),
          context,
          loadBundle: (manifestHash) =>
            loadContainerManifestBundleByHash(context, manifestHash),
        });
      } catch (error) {
        if (error instanceof ContainerWriterProjectionError) {
          throw new DocumentMutationError(error.message, 409);
        }
        throw error;
      }

      // The client-supplied containerId is advisory; the head lookup below is
      // keyed off the resolved bundle's authoritative containerId. Reject a
      // mismatch first so a confused reference cannot authorize against a
      // different container.
      if (ref.containerId !== manifest.state.containerId) {
        throw new DocumentMutationError(
          `${refLabel} container id does not match the referenced manifest`,
          400,
        );
      }

      return { manifest, refLabel };
    }),
  );

  // Freshness pin — identical in strength to the full-bundle path
  // (assertCurrentContainerPath). Without it a writer could replay a
  // stale-but-stored manifest hash from an epoch in which they held
  // since-revoked access (privilege escalation). Batched into one head fetch.
  const heads = await getCurrentAccessManifestHeads(
    "container",
    resolved.map(({ manifest }) => manifest.state.containerId),
    executor,
  );

  return resolved.map(({ manifest, refLabel }) => {
    const head = heads.get(manifest.state.containerId);
    if (!head) {
      throw new DocumentMutationError(`${refLabel} head missing`, 409);
    }
    if (head.manifestHash !== manifest.manifestHash) {
      throw documentSyncStateStale(`${refLabel} is stale`);
    }
    return manifest;
  });
}

/**
 * Resolve groups of container manifest references (an authorizing-paths set).
 */
export async function assertCurrentContainerPathRefGroups(
  executor: DatabaseSession,
  groups: readonly (readonly ContainerManifestRef[])[] | undefined,
  label: string,
): Promise<VerifiedContainerAccessManifest[][] | undefined> {
  if (groups === undefined) {
    return undefined;
  }

  const flatRefs = groups.flatMap((group, groupIndex) =>
    group.map((ref, index) => ({
      ref,
      refLabel: `${label}[${groupIndex}][${index}]`,
    })),
  );

  const verifiedFlat = await resolveCurrentContainerManifestRefs(
    executor,
    flatRefs,
  );

  // Reshape the flat verified manifests back into the original group structure.
  const verifiedGroups: VerifiedContainerAccessManifest[][] = [];
  let cursor = 0;
  for (const group of groups) {
    verifiedGroups.push(verifiedFlat.slice(cursor, cursor + group.length));
    cursor += group.length;
  }

  return verifiedGroups;
}

/**
 * Single-path variant of assertCurrentContainerPathRefGroups (same store
 * resolution, containerId check, and head pin) for endpoints whose authorizing
 * path is a single container chain, e.g. a create/link-set targetContainerPath.
 */
async function assertCurrentContainerPathRefs(
  executor: DatabaseSession,
  refs: readonly ContainerManifestRef[] | undefined,
  label: string,
): Promise<VerifiedContainerAccessManifest[] | undefined> {
  if (refs === undefined) {
    return undefined;
  }
  return resolveCurrentContainerManifestRefs(
    executor,
    refs.map((ref, index) => ({ ref, refLabel: `${label}[${index}]` })),
  );
}

export async function verifyDocumentManifestFromRequest(input: {
  readonly event: VerifiedAccessEvent;
  readonly executor: DatabaseTransaction;
  readonly request: DocumentCreateRequest;
}): Promise<VerifiedDocumentLinkSetManifest> {
  assertDependencies(input.request, input.event.event);
  // Run sequentially: this verification runs inside a transaction, so both
  // reads share one pinned connection. Concurrent issue only trips pg's
  // already-executing-query deprecation without buying any parallelism.
  const targetContainerPath = await assertCurrentContainerPathRefs(
    input.executor,
    input.request.targetContainerPathRefs,
    "targetContainerPathRefs",
  );
  const authorizingContainerPaths = await assertCurrentContainerPathRefGroups(
    input.executor,
    input.request.authorizingContainerPathRefs,
    "authorizingContainerPathRefs",
  );
  const principalPolicies = await loadPrincipalPoliciesForContainerPaths(
    input.executor,
    [
      ...(targetContainerPath ? [targetContainerPath] : []),
      ...(authorizingContainerPaths ?? []),
    ],
  );
  const result = await verifyDocumentLinkSetManifest({
    event: input.event,
    expectedManifestHash: input.request.expectedManifestHash,
    manifest: readProjectionAccessManifest(
      input.request.manifest,
      "Document manifest",
      documentShapeError,
    ),
    previousManifest:
      input.request.previousManifest === undefined ||
      input.request.previousManifest === null
        ? null
        : await assertDocumentManifestBundleConsistent(
            input.request.previousManifest,
            "previousManifest",
          ),
    principalPolicies,
    ...(targetContainerPath !== undefined ? { targetContainerPath } : {}),
    ...(authorizingContainerPaths !== undefined
      ? { authorizingContainerPaths }
      : {}),
  });

  if (!result.ok) {
    throw result.error;
  }

  return result.value;
}

interface VerifiedDocumentLinkSetMutationAuthorization {
  readonly authorizingContainerPaths: readonly (readonly VerifiedContainerAccessManifest[])[];
  readonly manifest: VerifiedDocumentLinkSetManifest;
  readonly principalPolicies: readonly VerifiedPrincipalPolicy[];
}

export async function verifyDocumentLinkSetMutationAuthorizationFromRequest(input: {
  readonly event: VerifiedAccessEvent;
  readonly executor: DatabaseTransaction;
  readonly previousManifest: VerifiedDocumentLinkSetManifest;
  readonly request: DocumentLinkSetMutationRequest;
}): Promise<VerifiedDocumentLinkSetMutationAuthorization> {
  assertDependencies(input.request, input.event.event);
  // Run sequentially: this verification runs inside a transaction, so both
  // reads share one pinned connection. Concurrent issue only trips pg's
  // already-executing-query deprecation without buying any parallelism.
  const targetContainerPath = await assertCurrentContainerPathRefs(
    input.executor,
    input.request.targetContainerPathRefs,
    "targetContainerPathRefs",
  );
  const authorizingContainerPaths = await assertCurrentContainerPathRefGroups(
    input.executor,
    input.request.authorizingContainerPathRefs,
    "authorizingContainerPathRefs",
  );
  const principalPolicies = await loadPrincipalPoliciesForContainerPaths(
    input.executor,
    [
      ...(targetContainerPath ? [targetContainerPath] : []),
      ...(authorizingContainerPaths ?? []),
    ],
  );
  const result = await verifyDocumentLinkSetManifest({
    event: input.event,
    expectedManifestHash: input.request.expectedManifestHash,
    manifest: readProjectionAccessManifest(
      input.request.manifest,
      "Document manifest",
      documentShapeError,
    ),
    previousManifest: input.previousManifest,
    principalPolicies,
    ...(targetContainerPath !== undefined ? { targetContainerPath } : {}),
    ...(authorizingContainerPaths !== undefined
      ? { authorizingContainerPaths }
      : {}),
  });

  if (!result.ok) {
    throw result.error;
  }

  return {
    authorizingContainerPaths: authorizingContainerPaths ?? [],
    manifest: result.value,
    principalPolicies,
  };
}

/** Resolve and re-verify a stored link-set; a miss is store corruption. */
async function resolveStoredDocumentManifest(
  manifestHash: string,
  executor: DatabaseSession,
): Promise<VerifiedDocumentLinkSetManifest> {
  const stored = (await getAccessManifestBundles([manifestHash], executor)).get(
    manifestHash,
  );
  if (!stored || stored.manifest.objectKind !== "document") {
    throw new Error(
      `Document link-set manifest ${manifestHash} is missing from the access manifest store`,
    );
  }
  try {
    return await verifyStoredDocumentManifest({
      bundle: toManifestBundleResponse(stored),
      containerContext: createContainerWriterProjectionContext(executor),
    });
  } catch (error) {
    if (error instanceof StoredDocumentManifestError) {
      throw new DocumentMutationError(error.message, 409);
    }
    throw error;
  }
}

/**
 * Resolve a document's CURRENT link-set manifest (its head) from the store. The
 * writer no longer echoes the signed bundle back; freshness is enforced by the
 * signed event / write-header the caller verifies against this manifest's hash —
 * a stale client signed against a superseded head is rejected there (link-set:
 * event.previousManifestHash; blob: write-header accessManifestHash).
 */
export async function loadCurrentDocumentManifest(
  documentId: string,
  executor: DatabaseSession,
): Promise<VerifiedDocumentLinkSetManifest> {
  const head = await getCurrentAccessManifestHead(
    "document",
    documentId,
    executor,
  );
  if (!head) {
    throw new DocumentMutationError("Document manifest head missing", 404);
  }
  return resolveStoredDocumentManifest(head.manifestHash, executor);
}

/**
 * Sync-path variant: the current head hash is already in currentTargets, and the
 * client supplies expectedLinkSetManifestHash which must equal it (409 stale) as
 * an explicit optimistic-concurrency pin, the same one the content-key path uses.
 */
async function resolveCurrentDocumentManifestForWrite(input: {
  readonly currentTargets: CurrentDocumentKekTargets;
  readonly executor: DatabaseTransaction;
  readonly request: DocumentSyncRequest;
}): Promise<VerifiedDocumentLinkSetManifest> {
  const headManifestHash = input.currentTargets.linkSetManifestHash;
  if (input.request.expectedLinkSetManifestHash !== headManifestHash) {
    throw documentSyncStateStale("Document link-set manifest hash is stale");
  }
  return resolveStoredDocumentManifest(headManifestHash, input.executor);
}

export async function verifySyncWriteAuthorizationProof(input: {
  readonly currentTargets: CurrentDocumentKekTargets;
  readonly documentId: string;
  readonly executor: DatabaseTransaction;
  readonly request: DocumentSyncRequest;
}): Promise<DocumentWriteAuthorizationProof | null> {
  if (input.request.outgoingUpdates.length === 0) {
    return null;
  }
  if (!input.request.authorizingContainerPathRefs) {
    throw new DocumentMutationError(
      "Document write authorization paths are required",
      400,
    );
  }

  const documentManifest = await resolveCurrentDocumentManifestForWrite(input);

  const authorizingContainerPaths = await assertCurrentContainerPathRefGroups(
    input.executor,
    input.request.authorizingContainerPathRefs,
    "authorizingContainerPathRefs",
  );
  if (!authorizingContainerPaths || authorizingContainerPaths.length === 0) {
    throw new DocumentMutationError(
      "Document write authorization paths are required",
      400,
    );
  }
  const principalPolicies = await loadPrincipalPoliciesForContainerPaths(
    input.executor,
    authorizingContainerPaths,
  );

  return {
    authorizingContainerPaths,
    documentKekTargets: verifiedDocumentKekTargetsFromResolved(
      input.currentTargets,
    ),
    documentManifest,
    principalPolicies,
  };
}
