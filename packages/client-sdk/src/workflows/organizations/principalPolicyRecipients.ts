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
  readonly memberPrincipalId: string;
  readonly memberPrincipalType: "user" | "group";
};

export function toPrincipalMemberEnvelopeRequest(input: {
  readonly envelope: {
    readonly keyFingerprint: string;
    readonly kemCipherText: Uint8Array;
    readonly wrappedKey: Uint8Array;
  };
  readonly memberPrincipalId: string;
  readonly memberPrincipalType: "user" | "group";
}): PrincipalMemberEnvelopeRequest {
  return {
    memberPrincipalType: input.memberPrincipalType,
    memberPrincipalId: input.memberPrincipalId,
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

  return input.projection.map((member) => {
    if (member.memberPrincipalType === "user") {
      const user = usersById.get(member.memberPrincipalId);
      if (!user) {
        throw new Error(
          `Missing recipient key for user ${member.memberPrincipalId}`,
        );
      }

      return {
        encapsulationPublicKey: user.encapsulationPublicKey,
        memberPrincipalId: user.userId,
        memberPrincipalType: "user",
      };
    }

    const group = groupsById.get(member.memberPrincipalId);
    if (!group) {
      throw new Error(
        `Missing recipient key for group ${member.memberPrincipalId}`,
      );
    }

    return {
      encapsulationPublicKey: base64ToBytes(group.state.encapsulationPublicKey),
      memberPrincipalId: group.principalId,
      memberPrincipalType: "group",
    };
  });
}

export function remainingGroupMemberIds(
  projection: ReadonlyArray<PrincipalProjectionMemberRequest>,
): string[] {
  return projection
    .filter((member) => member.memberPrincipalType === "group")
    .map((member) => member.memberPrincipalId);
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
      memberPrincipalType: recipients[index]?.memberPrincipalType ?? "user",
      memberPrincipalId: recipients[index]?.memberPrincipalId ?? "",
    }),
  );
}
