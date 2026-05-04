import { db } from "../adapters/postgres";
import { del, get, getdel, set } from "../adapters/redis";
import { publish } from "../adapters/redisPubSub";
import { createSession } from "../middleware/session";
import type { SessionData } from "../validators/session";

export interface KeyValueStore {
  del: (key: string) => Promise<void>;
  get: (key: string) => Promise<string | null>;
  getdel: (key: string) => Promise<string | null>;
  set: (key: string, value: string, ttlSeconds?: number) => Promise<void>;
}

export interface EventPublisher {
  publish: (event: Record<string, unknown>) => Promise<void>;
}

export interface SessionTokenIssuer {
  createSession: (data: SessionData) => Promise<string>;
}

export interface ApiServiceRuntime {
  db: typeof db;
  eventPublisher: EventPublisher;
  keyValueStore: KeyValueStore;
  sessionTokenIssuer: SessionTokenIssuer;
}

export const defaultApiServiceRuntime: ApiServiceRuntime = {
  db,
  eventPublisher: { publish },
  keyValueStore: { del, get, getdel, set },
  sessionTokenIssuer: { createSession },
};
