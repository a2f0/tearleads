import type {
  InboundRecipientKeyLookup,
  RecipientKeyRecord
} from './inboundContracts.js';
import { getPostgresPool } from './postgres.js';

interface UserKeyRow {
  user_id: string;
  public_encryption_key: string;
}

export class PostgresInboundRecipientKeyLookup
  implements InboundRecipientKeyLookup
{
  async getPublicEncryptionKeys(
    userIds: string[]
  ): Promise<Map<string, RecipientKeyRecord>> {
    if (userIds.length === 0) {
      return new Map();
    }

    const dedupedUserIds = Array.from(new Set(userIds));
    const pool = await getPostgresPool();
    const result = await pool.query<UserKeyRow>(
      `SELECT user_id, public_encryption_key
       FROM user_keys
       WHERE user_id = ANY($1::text[])`,
      [dedupedUserIds]
    );

    const map = new Map<string, RecipientKeyRecord>();
    for (const row of result.rows) {
      if (!row.user_id || !row.public_encryption_key) {
        continue;
      }
      map.set(row.user_id, {
        userId: row.user_id,
        publicEncryptionKey: row.public_encryption_key
      });
    }
    return map;
  }
}
