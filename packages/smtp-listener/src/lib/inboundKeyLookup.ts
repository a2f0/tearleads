import type {
  InboundRecipientKeyLookup,
  RecipientKeyRecord
} from '../types/inboundContracts.js';
import { getPostgresPool } from './postgres.js';

interface UserKeyRow {
  user_id: string;
  public_encryption_key: string;
  personal_organization_id: string;
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
      `SELECT uk.user_id, uk.public_encryption_key, u.personal_organization_id
       FROM user_keys uk
       JOIN users u ON u.id = uk.user_id
       WHERE uk.user_id = ANY($1::text[])`,
      [dedupedUserIds]
    );

    const map = new Map<string, RecipientKeyRecord>();
    for (const row of result.rows) {
      if (!row.user_id || !row.public_encryption_key) {
        continue;
      }
      map.set(row.user_id, {
        userId: row.user_id,
        publicEncryptionKey: row.public_encryption_key,
        organizationId: row.personal_organization_id
      });
    }
    return map;
  }
}
