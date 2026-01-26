import {
  closeRedisClient,
  getRedisClient,
  type RedisClient
} from '@rapid/shared/redis';
import type { StoredEmail } from '../types/email.js';

const EMAIL_PREFIX = 'smtp:email:';
const EMAIL_LIST_PREFIX = 'smtp:emails:';
const EMAIL_USERS_PREFIX = 'smtp:email:users:';

const getEmailListKey = (userId: string): string =>
  `${EMAIL_LIST_PREFIX}${userId}`;
const getEmailUsersKey = (emailId: string): string =>
  `${EMAIL_USERS_PREFIX}${emailId}`;

export interface EmailStorage {
  store(email: StoredEmail, userIds: string[]): Promise<void>;
  get(id: string): Promise<StoredEmail | null>;
  list(userId: string): Promise<string[]>;
  delete(id: string): Promise<boolean>;
  close(): Promise<void>;
}

export async function createStorage(redisUrl?: string): Promise<EmailStorage> {
  const client: RedisClient = await getRedisClient(redisUrl);

  return {
    async store(email: StoredEmail, userIds: string[]): Promise<void> {
      if (userIds.length === 0) {
        return;
      }
      const key = `${EMAIL_PREFIX}${email.id}`;
      const usersKey = getEmailUsersKey(email.id);
      const multi = client.multi();
      multi.set(key, JSON.stringify(email));
      multi.sAdd(usersKey, userIds);
      for (const userId of userIds) {
        multi.lPush(getEmailListKey(userId), email.id);
      }
      await multi.exec();
    },

    async get(id: string): Promise<StoredEmail | null> {
      const key = `${EMAIL_PREFIX}${id}`;
      const data = await client.get(key);
      if (!data) {
        return null;
      }
      return JSON.parse(data) as StoredEmail;
    },

    async list(userId: string): Promise<string[]> {
      return client.lRange(getEmailListKey(userId), 0, -1);
    },

    async delete(id: string): Promise<boolean> {
      const key = `${EMAIL_PREFIX}${id}`;
      const usersKey = getEmailUsersKey(id);
      const userIds = await client.sMembers(usersKey);
      const multi = client.multi();
      multi.del(key);
      if (userIds.length > 0) {
        for (const userId of userIds) {
          multi.lRem(getEmailListKey(userId), 1, id);
        }
      }
      multi.del(usersKey);
      const results = await multi.exec();
      const deleteResult = results?.[0];
      const deletedCount =
        typeof deleteResult === 'number'
          ? deleteResult
          : Array.isArray(deleteResult) && typeof deleteResult[1] === 'number'
            ? deleteResult[1]
            : 0;
      return deletedCount > 0;
    },

    async close(): Promise<void> {
      await closeRedisClient();
    }
  };
}
