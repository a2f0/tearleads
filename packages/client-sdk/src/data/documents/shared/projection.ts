import type {
  DocumentContentKeyTarget,
  VerifiedContainerAccessManifest,
} from "@tearleads/crypto";
import { computeDocumentContentKeyTargetHash } from "@tearleads/crypto";
import type { DocumentWriterProjectionResponse } from "@tearleads/validators/response";
import {
  type PrincipalPolicyCache,
  verifyDocumentWriterProjection,
} from "../../keyingProjectionVerification";
import type { ExecSql } from "../../sqlite/sqlSchema";
import {
  currentDocumentTargets,
  deriveDocumentTargetFromProjection,
  readLinkedContainerIdsFromDocumentManifest,
} from "./projectionTargets";
import {
  assertDocumentManifestBundleConsistent,
  errorMessage,
  targetKey,
  uniqueSortedStrings,
} from "./readers";

export { unwrapContainerKekPath } from "./containerKekPath";
export {
  collectContainerKeksForDocumentSync,
  unwrapDocumentContentKeyFromBundle,
  unwrapDocumentContentKeyFromWriterProjection,
  unwrapDocumentContentKeyTarget,
  wrapDocumentContentKeyForCreate,
} from "./projectionContentKeys";
export {
  authorizingContainerPathRecordsForLinkSet,
  authorizingContainerPathRefs,
  currentDocumentTargets,
  deriveDocumentCreateTargets,
  deriveDocumentTargetFromProjection,
  mergeTargetEnvelopes,
  projectionPathRecords,
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

export async function assertDocumentWriterProjectionConsistent(
  writerProjection: DocumentWriterProjectionResponse,
  input: ProjectionVerificationOptions & {
    execSql?: ExecSql | undefined;
    principalPolicyCache?: PrincipalPolicyCache | undefined;
    verifiedByHash?: Map<string, VerifiedContainerAccessManifest> | undefined;
  },
): Promise<DocumentContentKeyTarget[]> {
  const resolveProjectionUserKey = resolveProjectionVerifier(
    input,
    "Document writer projection",
  );
  if (resolveProjectionUserKey) {
    await verifyDocumentWriterProjection({
      execSql: input.execSql,
      principalPolicyCache: input.principalPolicyCache,
      projection: writerProjection,
      resolveUserKey: resolveProjectionUserKey,
      verifiedByHash: input.verifiedByHash,
    });
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
  const { manifestHash } = writerProjection.documentManifest;
  if (
    writerProjection.documentKekTargets.linkSetManifestHash !== manifestHash ||
    writerProjection.contentKeyBundle.linkSetManifestHash !== manifestHash
  ) {
    throw new Error("Document writer projection link manifest mismatch");
  }
  if (
    writerProjection.documentKekTargets.documentKeyTargetHash !==
    writerProjection.contentKeyBundle.targetHash
  ) {
    throw new Error("Document writer projection target hash mismatch");
  }

  const targets = currentDocumentTargets(writerProjection);
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
