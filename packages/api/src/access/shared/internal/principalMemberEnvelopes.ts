import type {
  ManagedRecipientPrincipalType,
  PrincipalStateMemberType,
} from "@tearleads/crypto";
import { and, eq, inArray } from "drizzle-orm";
import { type DatabaseExecutor, db } from "../../../adapters/postgres";
import { principalMemberEnvelopes, users } from "../../../schema";
import {
  getCurrentPrincipalEpochKeys,
  getCurrentPrincipalState,
  listCurrentPrincipalProjectionMembers,
} from "./principalStateStore";

interface PrincipalMemberRecipient {
  memberPrincipalType: PrincipalStateMemberType;
  memberPrincipalId: string;
  memberKeyFingerprint: string;
  encapsulationPublicKey: string;
}

interface PrincipalMemberEnvelopeInput {
  memberPrincipalType: PrincipalStateMemberType;
  memberPrincipalId: string;
  memberKeyFingerprint: string;
  kemCipherText: string;
  wrappedKey: string;
}

interface StoredPrincipalMemberEnvelope extends PrincipalMemberEnvelopeInput {
  principalType: ManagedRecipientPrincipalType;
  principalId: string;
  stateHash: string;
  epoch: number;
  createdAt: Date;
}

function memberRecipientKey(input: {
  memberPrincipalType: PrincipalStateMemberType;
  memberPrincipalId: string;
}): string {
  return `${input.memberPrincipalType}:${input.memberPrincipalId}`;
}

async function loadUserMemberRecipients(
  userIds: string[],
  executor: DatabaseExecutor,
): Promise<Map<string, PrincipalMemberRecipient>> {
  if (userIds.length === 0) {
    return new Map();
  }

  const rows = await executor
    .select({
      userId: users.id,
      encapsulationPublicKey: users.encapsulationPublicKey,
      memberKeyFingerprint: users.encapsulationKeyFingerprint,
    })
    .from(users)
    .where(inArray(users.id, userIds));

  const recipientsByUserId = new Map<string, PrincipalMemberRecipient>();

  for (const row of rows) {
    recipientsByUserId.set(row.userId, {
      memberPrincipalType: "user",
      memberPrincipalId: row.userId,
      memberKeyFingerprint: row.memberKeyFingerprint,
      encapsulationPublicKey: row.encapsulationPublicKey,
    });
  }

  return recipientsByUserId;
}

async function loadCurrentPrincipalMemberRecipientsForState(
  principalType: ManagedRecipientPrincipalType,
  principalId: string,
  executor: DatabaseExecutor,
): Promise<{
  stateHash: string;
  epoch: number;
  recipients: PrincipalMemberRecipient[];
}> {
  const currentState = await getCurrentPrincipalState(
    principalType,
    principalId,
    executor,
  );

  if (!currentState) {
    throw new Error(
      `Missing current principal state for ${principalType}:${principalId}`,
    );
  }

  const currentProjection = await listCurrentPrincipalProjectionMembers(
    principalType,
    principalId,
    executor,
  );
  const userMemberIds = currentProjection
    .filter((member) => member.memberPrincipalType === "user")
    .map((member) => member.memberPrincipalId);
  const userRecipientsById = await loadUserMemberRecipients(
    userMemberIds,
    executor,
  );
  const groupMemberIds = currentProjection
    .filter((member) => member.memberPrincipalType === "group")
    .map((member) => member.memberPrincipalId);
  const groupRecipientsById = await getCurrentPrincipalEpochKeys(
    "group",
    groupMemberIds,
    executor,
  );

  const recipients: PrincipalMemberRecipient[] = [];

  for (const member of currentProjection) {
    if (member.memberPrincipalType === "user") {
      const recipient = userRecipientsById.get(member.memberPrincipalId);

      if (!recipient) {
        throw new Error(
          `Missing user recipient key for principal state member ${member.memberPrincipalId}`,
        );
      }

      recipients.push(recipient);
      continue;
    }

    const nestedPrincipalEpochKey = groupRecipientsById.get(
      member.memberPrincipalId,
    );

    if (!nestedPrincipalEpochKey) {
      throw new Error(
        `Missing current principal epoch key for group member ${member.memberPrincipalId}`,
      );
    }

    recipients.push({
      memberPrincipalType: "group",
      memberPrincipalId: member.memberPrincipalId,
      memberKeyFingerprint: nestedPrincipalEpochKey.keyFingerprint,
      encapsulationPublicKey: nestedPrincipalEpochKey.encapsulationPublicKey,
    });
  }

  return {
    stateHash: currentState.stateHash,
    epoch: currentState.keyEpoch,
    recipients,
  };
}

