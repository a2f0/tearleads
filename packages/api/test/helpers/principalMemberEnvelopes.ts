import { db } from "@symcrypt/api-shared/postgres";
import { users } from "@symcrypt/api-shared/schema";
import {
  type PrincipalProjectionMember,
  wrapDekForRecipients,
} from "@symcrypt/crypto";
import { base64ToBytes, bytesToBase64 } from "@symcrypt/encoding";
import { eq } from "drizzle-orm";
import invariant from "invariant";

export async function createPrincipalMemberEnvelopes(input: {
  readonly principalSecretKey: Uint8Array;
  readonly projection: readonly PrincipalProjectionMember[];
}) {
  const stateMembers = input.projection.map((member) => ({
    userId: member.userId,
  }));
  const memberEnvelopes = await Promise.all(
    stateMembers.map(async (member) => {
      // Every member is a user, so there is no group-recipient branch.
      const [recipient] = await db
        .select({
          encapsulationPublicKey: users.encapsulationPublicKey,
          memberKeyFingerprint: users.encapsulationKeyFingerprint,
        })
        .from(users)
        .where(eq(users.id, member.userId))
        .limit(1);
      invariant(recipient, "expected user principal member recipient");
      const encapsulationPublicKey = base64ToBytes(
        recipient.encapsulationPublicKey,
      );
      const memberKeyFingerprint = recipient.memberKeyFingerprint;

      const [wrappedGroupKey] = await wrapDekForRecipients(
        input.principalSecretKey,
        [encapsulationPublicKey],
      );
      invariant(wrappedGroupKey, "expected principal member envelope");

      return {
        userId: member.userId,
        memberKeyFingerprint,
        kemCipherText: bytesToBase64(wrappedGroupKey.kemCipherText),
        wrappedKey: bytesToBase64(wrappedGroupKey.wrappedKey),
      };
    }),
  );

  return { memberEnvelopes, stateMembers };
}
