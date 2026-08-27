import type { DatabaseSession } from "@symcrypt/api-shared/postgres";
import type {
  DocumentPurgeAccessEventBody,
  VerifiedContainerAccessManifest,
} from "@symcrypt/crypto";
import { resolveHistoricalContainerPathUserAccessLevel } from "@symcrypt/crypto";
import type { AccessManifestBundleWireResponse } from "@symcrypt/validators/response";
import {
  ContainerWriterProjectionError,
  createContainerWriterProjectionContext,
} from "../../containers/writerProjection";
import { loadContainerManifestBundleByHash } from "../../containers/writerProjection/accessPaths";
import { verifyStoredContainerManifest } from "../../containers/writerProjection/storedManifestVerification";
import { loadVerifiedPrincipalPolicySnapshotsForReferences } from "../../principals/principalPolicySnapshots";
import {
  collectPurgeProofPrincipalReferences,
  type DocumentPurgeAuthorizationMaterial,
  loadDocumentPurgeAuthorizationMaterial,
} from "../writerProjectionPurgeProof";
import { DocumentMutationError } from "./errors";

export type ContainerProjectionContext = ReturnType<
  typeof createContainerWriterProjectionContext
>;

export async function verifyStoredContainerPath(input: {
  readonly bundles: readonly AccessManifestBundleWireResponse[];
  readonly context: ContainerProjectionContext;
}): Promise<VerifiedContainerAccessManifest[]> {
  const verified: VerifiedContainerAccessManifest[] = [];
  for (const bundle of input.bundles) {
    verified.push(
      await verifyStoredContainerManifest({
        bundle,
        context: input.context,
        loadBundle: (manifestHash) =>
          loadContainerManifestBundleByHash(input.context, manifestHash),
      }),
    );
  }
  return verified;
}

export async function authorizeDocumentPurgeProof(input: {
  readonly body: DocumentPurgeAccessEventBody;
  readonly executor: DatabaseSession;
  readonly userId: string;
}): Promise<DocumentPurgeAuthorizationMaterial> {
  try {
    const material = await loadDocumentPurgeAuthorizationMaterial({
      authorizingContainerManifestHashes:
        input.body.authorizingContainerManifestHashes,
      executor: input.executor,
    });
    const evidence = await loadVerifiedPrincipalPolicySnapshotsForReferences(
      input.executor,
      collectPurgeProofPrincipalReferences([
        ...material.authorizingContainerPath,
        ...material.authorizingContainerManifestHistory,
      ]),
    );
    const context = createContainerWriterProjectionContext(
      input.executor,
      evidence.policies,
    );
    const path = await verifyStoredContainerPath({
      bundles: material.authorizingContainerPath,
      context,
    });
    // A purge proof is terminal history. A replica that had access when the
    // purge was signed may still retrieve it after later revocation.
    const hadPurgePathAccess =
      resolveHistoricalContainerPathUserAccessLevel({
        path,
        principalPolicies: evidence.policies,
        userId: input.userId,
      }) !== null;
    if (!hadPurgePathAccess) {
      throw new DocumentMutationError("Forbidden", 403);
    }
    return material;
  } catch (error) {
    if (error instanceof ContainerWriterProjectionError) {
      throw new DocumentMutationError(error.message, 409);
    }
    throw error;
  }
}
