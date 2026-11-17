import type { ContainerDirectGrant } from "@tearleads/crypto";
import type { ContainerMutationResponse } from "@tearleads/validators/response";
import type { ReferencedPrincipalPolicyWarmer } from "../../data/keyingProjectionVerification";
import { createProjectionUserKeyResolver } from "../../data/keyingProjectionVerification/userKeyResolver";
import type { TrustedUserIdentityResolver } from "../../data/trustedUserIdentity";
import type { ContainerMutationService } from "../containers";
import { resolveDocumentCreateAuthor } from "../documents";

type OrganizationContainerGrantSubject = Pick<
  ContainerDirectGrant,
  "subjectId" | "subjectType"
>;

export async function revokeOrganizationContainerGrant(input: {
  readonly stillCurrent: () => boolean;
  readonly containerId: string;
  /** Bound to the runtime snapshot whose encapsulation key reaches the container. */
  readonly containers: ContainerMutationService;
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

  const revoked = await input.containers.revokeRemoteContainer({
    stillCurrent: input.stillCurrent,
    author,
    containerId: input.containerId,
    revokedSubject: input.revokedSubject,
    resolveProjectionUserKey: createProjectionUserKeyResolver({
      resolveTrustedUserIdentity: input.resolveTrustedUserIdentity,
    }),
    warmReferencedPrincipalPolicies: input.warmReferencedPrincipalPolicies,
  });
  if (!revoked) {
    throw new Error("Container grant could not be revoked");
  }

  return revoked.response;
}
