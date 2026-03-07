import type { MlsMessage } from '@tearleads/shared';
import { toIsoString } from './mlsDirectCommon.js';
import {
  persistMlsMessageToVfs,
  type QueryClient,
  toPositiveInteger
} from './mlsDirectMessagesShared.js';

interface CommitMaxSequenceRow {
  sequence_number: string | number | null;
}

interface InsertCommitMessageInput {
  client: QueryClient;
  commitId: string;
  groupId: string;
  organizationId: string;
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
  const maxSequenceResult = await input.client.query<CommitMaxSequenceRow>(
    `WITH sequences AS (
       SELECT
         CASE
           WHEN split_part(source_id, ':', 3) ~ '^[0-9]+$'
           THEN split_part(source_id, ':', 3)::integer
           ELSE NULL
         END AS sequence_number
       FROM vfs_crdt_ops
      WHERE op_type = 'item_upsert'
        AND source_table = 'mls_commit'
        AND split_part(source_id, ':', 2) = $1::text
    )
    SELECT sequence_number
      FROM sequences
      ORDER BY sequence_number DESC NULLS LAST
      LIMIT 1`,
    [input.groupId]
  );

  const sequenceNumber =
    toPositiveInteger(maxSequenceResult.rows[0]?.sequence_number ?? 0) + 1;
  const occurredAtIso = new Date().toISOString();

  await persistMlsMessageToVfs(input.client, {
    messageId: input.commitId,
    groupId: input.groupId,
    organizationId: input.organizationId,
    senderUserId: input.senderUserId,
    ciphertext: input.commitCiphertext,
    contentType: 'application/mls-commit',
    epoch: input.epoch,
    occurredAtIso,
    sequenceNumber,
    sourceTable: 'mls_commit'
  });

  return buildCommitMessage({
    id: input.commitId,
    groupId: input.groupId,
    senderUserId: input.senderUserId,
    epoch: input.epoch,
    commitCiphertext: input.commitCiphertext,
    sequenceNumber,
    createdAt: occurredAtIso
  });
}
