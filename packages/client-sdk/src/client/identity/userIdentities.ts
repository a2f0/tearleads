import { bytesToBase64 } from "@tearleads/encoding";
import { runWithSecurityIncidentReporting } from "../../data/keyingProjectionVerification/error";
import type { SecurityIncidentReporter } from "../../data/shared/securityIncidents";
import {
  parseIdentityLink,
  type TrustedUserIdentity,
  type TrustedUserIdentityService,
  UnverifiedUserIdentityError,
} from "../../data/trustedUserIdentity";

export { UnverifiedUserIdentityError };

export interface ResolvedUserIdentity {
  encapsulationKeyFingerprint: string;
  encapsulationPublicKey: string;
  signingKeyFingerprint: string;
  signingPublicKey: string;
  userId: string;
}

/**
 * Identity links are the only way to admit another user. There is no lookup
 * by user ID that trusts the server's first answer.
 */
export interface UserIdentities {
  /** Share a stable link derived exclusively from this user's local keys. */
  createLink(appUrl: string): Promise<string>;
  /** Compare an independently received link before durably pinning either key. */
  verifyLink(link: string): Promise<ResolvedUserIdentity>;
  /**
   * The pinned identity for `userId` only when a verified identity link or
   * this device's own keys established it; `null` otherwise, including for a
   * pin observed on first sight. Never fetches.
   */
  resolveVerified(userId: string): Promise<ResolvedUserIdentity | null>;
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
    "createLink" | "verifyLink" | "resolveVerified"
  >;
}): UserIdentities {
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
    async resolveVerified(userId) {
      const identity = await input.identityLinks.resolveVerified(userId);
      return identity ? toResolvedIdentity(identity) : null;
    },
  };
}
