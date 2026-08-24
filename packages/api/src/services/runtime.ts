import { Buffer } from "node:buffer";
import { db } from "@symcrypt/api-shared/postgres";
import type { BlobObjectStore } from "../adapters/blobObjectStore";
import { createDefaultBlobObjectStore } from "../adapters/defaultBlobObjectStore";
import { del, get, getdel, set } from "../adapters/redis";
import { publish } from "../adapters/redisPubSub";
import { createSession } from "../middleware/session";
import type { SessionCreateInput } from "../validators/session";

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
  createSession: (data: SessionCreateInput) => Promise<string>;
}

export interface ApiServiceRuntime {
  blobObjectStore: BlobObjectStore;
  db: typeof db;
  documentSyncCursorHmacKey: string;
  eventPublisher: EventPublisher;
  keyValueStore: KeyValueStore;
  sessionTokenIssuer: SessionTokenIssuer;
}

const DOCUMENT_SYNC_CURSOR_HMAC_KEY_ENV =
  "DOCUMENT_SYNC_CURSOR_HMAC_KEY" as const;
const DEVELOPMENT_DOCUMENT_SYNC_CURSOR_HMAC_KEY =
  "symcrypt-development-document-sync-cursor-key";

export function readDocumentSyncCursorHmacKey(
  env: NodeJS.ProcessEnv = process.env,
): string {
  const configured = env[DOCUMENT_SYNC_CURSOR_HMAC_KEY_ENV]?.trim();
  if (configured) {
    if (Buffer.byteLength(configured, "utf8") < 32) {
      throw new Error(
        `${DOCUMENT_SYNC_CURSOR_HMAC_KEY_ENV} must be at least 32 bytes`,
      );
    }
    return configured;
  }
  if (env.NODE_ENV?.trim() === "production") {
    throw new Error(
      `${DOCUMENT_SYNC_CURSOR_HMAC_KEY_ENV} is required when NODE_ENV=production`,
    );
  }
  return DEVELOPMENT_DOCUMENT_SYNC_CURSOR_HMAC_KEY;
}

function buildDefaultApiServiceRuntime(): ApiServiceRuntime {
  return {
    blobObjectStore: createDefaultBlobObjectStore(),
    db,
    documentSyncCursorHmacKey: readDocumentSyncCursorHmacKey(),
    eventPublisher: { publish },
    keyValueStore: { del, get, getdel, set },
    sessionTokenIssuer: { createSession },
  };
}

let memoizedDefaultApiServiceRuntime: ApiServiceRuntime | undefined;

/**
 * The process-wide default runtime, built on first use rather than at module
 * import — so importing this module (for its types or `createSession`) does not
 * construct an S3 client or read blob-store env. The build happens once at
 * composition-root assembly and is shared thereafter.
 */
export function getDefaultApiServiceRuntime(): ApiServiceRuntime {
  memoizedDefaultApiServiceRuntime ??= buildDefaultApiServiceRuntime();
  return memoizedDefaultApiServiceRuntime;
}
