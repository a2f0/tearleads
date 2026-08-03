import { db } from "@tearleads/api-shared/postgres";
import { users } from "@tearleads/api-shared/schema";
import {
  type PrincipalProjectionMember,
  wrapDekForRecipients,
} from "@tearleads/crypto";
import { base64ToBytes, bytesToBase64 } from "@tearleads/encoding";
import { eq } from "drizzle-orm";
import invariant from "invariant";
import { getCurrentPrincipalEpochKey } from "../../src/access/read/principalStateStore";

export async function createPrincipalMemberEnvelopes(input: {
  readonly principalSecretKey: Uint8Array;
  readonly projection: readonly PrincipalProjectionMember[];
}) {
  const stateMembers = input.projection.map((member) => ({
    userId: member.userId,
  }));
  const memberEnvelopes = await Promise.all(
    stateMembers.map(async (member) => {
      let encapsulationPublicKey: Uint8Array;
      let memberKeyFingerprint: string;

      if (member.principalType === "user") {
        const [recipient] = await db
          .select({
            encapsulationPublicKey: users.encapsulationPublicKey,
            memberKeyFingerprint: users.encapsulationKeyFingerprint,
          })
          .from(users)
          .where(eq(users.id, member.principalId))
          .limit(1);
        invariant(recipient, "expected user principal member recipient");
        encapsulationPublicKey = base64ToBytes(
          recipient.encapsulationPublicKey,
        );
        memberKeyFingerprint = recipient.memberKeyFingerprint;
      } else {
        const recipient = await getCurrentPrincipalEpochKey(
          "group",
          member.principalId,
          db,
        );
        invariant(recipient, "expected group principal member recipient");
        encapsulationPublicKey = base64ToBytes(
          recipient.encapsulationPublicKey,
        );
        memberKeyFingerprint = recipient.keyFingerprint;
      }

      const [wrappedGroupKey] = await wrapDekForRecipients(
        input.principalSecretKey,
        [encapsulationPublicKey],
      );
      invariant(wrappedGroupKey, "expected principal member envelope");

      return {
        userId: member.principalId,
        memberKeyFingerprint,
        kemCipherText: bytesToBase64(wrappedGroupKey.kemCipherText),
        wrappedKey: bytesToBase64(wrappedGroupKey.wrappedKey),
      };
    }),
  );

  return { memberEnvelopes, stateMembers };
}
