import type { AnyVerifiedPrincipalPolicy } from "@tearleads/crypto";
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

/** Both paths have been verified; a readable proof does not authorize a link. */
export function assertDocumentLinkAuthorAccess(input: {
  author: DocumentCreateAuthor;
  principalPolicies: readonly AnyVerifiedPrincipalPolicy[];
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
  for (const projection of input.writerProjection.authorizingContainerPaths) {
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
