import type {
  DocumentContentKeyTarget,
  VerifiedContainerAccessManifest,
} from "@symcrypt/crypto";
import {
  computeDocumentContentKeyTargetHash,
  KeyingVerificationError,
} from "@symcrypt/crypto";
import type { DocumentWriterProjectionResponse } from "@symcrypt/validators/response";
import { errorMessage } from "../../errorMessage";
import {
  type DocumentWriterProjectionAuthorization,
  type PrincipalPolicyCache,
  verifyDocumentWriterProjectionAuthorization,
} from "../../keyingProjectionVerification";
import { rethrowDatabaseUnavailableError } from "../../keyingProjectionVerification/error";
import type { ExecSql } from "../../sqlite/sqlSchema";
import {
  currentDocumentTargets,
  deriveDocumentTargetFromProjection,
  readLinkedContainerIdsFromDocumentManifest,
} from "./projectionTargets";
import {
  assertDocumentManifestBundleConsistent,
  normalizeDocumentKekTargetResponse,
  sortDocumentTargets,
  targetEnvelopeReference,
  targetKey,
  uniqueSortedStrings,
} from "./readers";

export { unwrapContainerKekPath } from "./containerKekPath";
export { ContainerKekHistoryUnavailableError } from "./containerKekPathHistory";
export {
  buildRotatedDocumentContentKeyBundle,
  collectContainerKeksForDocumentSync,
  DocumentContentKeyUnavailableError,
  DocumentHistoryUnavailableError,
  unwrapDocumentContentKeyFromBundle,
  unwrapDocumentContentKeyFromWriterProjection,
  unwrapDocumentContentKeyTarget,
  wrapDocumentContentKeyForCreate,
} from "./projectionContentKeys";
export {
  authorizingContainerPathRefs,
  authorizingContainerPathRefsForLinkSet,
  containerPathRefs,
  currentDocumentTargets,
  deriveDocumentCreateTargets,
  deriveDocumentTargetFromProjection,
  mergeTargetEnvelopes,
  readLinkedContainerIdsFromDocumentManifest,
} from "./projectionTargets";

import type { ProjectionVerificationOptions } from "./types";
import { resolveProjectionVerifier } from "./types";

function assertSortedStringsEqual(
  left: readonly string[],
  right: readonly string[],
  message: string,
): void {
  if (
    left.length !== right.length ||
    left.some((value, index) => value !== right[index])
  ) {
    throw new Error(message);
  }
}

function assertAuthorizingContainerPathsMatchDocumentTargets(input: {
  targets: readonly DocumentContentKeyTarget[];
  writerProjection: DocumentWriterProjectionResponse;
}): void {
  if (input.writerProjection.authorizingContainerPaths.length === 0) {
    throw new Error("Document writer projection authorization paths missing");
  }

  const targetKeys = new Set(input.targets.map(targetKey));
  for (const [
    index,
    projection,
  ] of input.writerProjection.authorizingContainerPaths.entries()) {
    let projectionTarget: DocumentContentKeyTarget;
    try {
      projectionTarget = deriveDocumentTargetFromProjection(projection);
    } catch (error) {
      throw new Error(
        `Document writer projection authorization path[${index}] is invalid: ${errorMessage(error)}`,
      );
    }

    if (targetKeys.has(targetKey(projectionTarget))) {
      continue;
    }

    // Bind server-supplied KEK paths to committed document targets before
    // using any unwrapped path KEK for document content-key material.
    throw new Error(
      `Document writer projection authorization path[${index}] is not a document target`,
    );
  }
}

async function assertProjectionContentKeyBundleConsistent(
  writerProjection: DocumentWriterProjectionResponse,
  staleContentKeyBundle: boolean,
): Promise<void> {
  const { manifestHash } = writerProjection.documentManifest;
  if (writerProjection.contentKeyBundle.linkSetManifestHash !== manifestHash) {
    // A stale bundle may lag the link-set head, but it must still descend
    // from this document's manifest chain.
    if (
      !staleContentKeyBundle ||
      !writerProjection.documentManifestHistory.some(
        (bundle) =>
          bundle.manifestHash ===
          writerProjection.contentKeyBundle.linkSetManifestHash,
      )
    ) {
      throw new Error("Document writer projection link manifest mismatch");
    }
  }

  if (!staleContentKeyBundle) {
    if (
      writerProjection.documentKekTargets.documentKeyTargetHash !==
      writerProjection.contentKeyBundle.targetHash
    ) {
      throw new Error("Document writer projection target hash mismatch");
    }
    return;
  }

  // The stale bundle cannot match the current targets; pin it to its own
  // canonical hash instead so a tampered envelope set still fails closed.
  const staleBundleTargetHash = await computeDocumentContentKeyTargetHash(
    sortDocumentTargets(
      writerProjection.contentKeyBundle.targets.map(targetEnvelopeReference),
    ),
  );
  if (staleBundleTargetHash !== writerProjection.contentKeyBundle.targetHash) {
    throw new Error(
      "Document writer projection stale bundle target hash is not canonical",
    );
  }
}

