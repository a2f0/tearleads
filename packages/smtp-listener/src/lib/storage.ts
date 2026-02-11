import {
  closeRedisClient,
  getRedisClient,
  type RedisClient
} from '@tearleads/shared/redis';
import type { StoredEmail } from '../types/email.js';

const EMAIL_PREFIX = 'smtp:email:';
const EMAIL_LIST_PREFIX = 'smtp:emails:';
const EMAIL_USERS_PREFIX = 'smtp:email:users:';

const getEmailListKey = (userId: string): string =>
  `${EMAIL_LIST_PREFIX}${userId}`;
const getEmailUsersKey = (emailId: string): string =>
  `${EMAIL_USERS_PREFIX}${emailId}`;

const EMAIL_DELETE_SCRIPT = `
local usersKey = KEYS[1]
local emailKey = KEYS[2]
local listPrefix = ARGV[1]
local emailId = ARGV[2]

local users = redis.call('SMEMBERS', usersKey)
for i, userId in ipairs(users) do
  redis.call('LREM', listPrefix .. userId, 1, emailId)
end

local deleted = redis.call('DEL', emailKey)
redis.call('DEL', usersKey)

return deleted
`;

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
      const result = await client.eval(EMAIL_DELETE_SCRIPT, {
        keys: [usersKey, key],
        arguments: [EMAIL_LIST_PREFIX, id]
      });
      return result === 1;
    },

    async close(): Promise<void> {
      await closeRedisClient();
    }
  };
}
