import type {
  ContainerWriterProjectionResponse,
  DocumentWriterProjectionResponse,
} from "@tearleads/validators/response";
import {
  assertContainerAuthorAccess,
  ContainerAuthorAccessError,
} from "../../data/containers/shared/authorAccess";
import { readLinkedContainerIdsFromDocumentManifest } from "../../data/documents/shared/projection";
import type { DocumentCreateAuthor } from "../../data/documents/shared/types";
import {
  type ProjectionVerificationOptions,
  resolveProjectionVerifier,
} from "../../data/documents/shared/types";
import {
  collectContainerWriterProjectionPrincipalPolicies,
  type PrincipalPolicyCache,
} from "../../data/keyingProjectionVerification";
import { documentContainerProjections } from "../../data/keyingProjectionVerification/documentContainerProjections";
import { throwKeyingVerificationErrorWithContext } from "../../data/keyingProjectionVerification/error";
import type { PrincipalPolicyCheckpointEvidence } from "../../data/principals/principalPolicyEvidence";
import type { ExecSql } from "../../data/sqlite/sqlSchema";

/** Both paths have been verified; a readable proof does not authorize a link. */
export function assertDocumentLinkAuthorAccess(input: {
  author: DocumentCreateAuthor;
  principalPolicies: readonly PrincipalPolicyCheckpointEvidence[];
  targetContainerProjection: ContainerWriterProjectionResponse;
  writerProjection: DocumentWriterProjectionResponse;
}): void {
  const author = {
    ...input.author,
    organizationId: input.targetContainerProjection.organizationId,
  };
  const permission = {
    author,
    minimumAccess: "write" as const,
    principalPolicies: input.principalPolicies,
  };
  assertContainerAuthorAccess({
    ...permission,
    projection: input.targetContainerProjection,
  });
  const linked = readLinkedContainerIdsFromDocumentManifest(
    input.writerProjection,
  );
  for (const projection of documentContainerProjections(
    input.writerProjection,
  )) {
    if (!linked.includes(projection.containerId)) continue;
    try {
      assertContainerAuthorAccess({ ...permission, projection });
      return;
    } catch (error) {
      if (!(error instanceof ContainerAuthorAccessError)) throw error;
    }
  }
  throw new ContainerAuthorAccessError(
    "Document signer lacks write access through a linked container",
  );
}

/** Current write authorization needs full policies for the readable paths. */
export async function verifyDocumentLinkSetCurrentPolicies(
  input: {
    execSql?: ExecSql | undefined;
    principalPolicyCache: PrincipalPolicyCache;
    targetContainerProjection: ContainerWriterProjectionResponse;
    writerProjection: DocumentWriterProjectionResponse;
  } & ProjectionVerificationOptions,
): Promise<void> {
  resolveProjectionVerifier(input, "Document link-set current policies");
  if (input.trustedLocalProjection === true) return;
  try {
    for (const projection of [
      input.targetContainerProjection,
      ...documentContainerProjections(input.writerProjection),
    ]) {
      await collectContainerWriterProjectionPrincipalPolicies({
        execSql: input.execSql,
        principalPolicyCache: input.principalPolicyCache,
        projection,
        resolveUserKey: input.resolveProjectionUserKey,
        stillCurrent: input.stillCurrent,
        warmReferencedPrincipalPolicies: input.warmReferencedPrincipalPolicies,
      });
    }
  } catch (error) {
    throwKeyingVerificationErrorWithContext(
      error,
      "Document link-set current policy verification failed",
    );
  }
}