async function assertDocumentWriterProjectionConsistentInternal(
  writerProjection: DocumentWriterProjectionResponse,
  input: ProjectionVerificationOptions & {
    /**
     * Accept a projection whose content-key bundle is marked stale (wrapped
     * to superseded KEK targets after e.g. a revoke rotation). Only the
     * document sync path opts in — it can heal the bundle by re-wrapping the
     * content key. Every other consumer fails fast, preserving the behavior
     * of the former projection-level 409.
     */
    allowStaleContentKeyBundle?: boolean | undefined;
    execSql?: ExecSql | undefined;
    onVerifiedAuthorization?:
      | ((authorization: DocumentWriterProjectionAuthorization) => void)
      | undefined;
    principalPolicyCache?: PrincipalPolicyCache | undefined;
    verifiedByHash?: Map<string, VerifiedContainerAccessManifest> | undefined;
  },
): Promise<DocumentContentKeyTarget[]> {
  const resolveProjectionUserKey = resolveProjectionVerifier(
    input,
    "Document writer projection",
  );
  if (
    input.trustedLocalProjection !== true &&
    resolveProjectionUserKey !== null
  ) {
    const authorization = await verifyDocumentWriterProjectionAuthorization({
      execSql: input.execSql,
      principalPolicyCache: input.principalPolicyCache,
      projection: writerProjection,
      resolveUserKey: resolveProjectionUserKey,
      verifiedByHash: input.verifiedByHash,
      warmReferencedPrincipalPolicies: input.warmReferencedPrincipalPolicies,
    });
    input.onVerifiedAuthorization?.(authorization);
  }

  const staleContentKeyBundle = writerProjection.contentKeyBundleStale === true;
  if (staleContentKeyBundle && input.allowStaleContentKeyBundle !== true) {
    throw new Error("Document writer projection content-key bundle is stale");
  }

  const manifestIdentity = await assertDocumentManifestBundleConsistent({
    bundle: writerProjection.documentManifest,
    label: "Document writer projection manifest",
  });
  const { documentId } = manifestIdentity;
  if (
    writerProjection.documentId !== documentId ||
    writerProjection.documentKekTargets.documentId !== documentId ||
    writerProjection.contentKeyBundle.documentId !== documentId
  ) {
    throw new Error("Document writer projection document id mismatch");
  }
  if (
    writerProjection.documentKekTargets.linkSetManifestHash !==
    writerProjection.documentManifest.manifestHash
  ) {
    throw new Error("Document writer projection link manifest mismatch");
  }
  await assertProjectionContentKeyBundleConsistent(
    writerProjection,
    staleContentKeyBundle,
  );

  const targets = staleContentKeyBundle
    ? normalizeDocumentKekTargetResponse(writerProjection.documentKekTargets)
    : currentDocumentTargets(writerProjection);
  const canonicalTargetHash =
    await computeDocumentContentKeyTargetHash(targets);
  if (
    canonicalTargetHash !==
    writerProjection.documentKekTargets.documentKeyTargetHash
  ) {
    throw new Error("Document writer projection target hash is not canonical");
  }

  assertSortedStringsEqual(
    uniqueSortedStrings(targets.map((target) => target.containerId)),
    readLinkedContainerIdsFromDocumentManifest(writerProjection),
    "Document writer projection targets do not match linked containers",
  );
  assertSortedStringsEqual(
    uniqueSortedStrings(
      writerProjection.documentKekTargets.linkedContainerManifestHashes,
    ),
    uniqueSortedStrings(targets.map((target) => target.containerManifestHash)),
    "Document writer projection target manifest summary mismatch",
  );
  assertSortedStringsEqual(
    uniqueSortedStrings(
      writerProjection.documentKekTargets.linkedContainerKeyEpochIds,
    ),
    uniqueSortedStrings(targets.map((target) => target.containerKeyEpochId)),
    "Document writer projection target KEK summary mismatch",
  );
  assertAuthorizingContainerPathsMatchDocumentTargets({
    targets,
    writerProjection,
  });

  return targets;
}

export async function assertDocumentWriterProjectionConsistent(
  ...input: Parameters<typeof assertDocumentWriterProjectionConsistentInternal>
): ReturnType<typeof assertDocumentWriterProjectionConsistentInternal> {
  try {
    return await assertDocumentWriterProjectionConsistentInternal(...input);
  } catch (error) {
    rethrowDatabaseUnavailableError(error);
    if (error instanceof KeyingVerificationError) {
      throw error;
    }
    throw new KeyingVerificationError("invalid_shape", errorMessage(error));
  }
}
