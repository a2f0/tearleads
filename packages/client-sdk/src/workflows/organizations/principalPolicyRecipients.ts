import { wrapDekForRecipients } from "@tearleads/crypto";
import { base64ToBytes, bytesToBase64 } from "@tearleads/encoding";
import type {
  PrincipalMemberEnvelopeRequest,
  PrincipalProjectionMemberRequest,
} from "@tearleads/validators/request";
import type { PrincipalPolicyBundleResponse } from "@tearleads/validators/response";

export interface OrganizationGroupRecipient {
  readonly groupId: string;
  readonly encapsulationPublicKey: string;
}

interface OrganizationUserRecipientLike {
  readonly userId: string;
  readonly encapsulationPublicKey: string;
}

interface OrganizationPrincipalPolicyReader {
  readonly getCurrentPrincipalPolicy: (
    principalType: "group" | "organization",
    principalId: string,
  ) => Promise<PrincipalPolicyBundleResponse | null>;
}

type PrincipalRekeyRecipient = {
  readonly encapsulationPublicKey: string;
  readonly memberPrincipalId: string;
  readonly memberPrincipalType: "user" | "group";
};

function toPrincipalMemberEnvelopeRequest(input: {
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

function toRekeyRecipientEntries(input: {
  readonly groups?: ReadonlyArray<OrganizationGroupRecipient> | undefined;
  readonly projection: ReadonlyArray<PrincipalProjectionMemberRequest>;
  readonly users: ReadonlyArray<OrganizationUserRecipientLike>;
}): PrincipalRekeyRecipient[] {
  const usersById = new Map(input.users.map((user) => [user.userId, user]));
  const groupsById = new Map(
    (input.groups ?? []).map((group) => [group.groupId, group]),
  );

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
      encapsulationPublicKey: group.encapsulationPublicKey,
      memberPrincipalId: group.groupId,
      memberPrincipalType: "group",
    };
  });
}

export async function loadOrganizationGroupRecipients(input: {
  readonly apiClient: OrganizationPrincipalPolicyReader;
  readonly groupIds: readonly string[];
}): Promise<OrganizationGroupRecipient[]> {
  const groupIds = [...new Set(input.groupIds)].sort();
  const policies = await Promise.all(
    groupIds.map(async (groupId) => {
      const policy = await input.apiClient.getCurrentPrincipalPolicy(
        "group",
        groupId,
      );
      if (!policy) {
        throw new Error(`Group policy could not be loaded for ${groupId}`);
      }

      return {
        groupId,
        encapsulationPublicKey: policy.currentState.encapsulationPublicKey,
      };
    }),
  );

  return policies;
}

export function remainingGroupMemberIds(
  projection: ReadonlyArray<PrincipalProjectionMemberRequest>,
): string[] {
  return projection
    .filter((member) => member.memberPrincipalType === "group")
    .map((member) => member.memberPrincipalId);
}

export async function rewrapProjectionMemberEnvelopes(input: {
  readonly groups?: ReadonlyArray<OrganizationGroupRecipient> | undefined;
  readonly projection: ReadonlyArray<PrincipalProjectionMemberRequest>;
  readonly secretKey: Uint8Array;
  readonly users: ReadonlyArray<OrganizationUserRecipientLike>;
}): Promise<PrincipalMemberEnvelopeRequest[]> {
  const recipients = toRekeyRecipientEntries(input);
  const wrappedRecipients = await wrapDekForRecipients(
    input.secretKey,
    recipients.map((recipient) =>
      base64ToBytes(recipient.encapsulationPublicKey),
    ),
  );

  return wrappedRecipients.map((envelope, index) =>
    toPrincipalMemberEnvelopeRequest({
      envelope,
      memberPrincipalType: recipients[index]?.memberPrincipalType ?? "user",
      memberPrincipalId: recipients[index]?.memberPrincipalId ?? "",
    }),
  );
}
