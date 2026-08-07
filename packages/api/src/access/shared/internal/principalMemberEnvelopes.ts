import type {
  DatabaseSession,
  DatabaseTransaction,
} from "@tearleads/api-shared/postgres";
import { principalMemberEnvelopes, users } from "@tearleads/api-shared/schema";
import type { ManagedRecipientPrincipalType } from "@tearleads/crypto";
import {
  computePrincipalMemberEnvelopesRoot,
  throwPrincipalPolicyValidationError,
} from "@tearleads/crypto";
import { and, eq, inArray } from "drizzle-orm";
import {
  getCurrentPrincipalState,
  listCurrentPrincipalProjectionMembers,
} from "./principalStateStore";

interface PrincipalMemberRecipient {
  userId: string;
  memberKeyFingerprint: string;
  encapsulationPublicKey: string;
}

interface PrincipalMemberEnvelopeInput {
  userId: string;
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

interface StorePrincipalMemberEnvelopesInput {
  principalType: ManagedRecipientPrincipalType;
  principalId: string;
  stateHash: string;
  envelopes: PrincipalMemberEnvelopeInput[];
}

async function loadUserMemberRecipients(
  userIds: string[],
  executor: DatabaseSession,
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
      userId: row.userId,
      memberKeyFingerprint: row.memberKeyFingerprint,
      encapsulationPublicKey: row.encapsulationPublicKey,
    });
  }

  return recipientsByUserId;
}

async function loadCurrentPrincipalMemberRecipientsForState(
  principalType: ManagedRecipientPrincipalType,
  principalId: string,
  executor: DatabaseSession,
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
    throwPrincipalPolicyValidationError(
      "missing_state",
      `Missing current principal state for ${principalType}:${principalId}`,
    );
  }

  const currentProjection = await listCurrentPrincipalProjectionMembers(
    principalType,
    principalId,
    executor,
  );
  // Every projected member is a user, so this is one lookup rather than a
  // split over member kinds followed by a nested principal-epoch-key fetch.
  const userRecipientsById = await loadUserMemberRecipients(
    currentProjection.map((member) => member.userId),
    executor,
  );

  const recipients: PrincipalMemberRecipient[] = [];
  for (const member of currentProjection) {
    const recipient = userRecipientsById.get(member.userId);
    if (!recipient) {
      throwPrincipalPolicyValidationError(
        "state_conflict",
        `Missing user recipient key for principal state member ${member.userId}`,
      );
    }
    recipients.push(recipient);
  }

  return {
    stateHash: currentState.stateHash,
    epoch: currentState.keyEpoch,
    recipients,
  };
}

