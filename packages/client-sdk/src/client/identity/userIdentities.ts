import { bytesToBase64 } from "@tearleads/encoding";
import { ProjectionDependencyUnavailableError } from "../../data/keyingProjectionVerification/dependencyUnavailable";
import { runWithSecurityIncidentReporting } from "../../data/keyingProjectionVerification/error";
import type { SecurityIncidentReporter } from "../../data/shared/securityIncidents";
import {
  parseIdentityLink,
  requireTrustedUserIdentityResolver,
  type TrustedUserIdentity,
  type TrustedUserIdentityResolver,
  type TrustedUserIdentityService,
} from "../../data/trustedUserIdentity";

export interface ResolvedUserIdentity {
  encapsulationKeyFingerprint: string;
  encapsulationPublicKey: string;
  signingKeyFingerprint: string;
  signingPublicKey: string;
  userId: string;
}

export interface UserIdentities {
  /** Share a stable link derived exclusively from this user's local keys. */
  createLink(appUrl: string): Promise<string>;
  /** Compare an independently received link before durably pinning either key. */
  verifyLink(link: string): Promise<ResolvedUserIdentity>;
  /** Read an existing durable pin without fetching or trusting a new identity. */
  resolvePinned(userId: string): Promise<ResolvedUserIdentity | null>;
  /** `null` when the user is unknown or currently unresolvable; integrity failures throw. */
  resolve(userId: string): Promise<ResolvedUserIdentity | null>;
}

function toResolvedIdentity(
  identity: TrustedUserIdentity,
): ResolvedUserIdentity {
  return {
    encapsulationKeyFingerprint: identity.encapsulationKeyFingerprint,
    encapsulationPublicKey: bytesToBase64(identity.encapsulationPublicKey),
    signingKeyFingerprint: identity.signingKeyFingerprint,
    signingPublicKey: bytesToBase64(identity.signingPublicKey),
    userId: identity.userId,
  };
}

export function createUserIdentities(input: {
  getOrganizationId: () => string | null;
  reportSecurityIncident: SecurityIncidentReporter;
  identityLinks: Pick<
    TrustedUserIdentityService,
    "createLink" | "verifyLink" | "resolvePinned"
  >;
  log: (message: string) => void;
  resolveTrustedUserIdentity: TrustedUserIdentityResolver;
}): UserIdentities {
  const resolveTrustedUserIdentity = requireTrustedUserIdentityResolver(
    input.resolveTrustedUserIdentity,
  );
  return {
    createLink: (appUrl) => input.identityLinks.createLink(appUrl),
    async verifyLink(link) {
      const { userId } = parseIdentityLink(link);
      return runWithSecurityIncidentReporting(
        input.reportSecurityIncident,
        {
          objectId: userId,
          objectKind: "user",
          operation: "user.identity.verify_link",
          organizationId: input.getOrganizationId(),
        },
        async () =>
          toResolvedIdentity(await input.identityLinks.verifyLink(link)),
      );
    },
    async resolvePinned(userId) {
      const identity = await input.identityLinks.resolvePinned(userId);
      return identity ? toResolvedIdentity(identity) : null;
    },
    async resolve(userId) {
      input.log(`Loading user identity for userId: ${userId}`);
      let identity: Awaited<ReturnType<TrustedUserIdentityResolver>>;
      try {
        identity = await resolveTrustedUserIdentity(userId);
      } catch (error) {
        if (!(error instanceof ProjectionDependencyUnavailableError))
          throw error;
        input.log(
          `User identity for ${userId} is unavailable: ${error.message}`,
        );
        return null;
      }
      if (!identity) {
        return null;
      }

      return toResolvedIdentity(identity);
    },
  };
}
