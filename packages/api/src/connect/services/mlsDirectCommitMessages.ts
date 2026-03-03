import { Code, ConnectError } from '@connectrpc/connect';
import type { MlsMessage } from '@tearleads/shared';
import { toIsoString } from './mlsDirectCommon.js';

interface CommitInsertRow {
  sequence_number: number;
  created_at: Date | string;
}

interface TransactionQueryClient {
  query: <RowType>(
    queryText: string,
    values?: readonly unknown[]
  ) => Promise<{ rows: RowType[] }>;
}

interface InsertCommitMessageInput {
  client: TransactionQueryClient;
  commitId: string;
  groupId: string;
  senderUserId: string;
  epoch: number;
  commitCiphertext: string;
}

function buildCommitMessage(input: {
  id: string;
  groupId: string;
  senderUserId: string;
  epoch: number;
  commitCiphertext: string;
  sequenceNumber: number;
  createdAt: Date | string;
}): MlsMessage {
  const createdAt = toIsoString(input.createdAt);
  return {
    id: input.id,
    groupId: input.groupId,
    senderUserId: input.senderUserId,
    epoch: input.epoch,
    ciphertext: input.commitCiphertext,
    messageType: 'commit',
    contentType: 'application/mls-commit',
    sequenceNumber: input.sequenceNumber,
    sentAt: createdAt,
    createdAt
  };
}

export async function insertCommitMessage(
  input: InsertCommitMessageInput
): Promise<MlsMessage> {
  const commitInsertResult = await input.client.query<CommitInsertRow>(
    `INSERT INTO mls_messages (
       id,
       group_id,
       sender_user_id,
       epoch,
       ciphertext,
       message_type,
       sequence_number,
       created_at
     ) VALUES (
       $1,
       $2,
       $3,
       $4,
       $5,
       'commit',
       COALESCE((SELECT MAX(sequence_number) FROM mls_messages WHERE group_id = $2), 0) + 1,
       NOW()
     )
   RETURNING sequence_number, created_at`,
    [
      input.commitId,
      input.groupId,
      input.senderUserId,
      input.epoch,
      input.commitCiphertext
    ]
  );

  const commitRow = commitInsertResult.rows[0];
  if (!commitRow) {
    throw new ConnectError('Failed to persist commit message', Code.Internal);
  }

  return buildCommitMessage({
    id: input.commitId,
    groupId: input.groupId,
    senderUserId: input.senderUserId,
    epoch: input.epoch,
    commitCiphertext: input.commitCiphertext,
    sequenceNumber: commitRow.sequence_number,
    createdAt: commitRow.created_at
  });
}
