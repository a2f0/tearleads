import type { ContainerDirectGrant } from "@symcrypt/crypto";
import type { ContainerMutationResponse } from "@symcrypt/validators/response";
import type { ReferencedPrincipalPolicyWarmer } from "../../data/keyingProjectionVerification";
import { createProjectionUserKeyResolver } from "../../data/keyingProjectionVerification/userKeyResolver";
import type { ExecSql } from "../../data/sqlite/sqlSchema";
import type { TrustedUserIdentityResolver } from "../../data/trustedUserIdentity";
import { revokeRemoteContainer } from "../containers";
import { resolveDocumentCreateAuthor } from "../documents";

type OrganizationContainerGrantSubject = Pick<
  ContainerDirectGrant,
  "subjectId" | "subjectType"
>;

type OrganizationContainerGrantRevocationApi = Parameters<
  typeof revokeRemoteContainer
>[0]["apiClient"];

export async function revokeOrganizationContainerGrant(input: {
  readonly apiClient: OrganizationContainerGrantRevocationApi;
  readonly containerId: string;
  readonly encapsulationKeyPair: {
    readonly publicKey: Uint8Array;
    readonly secretKey: Uint8Array;
  };
  readonly execSql: ExecSql;
  readonly organizationId: string;
  readonly resolveTrustedUserIdentity: TrustedUserIdentityResolver;
  readonly revokedSubject: OrganizationContainerGrantSubject;
  readonly signerUserId: string;
  readonly signingFingerprint: string;
  readonly signingKeyPair: {
    readonly signingPrivateKey: Uint8Array;
    readonly signingPublicKey: Uint8Array;
  };
  readonly warmReferencedPrincipalPolicies?:
    | ReferencedPrincipalPolicyWarmer
    | undefined;
}): Promise<ContainerMutationResponse> {
  const author = resolveDocumentCreateAuthor({
    auth: {
      organizationId: input.organizationId,
      userId: input.signerUserId,
    },
    crypto: {
      signingFingerprint: input.signingFingerprint,
      signingKeyPair: input.signingKeyPair,
    },
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
    resolveProjectionUserKey: createProjectionUserKeyResolver({
      resolveTrustedUserIdentity: input.resolveTrustedUserIdentity,
    }),
    targetSecretKey: input.encapsulationKeyPair.secretKey,
    warmReferencedPrincipalPolicies: input.warmReferencedPrincipalPolicies,
  });
  if (!revoked) {
    throw new Error("Container grant could not be revoked");
  }

  return revoked.response;
}
