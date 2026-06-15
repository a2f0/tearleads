import { S3Client, type S3ClientConfig } from "@aws-sdk/client-s3";
import { db } from "@tearleads/api-shared/postgres";
import {
  type BlobObjectStore,
  createMemoryBlobObjectStore,
} from "../adapters/blobObjectStore";
import { del, get, getdel, set } from "../adapters/redis";
import { publish } from "../adapters/redisPubSub";
import { createS3BlobObjectStore } from "../adapters/s3BlobObjectStore";
import { createSession } from "../middleware/session";
import type { SessionCreateInput } from "../validators/session";

interface RuntimeEnv {
  readonly BLOB_OBJECT_STORE?: string | undefined;
  readonly BLOB_OBJECT_STORE_S3_ACCESS_KEY_ID?: string | undefined;
  readonly BLOB_OBJECT_STORE_S3_BUCKET?: string | undefined;
  readonly BLOB_OBJECT_STORE_S3_ENDPOINT?: string | undefined;
  readonly BLOB_OBJECT_STORE_S3_FORCE_PATH_STYLE?: string | undefined;
  readonly BLOB_OBJECT_STORE_S3_KEY_PREFIX?: string | undefined;
  readonly BLOB_OBJECT_STORE_S3_REGION?: string | undefined;
  readonly BLOB_OBJECT_STORE_S3_SECRET_ACCESS_KEY?: string | undefined;
  readonly VFS_BLOB_STORE_PROVIDER?: string | undefined;
  readonly VFS_BLOB_S3_ACCESS_KEY_ID?: string | undefined;
  readonly VFS_BLOB_S3_BUCKET?: string | undefined;
  readonly VFS_BLOB_S3_ENDPOINT?: string | undefined;
  readonly VFS_BLOB_S3_FORCE_PATH_STYLE?: string | undefined;
  readonly VFS_BLOB_S3_KEY_PREFIX?: string | undefined;
  readonly VFS_BLOB_S3_REGION?: string | undefined;
  readonly VFS_BLOB_S3_SECRET_ACCESS_KEY?: string | undefined;
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
  createSession: (data: SessionCreateInput) => Promise<string>;
}

export interface ApiServiceRuntime {
  blobObjectStore: BlobObjectStore;
  blobObjectStoreKind: BlobObjectStoreKind;
  db: typeof db;
  eventPublisher: EventPublisher;
  keyValueStore: KeyValueStore;
  sessionTokenIssuer: SessionTokenIssuer;
}

export type BlobObjectStoreKind = "memory" | "s3";

function requireRuntimeEnv(
  env: RuntimeEnv,
  keys: readonly string[],
  message: string,
): string {
  const value = readRuntimeEnv(env, keys);
  if (!value) {
    throw new Error(message);
  }

  return value;
}

function readRuntimeEnv(
  env: RuntimeEnv,
  keys: readonly string[],
): string | undefined {
  for (const key of keys) {
    const value = env[key];
    if (value && value.trim().length > 0) {
      return value.trim();
    }
  }

  return undefined;
}

