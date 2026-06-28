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
  deriveContainerAccessManifest,
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
  readVerifiedContainerManifest,
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

async function assertContainerManifestBundleConsistent(
  bundle: unknown,
  label: string,
): Promise<VerifiedContainerAccessManifest> {
  const verified = readVerifiedContainerManifest(bundle, label);
  const derivedManifest = await deriveContainerAccessManifest(verified.state);
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

async function assertCurrentContainerPath(
  executor: DatabaseSession,
  bundles: readonly unknown[] | undefined,
  label: string,
): Promise<VerifiedContainerAccessManifest[] | undefined> {
  if (bundles === undefined) {
    return undefined;
  }

  const path: VerifiedContainerAccessManifest[] = [];
  for (const [index, bundle] of bundles.entries()) {
    const manifest = await assertContainerManifestBundleConsistent(
      bundle,
      `${label}[${index}]`,
    );
    path.push(manifest);
  }

  const heads = await getCurrentAccessManifestHeads(
    "container",
    path.map((manifest) => manifest.state.containerId),
    executor,
  );

  for (const [index, manifest] of path.entries()) {
    const head = heads.get(manifest.state.containerId);
    if (!head) {
      throw new DocumentMutationError(`${label}[${index}] head missing`, 404);
    }
    if (head.manifestHash !== manifest.manifestHash) {
      throw new DocumentMutationError(`${label}[${index}] is stale`, 409);
    }
  }

  return path;
}

export async function assertCurrentContainerPathGroups(
  executor: DatabaseSession,
  groups: readonly (readonly unknown[])[] | undefined,
  label: string,
): Promise<VerifiedContainerAccessManifest[][] | undefined> {
  if (groups === undefined) {
    return undefined;
  }

  const verifiedGroups: VerifiedContainerAccessManifest[][] = [];
  for (const [index, group] of groups.entries()) {
    verifiedGroups.push(
      (await assertCurrentContainerPath(
        executor,
        group,
        `${label}[${index}]`,
      )) ?? [],
    );
  }

  return verifiedGroups;
}

/**
 * Resolve {containerId, manifestHash} reference groups to verified container
 * access manifests using the server's OWN stored bundles (never client-supplied
 * bytes), with the SAME current-head pin the full-bundle path enforces. Each
 * stored bundle was verified when it was committed, and the head pin proves the
 * referenced manifest is the container's current access state.
 *
 * Resolution is batched into one bundle fetch and one head fetch for the whole
 * request rather than two roundtrips per reference.
 */
async function assertCurrentContainerPathRefGroups(
  executor: DatabaseSession,
  groups: readonly (readonly ContainerManifestRef[])[],
  label: string,
): Promise<VerifiedContainerAccessManifest[][]> {
  const flatRefs = groups.flatMap((group, groupIndex) =>
    group.map((ref, index) => ({
      ref,
      refLabel: `${label}[${groupIndex}][${index}]`,
    })),
  );

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

  const verifiedFlat = resolved.map(({ manifest, refLabel }) => {
    const head = heads.get(manifest.state.containerId);
    if (!head) {
      throw new DocumentMutationError(`${refLabel} head missing`, 404);
    }
    if (head.manifestHash !== manifest.manifestHash) {
      throw new DocumentMutationError(`${refLabel} is stale`, 409);
    }
    return manifest;
  });

  // Reshape the flat verified manifests back into the original group structure.
  const verifiedGroups: VerifiedContainerAccessManifest[][] = [];
  let cursor = 0;
  for (const group of groups) {
    verifiedGroups.push(verifiedFlat.slice(cursor, cursor + group.length));
    cursor += group.length;
  }

  return verifiedGroups;
}

export async function verifyDocumentManifestFromRequest(input: {
  readonly event: VerifiedAccessEvent;
  readonly executor: DatabaseTransaction;
  readonly request: DocumentCreateRequest;
}): Promise<VerifiedDocumentLinkSetManifest> {
  const [targetContainerPath, authorizingContainerPaths] = await Promise.all([
    assertCurrentContainerPath(
      input.executor,
      input.request.targetContainerPath,
      "targetContainerPath",
    ),
    assertCurrentContainerPathGroups(
      input.executor,
      input.request.authorizingContainerPaths,
      "authorizingContainerPaths",
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
      assertCurrentContainerPath(
        input.executor,
        input.request.targetContainerPath,
        "targetContainerPath",
      ),
      assertCurrentContainerPathGroups(
        input.executor,
        input.request.authorizingContainerPaths,
        "authorizingContainerPaths",
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
  if (!input.request.documentManifest) {
    throw new DocumentMutationError(
      "Document write authorization proof is required",
      400,
    );
  }
  if (!input.request.authorizingContainerPathRefs) {
    throw new DocumentMutationError(
      "Document write authorization paths are required",
      400,
    );
  }

  const documentManifest = await assertDocumentManifestBundleConsistent(
    input.request.documentManifest,
    "documentManifest",
  );
  if (
    documentManifest.state.documentId !== input.documentId ||
    documentManifest.manifestHash !== input.request.expectedLinkSetManifestHash
  ) {
    throw new DocumentMutationError(
      "Document write authorization manifest does not match sync request",
      409,
    );
  }

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
