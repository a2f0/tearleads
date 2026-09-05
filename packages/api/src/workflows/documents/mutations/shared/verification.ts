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
  DocumentCreateRequest,
  DocumentLinkSetMutationRequest,
  DocumentSyncRequest,
} from "@tearleads/validators/request";
import {
  getAccessManifestBundles,
  getCurrentAccessManifestHead,
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
import { createContainerWriterProjectionContext } from "../../../containers/writerProjection/context";
import { toManifestBundleResponse } from "../../../containers/writerProjection/records";
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
import {
  assertCurrentContainerPathRefGroups,
  assertCurrentContainerPathRefs,
} from "./currentContainerPaths";

import { assertDocumentAccessEventDependenciesMatchRequest as assertDependencies } from "./eventDependencies";
import {
  readVerifiedDocumentManifest,
  verifiedDocumentKekTargetsFromResolved,
} from "./records";

type CurrentDocumentKekTargets = Awaited<ReturnType<typeof resolveTargets>>;

export { assertCurrentContainerPathRefGroups, assertCurrentContainerPathRefs };

export async function verifyDocumentEvent(input: {
  readonly body: unknown;
  readonly executor: DatabaseTransaction;
  readonly expectedDocumentId?: string;
  readonly expectedEventType?:
    | "document.link"
    | "document.purge"
    | "document.unlink";
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

export async function verifyDocumentManifestFromRequest(input: {
  readonly event: VerifiedAccessEvent;
  readonly executor: DatabaseTransaction;
  readonly request: DocumentCreateRequest;
}): Promise<VerifiedDocumentLinkSetManifest> {
  assertDependencies(input.request, input.event.event);
  // Run sequentially because both reads share one transaction connection.
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
