import type {
  DatabaseSession,
  DatabaseTransaction,
} from "@tearleads/api-shared/postgres";
import { users } from "@tearleads/api-shared/schema";
import type {
  VerifiedAccessEvent,
  VerifiedContainerAccessManifest,
  VerifiedDocumentLinkSetManifest,
} from "@tearleads/crypto";
import {
  computeAccessManifestHash,
  deriveDocumentLinkSetManifest,
  verifyDocumentLinkSetManifest,
  verifySignedAccessEvent,
} from "@tearleads/crypto";
import { base64ToBytes } from "@tearleads/encoding";
import type {
  ContainerManifestRef,
  DocumentCreateRequest,
  DocumentLinkSetMutationRequest,
  DocumentSyncRequest,
} from "@tearleads/validators/request";
import { eq } from "drizzle-orm";
import {
  getAccessManifestBundles,
  getCurrentAccessManifestHeads,
} from "../../../../access/read/accessManifestStore";
import type { resolveCurrentDocumentKekTargets } from "../../../../access/read/documentKekTargets";
import {
  readProjectionAccessEvent,
  readProjectionAccessManifest,
} from "../../../../keyingProjectionRecords";
import {
  canonicalJsonEquals,
  readKeyingCanonicalJson,
} from "../../../../utils/canonicalJson";
import {
  toManifestBundleResponse,
  toVerifiedContainerManifest,
} from "../../../containers/writerProjection/records";
import { loadPrincipalPoliciesForContainerPaths } from "../../../principals/principalPolicyProjection";
import { DocumentMutationError, documentShapeError } from "../errors";
import type { DocumentWriteAuthorizationProof } from "../types";
import {
  readVerifiedDocumentManifest,
  verifiedDocumentKekTargetsFromResolved,
} from "./records";

export async function loadSignerPublicKey(
  executor: DatabaseSession,
  input: {
    readonly fingerprint: string;
    readonly userId: string;
  },
): Promise<Uint8Array> {
  const [user] = await executor
    .select({
      fingerprint: users.fingerprint,
      signingPublicKey: users.signingPublicKey,
    })
    .from(users)
    .where(eq(users.id, input.userId))
    .limit(1);

  if (!user || user.fingerprint !== input.fingerprint) {
    throw new DocumentMutationError("Forbidden", 403);
  }

  return base64ToBytes(user.signingPublicKey);
}

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
    signerPublicKey: await loadSignerPublicKey(input.executor, input),
  });

  if (!verifiedEvent.ok) {
    throw verifiedEvent.error;
  }

  return verifiedEvent.value;
}

export async function assertDocumentManifestBundleConsistent(
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
 * container access manifests using the server's OWN stored bundles (never
 * client-supplied bytes), with the SAME current-head pin the full-bundle path
 * enforces. Each stored bundle was verified when it was committed, and the head
 * pin proves the referenced manifest is the container's current access state.
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
  // Resolve every referenced manifest from the trusted store in one batch.
  const storedBundles = await getAccessManifestBundles(
    flatRefs.map(({ ref }) => ref.manifestHash),
    executor,
  );

  const resolved = flatRefs.map(({ ref, refLabel }) => {
    const stored = storedBundles.get(ref.manifestHash);
    if (!stored || stored.manifest.objectKind !== "container") {
      throw new DocumentMutationError(`${refLabel} head missing`, 404);
    }

    // Build the verified manifest from the trusted store via the same
    // conversion the writer projection uses for stored bundles.
    const manifest = toVerifiedContainerManifest(
      toManifestBundleResponse(stored),
    );

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
  });

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
      throw new DocumentMutationError(`${refLabel} head missing`, 404);
    }
    if (head.manifestHash !== manifest.manifestHash) {
      throw new DocumentMutationError(`${refLabel} is stale`, 409);
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
  const [targetContainerPath, authorizingContainerPaths] = await Promise.all([
    assertCurrentContainerPathRefs(
      input.executor,
      input.request.targetContainerPathRefs,
      "targetContainerPathRefs",
    ),
    assertCurrentContainerPathRefGroups(
      input.executor,
      input.request.authorizingContainerPathRefs,
      "authorizingContainerPathRefs",
    ),
  ]);
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

export async function verifyDocumentLinkSetMutationManifestFromRequest(input: {
  readonly event: VerifiedAccessEvent;
  readonly executor: DatabaseTransaction;
  readonly request: DocumentLinkSetMutationRequest;
}): Promise<VerifiedDocumentLinkSetManifest> {
  const [targetContainerPath, authorizingContainerPaths, previousManifest] =
    await Promise.all([
      assertCurrentContainerPathRefs(
        input.executor,
        input.request.targetContainerPathRefs,
        "targetContainerPathRefs",
      ),
      assertCurrentContainerPathRefGroups(
        input.executor,
        input.request.authorizingContainerPathRefs,
        "authorizingContainerPathRefs",
      ),
      assertDocumentManifestBundleConsistent(
        input.request.previousManifest,
        "previousManifest",
      ),
    ]);
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
    previousManifest,
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

/**
 * Resolve the document's CURRENT link-set manifest from the server's own store —
 * the writer no longer echoes the signed bundle back. The client identifies it by
 * expectedLinkSetManifestHash, which must equal the document's current link-set
 * head; currentTargets.linkSetManifestHash IS that head (resolved from the stored
 * document head), so a mismatch is a stale write (409) — the same
 * optimistic-concurrency pin the content-key path enforces. The resolved manifest
 * is therefore always the current head, built from trusted stored bytes, and
 * feeds the same downstream authorization the client bundle used to.
 */
async function resolveCurrentDocumentManifestForWrite(input: {
  readonly currentTargets: Awaited<
    ReturnType<typeof resolveCurrentDocumentKekTargets>
  >;
  readonly documentId: string;
  readonly executor: DatabaseTransaction;
  readonly request: DocumentSyncRequest;
}): Promise<VerifiedDocumentLinkSetManifest> {
  const headManifestHash = input.currentTargets.linkSetManifestHash;
  if (input.request.expectedLinkSetManifestHash !== headManifestHash) {
    throw new DocumentMutationError(
      "Document link-set manifest hash is stale",
      409,
    );
  }

  const stored = (
    await getAccessManifestBundles([headManifestHash], input.executor)
  ).get(headManifestHash);
  if (!stored || stored.manifest.objectKind !== "document") {
    // The head is referenced by the resolved current targets, so it must exist
    // as a document manifest; a miss here is store corruption, not a client error.
    throw new Error(
      `Document ${input.documentId} link-set head ${headManifestHash} is missing from the access manifest store`,
    );
  }

  return readVerifiedDocumentManifest(
    toManifestBundleResponse(stored),
    "documentManifest",
  );
}

export async function verifySyncWriteAuthorizationProof(input: {
  readonly currentTargets: Awaited<
    ReturnType<typeof resolveCurrentDocumentKekTargets>
  >;
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
