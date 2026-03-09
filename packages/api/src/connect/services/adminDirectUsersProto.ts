import { create } from '@bufbuild/protobuf';
import type { AdminUser } from '@tearleads/shared/gen/tearleads/v2/admin_pb';
import {
  AdminUserAccountingSchema,
  AdminUserSchema
} from '@tearleads/shared/gen/tearleads/v2/admin_pb';
import { mapUserRow, type UserRow } from './adminDirectUsersShared.js';

export function toAdminUser(
  row: UserRow,
  overrides: Parameters<typeof mapUserRow>[1] = {}
): AdminUser {
  const mappedUser = mapUserRow(row, overrides);

  return create(AdminUserSchema, {
    id: mappedUser.id,
    email: mappedUser.email,
    emailConfirmed: mappedUser.emailConfirmed,
    admin: mappedUser.admin,
    organizationIds: mappedUser.organizationIds,
    ...(typeof mappedUser.createdAt === 'string'
      ? { createdAt: mappedUser.createdAt }
      : {}),
    ...(typeof mappedUser.lastActiveAt === 'string'
      ? { lastActiveAt: mappedUser.lastActiveAt }
      : {}),
    accounting: create(AdminUserAccountingSchema, {
      totalPromptTokens: BigInt(mappedUser.accounting.totalPromptTokens),
      totalCompletionTokens: BigInt(
        mappedUser.accounting.totalCompletionTokens
      ),
      totalTokens: BigInt(mappedUser.accounting.totalTokens),
      requestCount: BigInt(mappedUser.accounting.requestCount),
      ...(typeof mappedUser.accounting.lastUsedAt === 'string'
        ? { lastUsedAt: mappedUser.accounting.lastUsedAt }
        : {})
    }),
    disabled: mappedUser.disabled,
    ...(typeof mappedUser.disabledAt === 'string'
      ? { disabledAt: mappedUser.disabledAt }
      : {}),
    ...(typeof mappedUser.disabledBy === 'string'
      ? { disabledBy: mappedUser.disabledBy }
      : {}),
    ...(typeof mappedUser.markedForDeletionAt === 'string'
      ? { markedForDeletionAt: mappedUser.markedForDeletionAt }
      : {}),
    ...(typeof mappedUser.markedForDeletionBy === 'string'
      ? { markedForDeletionBy: mappedUser.markedForDeletionBy }
      : {})
  });
}
