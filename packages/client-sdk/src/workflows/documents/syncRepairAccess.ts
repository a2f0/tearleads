import { resolveContainerPathUserAccessLevel } from "@tearleads/crypto";
import type { DocumentWriterProjectionResponse } from "@tearleads/validators/response";
import {
  requireProjectionUserKeyResolver,
  verifyDocumentWriterProjectionAuthorization,
} from "../../data/keyingProjectionVerification";
import type { SyncRemoteDocumentInput } from "./readOnlySync";

/** A repair refusal on one link does not revoke write access through another. */
export async function hasOtherLinkedWriteAccess(
  sync: SyncRemoteDocumentInput,
  projection: DocumentWriterProjectionResponse,
  inaccessibleContainerId: string,
): Promise<boolean> {
  if (projection.authorizingContainerPaths.length < 2) return false;
  const verified = await verifyDocumentWriterProjectionAuthorization({
    execSql: sync.execSql,
    persistVerificationCheckpoints: false,
    projection,
    resolveUserKey: requireProjectionUserKeyResolver(
      sync.resolveProjectionUserKey,
      "Document linked repair access",
    ),
    stillCurrent: sync.stillCurrent,
    warmReferencedPrincipalPolicies: sync.warmReferencedPrincipalPolicies,
  });
  const document = verified.documentManifestByHash.get(
    projection.documentManifest.manifestHash,
  );
  if (
    !document ||
    document.state.documentId !== sync.documentId ||
    document.state.organizationId !== sync.author.organizationId
  )
    return false;
  // The map also contains historical paths. Only the verified current paths
  // named by this projection may establish present write authority.
  return projection.authorizingContainerPaths.some((candidate) => {
    const headHash = candidate.path.at(-1)?.manifestHash;
    const path = headHash
      ? verified.containerPathByManifestHash.get(headHash)
      : undefined;
    const leaf = path?.at(-1);
    if (
      !path ||
      !leaf ||
      leaf.state.containerId === inaccessibleContainerId ||
      leaf.state.organizationId !== document.state.organizationId ||
      !document.state.linkedContainerIds.includes(leaf.state.containerId)
    )
      return false;
    const access = resolveContainerPathUserAccessLevel({
      path,
      principalPolicies: verified.principalPolicies,
      userId: sync.author.signerUserId,
    });
    return access === "write" || access === "admin";
  });
}
