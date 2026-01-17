import {
  closeRedisClient,
  getRedisClient,
  type RedisClient
} from '@rapid/shared';
import type { StoredEmail } from '../types/email.js';

const EMAIL_PREFIX = 'smtp:email:';
const EMAIL_LIST_KEY = 'smtp:emails';

export interface EmailStorage {
  store(email: StoredEmail): Promise<void>;
  get(id: string): Promise<StoredEmail | null>;
  list(): Promise<string[]>;
  delete(id: string): Promise<boolean>;
  close(): Promise<void>;
}

export async function createStorage(redisUrl?: string): Promise<EmailStorage> {
  const client: RedisClient = await getRedisClient(redisUrl);

  return {
    async store(email: StoredEmail): Promise<void> {
      const key = `${EMAIL_PREFIX}${email.id}`;
      await client.set(key, JSON.stringify(email));
      await client.lPush(EMAIL_LIST_KEY, email.id);
    },

    async get(id: string): Promise<StoredEmail | null> {
      const key = `${EMAIL_PREFIX}${id}`;
      const data = await client.get(key);
      if (!data) {
        return null;
      }
      return JSON.parse(data) as StoredEmail;
    },

    async list(): Promise<string[]> {
      return client.lRange(EMAIL_LIST_KEY, 0, -1);
    },

    async delete(id: string): Promise<boolean> {
      const key = `${EMAIL_PREFIX}${id}`;
      const deleted = await client.del(key);
      if (deleted > 0) {
        await client.lRem(EMAIL_LIST_KEY, 1, id);
        return true;
      }
      return false;
    },

    async close(): Promise<void> {
      await closeRedisClient();
    }
  };
}
