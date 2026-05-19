import { S3Client, type S3ClientConfig } from "@aws-sdk/client-s3";
import {
  type BlobObjectStore,
  createMemoryBlobObjectStore,
} from "../adapters/blobObjectStore";
import { db } from "../adapters/postgres";
import { del, get, getdel, set } from "../adapters/redis";
import { publish } from "../adapters/redisPubSub";
import { createS3BlobObjectStore } from "../adapters/s3BlobObjectStore";
import { createSession } from "../middleware/session";
import type { SessionData } from "../validators/session";

interface RuntimeEnv {
  readonly BLOB_OBJECT_STORE?: string | undefined;
  readonly BLOB_OBJECT_STORE_S3_BUCKET?: string | undefined;
  readonly BLOB_OBJECT_STORE_S3_ENDPOINT?: string | undefined;
  readonly BLOB_OBJECT_STORE_S3_FORCE_PATH_STYLE?: string | undefined;
  readonly BLOB_OBJECT_STORE_S3_REGION?: string | undefined;
  readonly [key: string]: string | undefined;
}

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
  blobObjectStore: BlobObjectStore;
  db: typeof db;
  eventPublisher: EventPublisher;
  keyValueStore: KeyValueStore;
  sessionTokenIssuer: SessionTokenIssuer;
}

type BlobObjectStoreKind = "memory" | "s3";

function requireRuntimeEnv(
  env: RuntimeEnv,
  key: string,
  message: string,
): string {
  const value = env[key];
  if (!value) {
    throw new Error(message);
  }

  return value;
}

function readBlobObjectStoreKind(env: RuntimeEnv): BlobObjectStoreKind {
  const value = env.BLOB_OBJECT_STORE ?? "memory";
  if (value === "memory" || value === "s3") {
    return value;
  }

  throw new Error(`Unsupported BLOB_OBJECT_STORE value: ${value}`);
}

function readBooleanEnv(value: string | undefined): boolean | undefined {
  if (value === undefined) {
    return undefined;
  }
  if (value === "1" || value.toLowerCase() === "true") {
    return true;
  }
  if (value === "0" || value.toLowerCase() === "false") {
    return false;
  }

  throw new Error(`Invalid boolean environment value: ${value}`);
}

export function createDefaultBlobObjectStore(
  env: RuntimeEnv = process.env,
): BlobObjectStore {
  const kind = readBlobObjectStoreKind(env);
  if (kind === "memory") {
    return createMemoryBlobObjectStore();
  }
  const bucket = requireRuntimeEnv(
    env,
    "BLOB_OBJECT_STORE_S3_BUCKET",
    "BLOB_OBJECT_STORE_S3_BUCKET is required when BLOB_OBJECT_STORE=s3",
  );
  const clientConfig: S3ClientConfig = {
    region: requireRuntimeEnv(
      env,
      "BLOB_OBJECT_STORE_S3_REGION",
      "BLOB_OBJECT_STORE_S3_REGION is required when BLOB_OBJECT_STORE=s3",
    ),
  };
  const endpoint = env.BLOB_OBJECT_STORE_S3_ENDPOINT;
  if (endpoint !== undefined) {
    clientConfig.endpoint = endpoint;
  }
  const forcePathStyle = readBooleanEnv(
    env.BLOB_OBJECT_STORE_S3_FORCE_PATH_STYLE,
  );
  if (forcePathStyle !== undefined) {
    clientConfig.forcePathStyle = forcePathStyle;
  }

  return createS3BlobObjectStore({
    bucket,
    client: new S3Client(clientConfig),
  });
}

export const defaultApiServiceRuntime: ApiServiceRuntime = {
  blobObjectStore: createDefaultBlobObjectStore(),
  db,
  eventPublisher: { publish },
  keyValueStore: { del, get, getdel, set },
  sessionTokenIssuer: { createSession },
};
