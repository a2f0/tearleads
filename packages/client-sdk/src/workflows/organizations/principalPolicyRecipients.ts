import {
  type VerifiedPrincipalPolicy,
  wrapDekForRecipients,
} from "@tearleads/crypto";
import { base64ToBytes, bytesToBase64 } from "@tearleads/encoding";
import type {
  PrincipalMemberEnvelopeRequest,
  PrincipalProjectionMemberRequest,
} from "@tearleads/validators/request";
import type { PrincipalMemberEnvelopeResponse } from "@tearleads/validators/response";
import type { TrustedUserIdentity } from "../../data/trustedUserIdentity";

type PrincipalRekeyRecipient = {
  readonly encapsulationPublicKey: Uint8Array;
  readonly userId: string;
};

export function toPrincipalMemberEnvelopeRequest(input: {
  readonly envelope: {
    readonly keyFingerprint: string;
    readonly kemCipherText: Uint8Array;
    readonly wrappedKey: Uint8Array;
  };
  readonly userId: string;
}): PrincipalMemberEnvelopeRequest {
  return {
    userId: input.userId,
    memberKeyFingerprint: input.envelope.keyFingerprint,
    kemCipherText: bytesToBase64(input.envelope.kemCipherText),
    wrappedKey: bytesToBase64(input.envelope.wrappedKey),
  };
}

export function toRecipientEntries(
  envelopes: ReadonlyArray<PrincipalMemberEnvelopeResponse>,
) {
  return envelopes.map((envelope) => ({
    keyFingerprint: envelope.memberKeyFingerprint,
    kemCipherText: base64ToBytes(envelope.kemCipherText),
    wrappedKey: base64ToBytes(envelope.wrappedKey),
  }));
}

function toRekeyRecipientEntries(input: {
  readonly groups?: readonly VerifiedPrincipalPolicy[] | undefined;
  readonly projection: ReadonlyArray<PrincipalProjectionMemberRequest>;
  readonly users: ReadonlyArray<TrustedUserIdentity>;
}): PrincipalRekeyRecipient[] {
  const usersById = new Map(input.users.map((user) => [user.userId, user]));
  const groupsById = new Map<string, VerifiedPrincipalPolicy>();
  for (const group of input.groups ?? []) {
    if (group.principalType !== "group") {
      throw new Error("Organization group recipient policy must be a group");
    }
    groupsById.set(group.principalId, group);
  }

  // Every projected member is a user, so there is no group recipient branch.
  return input.projection.map((member) => {
    const user = usersById.get(member.userId);
    if (!user) {
      throw new Error(`Missing recipient key for user ${member.userId}`);
    }

    return {
      encapsulationPublicKey: user.encapsulationPublicKey,
      userId: user.userId,
    };
  });
}

export function remainingGroupMemberIds(
  projection: ReadonlyArray<PrincipalProjectionMemberRequest>,
): string[] {
  return projection.filter(() => false).map((member) => member.userId);
}

export async function rewrapProjectionMemberEnvelopes(input: {
  readonly groups?: readonly VerifiedPrincipalPolicy[] | undefined;
  readonly projection: ReadonlyArray<PrincipalProjectionMemberRequest>;
  readonly secretKey: Uint8Array;
  readonly users: ReadonlyArray<TrustedUserIdentity>;
}): Promise<PrincipalMemberEnvelopeRequest[]> {
  const recipients = toRekeyRecipientEntries(input);
  const wrappedRecipients = await wrapDekForRecipients(
    input.secretKey,
    recipients.map((recipient) => recipient.encapsulationPublicKey),
  );

  return wrappedRecipients.map((envelope, index) =>
    toPrincipalMemberEnvelopeRequest({
      envelope,
      userId: recipients[index]?.userId ?? "",
    }),
  );
}