export async function listPrincipalMemberEnvelopesForState(
  principalType: ManagedRecipientPrincipalType,
  principalId: string,
  stateHash: string,
  executor: DatabaseSession,
): Promise<StoredPrincipalMemberEnvelope[]> {
  const rows = await executor
    .select({
      principalType: principalMemberEnvelopes.principalType,
      principalId: principalMemberEnvelopes.principalId,
      stateHash: principalMemberEnvelopes.stateHash,
      epoch: principalMemberEnvelopes.epoch,
      userId: principalMemberEnvelopes.userId,
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
    .orderBy(principalMemberEnvelopes.userId);

  return rows;
}

export async function listCurrentPrincipalMemberRecipients(
  principalType: ManagedRecipientPrincipalType,
  principalId: string,
  executor: DatabaseSession,
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
  executor: DatabaseSession,
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

function buildPrincipalMemberEnvelopeRows(input: {
  readonly envelopes: PrincipalMemberEnvelopeInput[];
  readonly epoch: number;
  readonly principalId: string;
  readonly principalType: ManagedRecipientPrincipalType;
  readonly recipients: PrincipalMemberRecipient[];
  readonly stateHash: string;
}): Array<Omit<StoredPrincipalMemberEnvelope, "createdAt">> {
  const expectedRecipients = new Map(
    input.recipients.map((recipient) => [recipient.userId, recipient]),
  );
  if (input.envelopes.length !== expectedRecipients.size) {
    throwPrincipalPolicyValidationError(
      "state_conflict",
      "Principal member envelopes must match the current direct member set",
    );
  }

  const rows = input.envelopes.map((envelope) => {
    const recipientKey = envelope.userId;
    const expectedRecipient = expectedRecipients.get(recipientKey);
    if (!expectedRecipient) {
      throwPrincipalPolicyValidationError(
        "state_conflict",
        `Principal member envelope targets unknown member ${recipientKey}`,
      );
    }
    if (
      expectedRecipient.memberKeyFingerprint !== envelope.memberKeyFingerprint
    ) {
      throwPrincipalPolicyValidationError(
        "state_conflict",
        `Principal member envelope fingerprint mismatch for ${recipientKey}`,
      );
    }
    if (
      envelope.kemCipherText.length === 0 ||
      envelope.wrappedKey.length === 0
    ) {
      throwPrincipalPolicyValidationError(
        "invalid_artifact",
        `Principal member envelope is missing wrapped material for ${recipientKey}`,
      );
    }
    expectedRecipients.delete(recipientKey);
    return {
      principalType: input.principalType,
      principalId: input.principalId,
      stateHash: input.stateHash,
      epoch: input.epoch,
      ...envelope,
    };
  });

  if (expectedRecipients.size > 0) {
    throwPrincipalPolicyValidationError(
      "state_conflict",
      "Principal member envelopes must cover the current direct member set",
    );
  }
  return rows;
}

async function insertAndVerifyPrincipalMemberEnvelopeRows(input: {
  readonly executor: DatabaseTransaction;
  readonly expectedCount: number;
  readonly principalId: string;
  readonly principalType: ManagedRecipientPrincipalType;
  readonly rows: Array<Omit<StoredPrincipalMemberEnvelope, "createdAt">>;
  readonly stateHash: string;
  readonly submittedRoot: string;
}): Promise<StoredPrincipalMemberEnvelope[]> {
  if (input.rows.length > 0) {
    await input.executor
      .insert(principalMemberEnvelopes)
      .values(input.rows)
      .onConflictDoNothing({
        target: [
          principalMemberEnvelopes.principalType,
          principalMemberEnvelopes.principalId,
          principalMemberEnvelopes.stateHash,
          principalMemberEnvelopes.userId,
        ],
      });
  }
  const persisted = await listPrincipalMemberEnvelopesForState(
    input.principalType,
    input.principalId,
    input.stateHash,
    input.executor,
  );
  if (
    persisted.length !== input.expectedCount ||
    (await computePrincipalMemberEnvelopesRoot(persisted)) !==
      input.submittedRoot
  ) {
    throwPrincipalPolicyValidationError(
      "state_conflict",
      "Principal member envelope conflict",
    );
  }
  return persisted;
}

export async function replaceCurrentPrincipalMemberEnvelopesInTransaction(
  input: StorePrincipalMemberEnvelopesInput,
  executor: DatabaseTransaction,
): Promise<StoredPrincipalMemberEnvelope[]> {
  const currentState = await getCurrentPrincipalState(
    input.principalType,
    input.principalId,
    executor,
  );
  if (!currentState) {
    throwPrincipalPolicyValidationError(
      "missing_state",
      `Missing current principal state for ${input.principalType}:${input.principalId}`,
    );
  }

  if (currentState.stateHash !== input.stateHash) {
    throwPrincipalPolicyValidationError(
      "state_conflict",
      "Principal member envelopes must target the current state",
    );
  }

  const submittedRoot = await computePrincipalMemberEnvelopesRoot(
    input.envelopes,
  );
  if (submittedRoot !== currentState.memberEnvelopesRoot) {
    throwPrincipalPolicyValidationError(
      "invalid_artifact",
      "Principal member envelopes do not match the signed state root",
    );
  }

  const stored = await listPrincipalMemberEnvelopesForState(
    input.principalType,
    input.principalId,
    input.stateHash,
    executor,
  );
  if (stored.length > 0) {
    if ((await computePrincipalMemberEnvelopesRoot(stored)) !== submittedRoot) {
      throwPrincipalPolicyValidationError(
        "state_conflict",
        "Principal member envelope conflict",
      );
    }
    return stored;
  }

  const { stateHash, epoch, recipients } =
    await loadCurrentPrincipalMemberRecipientsForState(
      input.principalType,
      input.principalId,
      executor,
    );

  const rows = buildPrincipalMemberEnvelopeRows({
    envelopes: input.envelopes,
    epoch,
    principalId: input.principalId,
    principalType: input.principalType,
    recipients,
    stateHash,
  });
  return insertAndVerifyPrincipalMemberEnvelopeRows({
    executor,
    expectedCount: input.envelopes.length,
    principalId: input.principalId,
    principalType: input.principalType,
    rows,
    stateHash,
    submittedRoot,
  });
}