function readBlobObjectStoreKind(env: RuntimeEnv): BlobObjectStoreKind {
  const value =
    readRuntimeEnv(env, ["BLOB_OBJECT_STORE", "VFS_BLOB_STORE_PROVIDER"]) ??
    "memory";
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

function readBlobObjectStoreKeyPrefix(env: RuntimeEnv): string | undefined {
  const value = readRuntimeEnv(env, [
    "BLOB_OBJECT_STORE_S3_KEY_PREFIX",
    "VFS_BLOB_S3_KEY_PREFIX",
  ]);
  if (!value) {
    return undefined;
  }

  const normalized = value.replace(/^\/+|\/+$/g, "");
  return normalized.length > 0 ? normalized : undefined;
}

function prefixBlobObjectKey(prefix: string, key: string): string {
  return `${prefix}/${key}`;
}

function createPrefixedBlobObjectStore(
  store: BlobObjectStore,
  prefix: string | undefined,
): BlobObjectStore {
  if (!prefix) {
    return store;
  }

  return {
    abortMultipartUpload: (input) =>
      store.abortMultipartUpload({
        ...input,
        key: prefixBlobObjectKey(prefix, input.key),
      }),
    completeMultipartUpload: (input) =>
      store.completeMultipartUpload({
        ...input,
        key: prefixBlobObjectKey(prefix, input.key),
      }),
    createMultipartUpload: (input) =>
      store.createMultipartUpload({
        ...input,
        key: prefixBlobObjectKey(prefix, input.key),
      }),
    deleteObject: (key) => store.deleteObject(prefixBlobObjectKey(prefix, key)),
    getObjectStream: (key) =>
      store.getObjectStream(prefixBlobObjectKey(prefix, key)),
    listParts: (input) =>
      store.listParts({
        ...input,
        key: prefixBlobObjectKey(prefix, input.key),
      }),
    uploadPart: (input) =>
      store.uploadPart({
        ...input,
        key: prefixBlobObjectKey(prefix, input.key),
      }),
  };
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
    ["BLOB_OBJECT_STORE_S3_BUCKET", "VFS_BLOB_S3_BUCKET"],
    "BLOB_OBJECT_STORE_S3_BUCKET is required when BLOB_OBJECT_STORE=s3",
  );
  const clientConfig: S3ClientConfig = {
    region: requireRuntimeEnv(
      env,
      ["BLOB_OBJECT_STORE_S3_REGION", "VFS_BLOB_S3_REGION"],
      "BLOB_OBJECT_STORE_S3_REGION is required when BLOB_OBJECT_STORE=s3",
    ),
  };
  const endpoint = readRuntimeEnv(env, [
    "BLOB_OBJECT_STORE_S3_ENDPOINT",
    "VFS_BLOB_S3_ENDPOINT",
  ]);
  if (endpoint !== undefined) {
    clientConfig.endpoint = endpoint;
  }
  const forcePathStyle = readBooleanEnv(
    readRuntimeEnv(env, [
      "BLOB_OBJECT_STORE_S3_FORCE_PATH_STYLE",
      "VFS_BLOB_S3_FORCE_PATH_STYLE",
    ]),
  );
  if (forcePathStyle !== undefined) {
    clientConfig.forcePathStyle = forcePathStyle;
  }
  const accessKeyId = readRuntimeEnv(env, [
    "BLOB_OBJECT_STORE_S3_ACCESS_KEY_ID",
    "VFS_BLOB_S3_ACCESS_KEY_ID",
  ]);
  const secretAccessKey = readRuntimeEnv(env, [
    "BLOB_OBJECT_STORE_S3_SECRET_ACCESS_KEY",
    "VFS_BLOB_S3_SECRET_ACCESS_KEY",
  ]);
  if (accessKeyId || secretAccessKey) {
    if (!accessKeyId || !secretAccessKey) {
      throw new Error(
        "Both BLOB_OBJECT_STORE_S3_ACCESS_KEY_ID and BLOB_OBJECT_STORE_S3_SECRET_ACCESS_KEY are required when either is set",
      );
    }

    clientConfig.credentials = { accessKeyId, secretAccessKey };
  }

  return createPrefixedBlobObjectStore(
    createS3BlobObjectStore({
      bucket,
      client: new S3Client(clientConfig),
    }),
    readBlobObjectStoreKeyPrefix(env),
  );
}

export const defaultApiServiceRuntime: ApiServiceRuntime = {
  blobObjectStore: createDefaultBlobObjectStore(),
  blobObjectStoreKind: readBlobObjectStoreKind(process.env),
  db,
  eventPublisher: { publish },
  keyValueStore: { del, get, getdel, set },
  sessionTokenIssuer: { createSession },
};