async function listPrincipalMemberEnvelopesForState(
  principalType: ManagedRecipientPrincipalType,
  principalId: string,
  stateHash: string,
  executor: DatabaseExecutor,
): Promise<StoredPrincipalMemberEnvelope[]> {
  const rows = await executor
    .select({
      principalType: principalMemberEnvelopes.principalType,
      principalId: principalMemberEnvelopes.principalId,
      stateHash: principalMemberEnvelopes.stateHash,
      epoch: principalMemberEnvelopes.epoch,
      memberPrincipalType: principalMemberEnvelopes.memberPrincipalType,
      memberPrincipalId: principalMemberEnvelopes.memberPrincipalId,
      memberKeyFingerprint: principalMemberEnvelopes.memberKeyFingerprint,
      kemCipherText: principalMemberEnvelopes.kemCipherText,
      wrappedKey: principalMemberEnvelopes.wrappedKey,
      createdAt: principalMemberEnvelopes.createdAt,
    })
    .from(principalMemberEnvelopes)
    .where(
      and(
        eq(principalMemberEnvelopes.principalType, principalType),
        eq(principalMemberEnvelopes.principalId, principalId),
        eq(principalMemberEnvelopes.stateHash, stateHash),
      ),
    )
    .orderBy(
      principalMemberEnvelopes.memberPrincipalType,
      principalMemberEnvelopes.memberPrincipalId,
    );

  return rows;
}

export async function listCurrentPrincipalMemberRecipients(
  principalType: ManagedRecipientPrincipalType,
  principalId: string,
  executor: DatabaseExecutor = db,
): Promise<PrincipalMemberRecipient[]> {
  const { recipients } = await loadCurrentPrincipalMemberRecipientsForState(
    principalType,
    principalId,
    executor,
  );

  return recipients;
}

export async function listCurrentPrincipalMemberEnvelopes(
  principalType: ManagedRecipientPrincipalType,
  principalId: string,
  executor: DatabaseExecutor = db,
): Promise<StoredPrincipalMemberEnvelope[]> {
  const currentState = await getCurrentPrincipalState(
    principalType,
    principalId,
    executor,
  );

  if (!currentState) {
    return [];
  }

  return listPrincipalMemberEnvelopesForState(
    principalType,
    principalId,
    currentState.stateHash,
    executor,
  );
}

export async function replaceCurrentPrincipalMemberEnvelopes(
  input: {
    principalType: ManagedRecipientPrincipalType;
    principalId: string;
    stateHash: string;
    envelopes: PrincipalMemberEnvelopeInput[];
  },
  executor: DatabaseExecutor = db,
): Promise<StoredPrincipalMemberEnvelope[]> {
  if (executor === db) {
    return db.transaction(async (tx) =>
      replaceCurrentPrincipalMemberEnvelopes(input, tx),
    );
  }

  const { stateHash, epoch, recipients } =
    await loadCurrentPrincipalMemberRecipientsForState(
      input.principalType,
      input.principalId,
      executor,
    );

  if (stateHash !== input.stateHash) {
    throw new Error("Principal member envelopes must target the current state");
  }

  const expectedRecipientsByKey = new Map<string, PrincipalMemberRecipient>();

  for (const recipient of recipients) {
    expectedRecipientsByKey.set(memberRecipientKey(recipient), recipient);
  }

  if (input.envelopes.length !== expectedRecipientsByKey.size) {
    throw new Error(
      "Principal member envelopes must match the current direct member set",
    );
  }

  const insertedRows = input.envelopes.map((envelope) => {
    const recipientKey = memberRecipientKey(envelope);
    const expectedRecipient = expectedRecipientsByKey.get(recipientKey);

    if (!expectedRecipient) {
      throw new Error(
        `Principal member envelope targets unknown member ${recipientKey}`,
      );
    }

    if (
      expectedRecipient.memberKeyFingerprint !== envelope.memberKeyFingerprint
    ) {
      throw new Error(
        `Principal member envelope fingerprint mismatch for ${recipientKey}`,
      );
    }

    if (
      envelope.kemCipherText.length === 0 ||
      envelope.wrappedKey.length === 0
    ) {
      throw new Error(
        `Principal member envelope is missing wrapped material for ${recipientKey}`,
      );
    }

    expectedRecipientsByKey.delete(recipientKey);

    return {
      principalType: input.principalType,
      principalId: input.principalId,
      stateHash,
      epoch,
      memberPrincipalType: envelope.memberPrincipalType,
      memberPrincipalId: envelope.memberPrincipalId,
      memberKeyFingerprint: envelope.memberKeyFingerprint,
      kemCipherText: envelope.kemCipherText,
      wrappedKey: envelope.wrappedKey,
    };
  });

  if (expectedRecipientsByKey.size > 0) {
    throw new Error(
      "Principal member envelopes must cover the current direct member set",
    );
  }

  await executor
    .delete(principalMemberEnvelopes)
    .where(
      and(
        eq(principalMemberEnvelopes.principalType, input.principalType),
        eq(principalMemberEnvelopes.principalId, input.principalId),
        eq(principalMemberEnvelopes.stateHash, stateHash),
      ),
    );

  if (insertedRows.length > 0) {
    await executor.insert(principalMemberEnvelopes).values(insertedRows);
  }

  return listPrincipalMemberEnvelopesForState(
    input.principalType,
    input.principalId,
    stateHash,
    executor,
  );
}
