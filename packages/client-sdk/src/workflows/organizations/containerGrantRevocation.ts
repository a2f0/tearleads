import type { ContainerDirectGrant } from "@tearleads/crypto";
import type { ContainerMutationResponse } from "@tearleads/validators/response";
import { createProjectionUserKeyResolver } from "../../data/keyingProjectionVerification";
import type { ExecSql } from "../../data/sqlite/sqlSchema";
import { revokeRemoteContainer } from "../containers";
import { resolveDocumentCreateAuthor } from "../documents";

type OrganizationContainerGrantSubject = Pick<
  ContainerDirectGrant,
  "subjectId" | "subjectType"
>;

type OrganizationContainerGrantRevocationApi = Parameters<
  typeof revokeRemoteContainer
>[0]["apiClient"] & {
  getEncapsulationKey: Parameters<
    typeof createProjectionUserKeyResolver
  >[0]["apiClient"]["getEncapsulationKey"];
};

export async function revokeOrganizationContainerGrant(input: {
  readonly apiClient: OrganizationContainerGrantRevocationApi;
  readonly containerId: string;
  readonly encapsulationKeyPair: {
    readonly publicKey: Uint8Array;
    readonly secretKey: Uint8Array;
  };
  readonly execSql: ExecSql;
  readonly organizationId: string;
  readonly revokedSubject: OrganizationContainerGrantSubject;
  readonly signerUserId: string;
  readonly signingFingerprint: string;
  readonly signingKeyPair: {
    readonly signingPrivateKey: Uint8Array;
    readonly signingPublicKey: Uint8Array;
  };
}): Promise<ContainerMutationResponse> {
  const author = resolveDocumentCreateAuthor({
    organizationId: input.organizationId,
    signingFingerprint: input.signingFingerprint,
    signingKeyPair: input.signingKeyPair,
    userId: input.signerUserId,
  });
  if (!author) {
    throw new Error("Org Manager signing context is unavailable");
  }

  const revoked = await revokeRemoteContainer({
    apiClient: input.apiClient,
    author,
    containerId: input.containerId,
    execSql: input.execSql,
    revokedSubject: input.revokedSubject,
    resolveProjectionUserKey: createProjectionUserKeyResolver(
      {
        apiClient: input.apiClient,
        encapsulationKeyPair: input.encapsulationKeyPair,
        signingFingerprint: input.signingFingerprint,
        signingKeyPair: input.signingKeyPair,
        userId: input.signerUserId,
      },
      "Org Manager",
    ),
    targetSecretKey: input.encapsulationKeyPair.secretKey,
  });
  if (!revoked) {
    throw new Error("Container grant could not be revoked");
  }

  return revoked.response;
}
