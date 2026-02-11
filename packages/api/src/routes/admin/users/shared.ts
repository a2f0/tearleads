import type {
  AdminUser,
  AdminUserAccounting,
  AdminUserUpdatePayload
} from '@tearleads/shared';
import { isRecord } from '@tearleads/shared';
import type { getPostgresPool } from '../../../lib/postgres.js';

export type UserRow = {
  id: string;
  email: string;
  email_confirmed: boolean;
  admin: boolean;
  organization_ids: string[] | null;
  created_at?: Date | string | null;
};

type AdminUserOverrides = {
  createdAt?: string | null;
  lastActiveAt?: string | null;
  accounting?: AdminUserAccounting;
};

type UserUsageRow = {
  user_id: string;
  total_prompt_tokens: string;
  total_completion_tokens: string;
  total_tokens: string;
  request_count: string;
  last_used_at: Date | null;
};

export const emptyAccounting: AdminUserAccounting = {
  totalPromptTokens: 0,
  totalCompletionTokens: 0,
  totalTokens: 0,
  requestCount: 0,
  lastUsedAt: null
};

function normalizeDate(value: Date | string | null | undefined): string | null {
  if (!value) return null;
  if (value instanceof Date) return value.toISOString();
  if (typeof value === 'string') return value;
  return null;
}

export function mapUserRow(
  row: UserRow,
  overrides: AdminUserOverrides = {}
): AdminUser {
  return {
    id: row.id,
    email: row.email,
    emailConfirmed: row.email_confirmed,
    admin: row.admin,
    organizationIds: Array.isArray(row.organization_ids)
      ? row.organization_ids
      : [],
    createdAt: overrides.createdAt ?? normalizeDate(row.created_at),
    lastActiveAt: overrides.lastActiveAt ?? null,
    accounting: overrides.accounting ?? emptyAccounting
  };
}

function mapUsageRow(row: UserUsageRow): AdminUserAccounting {
  return {
    totalPromptTokens: parseInt(row.total_prompt_tokens, 10),
    totalCompletionTokens: parseInt(row.total_completion_tokens, 10),
    totalTokens: parseInt(row.total_tokens, 10),
    requestCount: parseInt(row.request_count, 10),
    lastUsedAt: row.last_used_at?.toISOString() ?? null
  };
}

export async function getUserAccounting(
  pool: Awaited<ReturnType<typeof getPostgresPool>>,
  userIds: string[]
): Promise<Record<string, AdminUserAccounting>> {
  if (userIds.length === 0) {
    return {};
  }

  const usageResult = await pool.query<UserUsageRow>(
    `SELECT
       user_id,
       COALESCE(SUM(prompt_tokens), 0) AS total_prompt_tokens,
       COALESCE(SUM(completion_tokens), 0) AS total_completion_tokens,
       COALESCE(SUM(total_tokens), 0) AS total_tokens,
       COUNT(*) AS request_count,
       MAX(created_at) AS last_used_at
     FROM ai_usage
     WHERE user_id = ANY($1::text[])
     GROUP BY user_id`,
    [userIds]
  );

  return usageResult.rows.reduce<Record<string, AdminUserAccounting>>(
    (acc, row) => {
      acc[row.user_id] = mapUsageRow(row);
      return acc;
    },
    {}
  );
}

export function parseUserUpdatePayload(
  body: unknown
): AdminUserUpdatePayload | null {
  if (!isRecord(body)) {
    return null;
  }

  const updates: AdminUserUpdatePayload = {};

  if ('email' in body) {
    const emailValue = body['email'];
    if (typeof emailValue !== 'string') {
      return null;
    }
    const trimmedEmail = emailValue.trim().toLowerCase();
    if (!trimmedEmail) {
      return null;
    }
    updates.email = trimmedEmail;
  }

  if ('emailConfirmed' in body) {
    const emailConfirmedValue = body['emailConfirmed'];
    if (typeof emailConfirmedValue !== 'boolean') {
      return null;
    }
    updates.emailConfirmed = emailConfirmedValue;
  }

  if ('admin' in body) {
    const adminValue = body['admin'];
    if (typeof adminValue !== 'boolean') {
      return null;
    }
    updates.admin = adminValue;
  }

  if ('organizationIds' in body) {
    const orgsValue = body['organizationIds'];
    if (!Array.isArray(orgsValue)) {
      return null;
    }

    const trimmed: string[] = [];
    for (const entry of orgsValue) {
      if (typeof entry !== 'string') {
        return null;
      }
      const cleaned = entry.trim();
      if (cleaned) {
        trimmed.push(cleaned);
      }
    }

    updates.organizationIds = Array.from(new Set(trimmed));
  }

  if (Object.keys(updates).length === 0) {
    return null;
  }

  return updates;
}
