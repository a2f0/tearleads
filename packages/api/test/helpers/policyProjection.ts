import { db } from "@tearleads/api-shared/postgres";
import { users } from "@tearleads/api-shared/schema";
import {
  computeUserIdentityBundleFingerprint,
  type PrincipalProjectionMember,
} from "@tearleads/crypto";
import { base64ToBytes } from "@tearleads/encoding";
import { inArray } from "drizzle-orm";

export const API_TEST_IDENTITY_TRUST_DOMAIN = "http://localhost";
export type FixtureProjectionMember = Omit<
  PrincipalProjectionMember,
  "identityBundleFingerprint"
> & { readonly identityBundleFingerprint?: string };

/** Resolve real registered identities; explicitly supplied commitments remain unmodified for adversarial tests. */
export async function registeredProjection(
  members: readonly FixtureProjectionMember[],
  identityTrustDomain = API_TEST_IDENTITY_TRUST_DOMAIN,
): Promise<PrincipalProjectionMember[]> {
  const missing = members.filter(
    (member) => member.identityBundleFingerprint === undefined,
  );
  const rows = missing.length
    ? await db
        .select({
          userId: users.id,
          signingPublicKey: users.signingPublicKey,
          encapsulationPublicKey: users.encapsulationPublicKey,
        })
        .from(users)
        .where(
          inArray(
            users.id,
            missing.map((member) => member.userId),
          ),
        )
    : [];
  const keys = new Map(rows.map((row) => [row.userId, row]));
  return Promise.all(
    members.map(async (member) => {
      if (member.identityBundleFingerprint !== undefined)
        return {
          ...member,
          identityBundleFingerprint: member.identityBundleFingerprint,
        };
      const identity = keys.get(member.userId);
      if (!identity)
        throw new Error(
          `Policy fixture requires registered identity for ${member.userId}`,
        );
      return {
        ...member,
        identityBundleFingerprint: await computeUserIdentityBundleFingerprint({
          identityTrustDomain,
          userId: member.userId,
          signingPublicKey: base64ToBytes(identity.signingPublicKey),
          encapsulationPublicKey: base64ToBytes(
            identity.encapsulationPublicKey,
          ),
        }),
      };
    }),
  );
}
