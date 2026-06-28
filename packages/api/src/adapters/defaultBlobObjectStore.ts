import { S3Client, type S3ClientConfig } from "@aws-sdk/client-s3";
import {
  type BlobObjectStore,
  createMemoryBlobObjectStore,
} from "./blobObjectStore";
import { createS3BlobObjectStore } from "./s3BlobObjectStore";

export type BlobObjectStoreKind = "memory" | "s3";

interface BlobObjectStoreEnv {
  readonly BLOB_OBJECT_STORE?: string | undefined;
  readonly BLOB_OBJECT_STORE_S3_ACCESS_KEY_ID?: string | undefined;
  readonly BLOB_OBJECT_STORE_S3_BUCKET?: string | undefined;
  readonly BLOB_OBJECT_STORE_S3_ENDPOINT?: string | undefined;
  readonly BLOB_OBJECT_STORE_S3_FORCE_PATH_STYLE?: string | undefined;
  readonly BLOB_OBJECT_STORE_S3_KEY_PREFIX?: string | undefined;
  readonly BLOB_OBJECT_STORE_S3_REGION?: string | undefined;
  readonly BLOB_OBJECT_STORE_S3_SECRET_ACCESS_KEY?: string | undefined;
  readonly NODE_ENV?: string | undefined;
  readonly [key: string]: string | undefined;
}

function requireBlobObjectStoreEnv(
  env: BlobObjectStoreEnv,
  key: string,
  message: string,
): string {
  const value = readBlobObjectStoreEnv(env, key);
  if (!value) {
    throw new Error(message);
  }

  return value;
}

function readBlobObjectStoreEnv(
  env: BlobObjectStoreEnv,
  key: string,
): string | undefined {
  const value = env[key];
  if (value && value.trim().length > 0) {
    return value.trim();
  }

  return undefined;
}

export function readBlobObjectStoreKind(
  env: BlobObjectStoreEnv,
): BlobObjectStoreKind {
  const configuredValue = readBlobObjectStoreEnv(env, "BLOB_OBJECT_STORE");
  if (!configuredValue) {
    if (readBlobObjectStoreEnv(env, "NODE_ENV") === "production") {
      throw new Error("BLOB_OBJECT_STORE is required when NODE_ENV=production");
    }

    return "memory";
  }
  const value = configuredValue;
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

function readBlobObjectStoreKeyPrefix(
  env: BlobObjectStoreEnv,
): string | undefined {
  const value = readBlobObjectStoreEnv(env, "BLOB_OBJECT_STORE_S3_KEY_PREFIX");
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
    putObject: (input) =>
      store.putObject({
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
  env: BlobObjectStoreEnv = process.env,
): BlobObjectStore {
  const kind = readBlobObjectStoreKind(env);
  if (kind === "memory") {
    return createMemoryBlobObjectStore();
  }
  const bucket = requireBlobObjectStoreEnv(
    env,
    "BLOB_OBJECT_STORE_S3_BUCKET",
    "BLOB_OBJECT_STORE_S3_BUCKET is required when BLOB_OBJECT_STORE=s3",
  );
  const clientConfig: S3ClientConfig = {
    region: requireBlobObjectStoreEnv(
      env,
      "BLOB_OBJECT_STORE_S3_REGION",
      "BLOB_OBJECT_STORE_S3_REGION is required when BLOB_OBJECT_STORE=s3",
    ),
  };
  const endpoint = readBlobObjectStoreEnv(env, "BLOB_OBJECT_STORE_S3_ENDPOINT");
  if (endpoint !== undefined) {
    clientConfig.endpoint = endpoint;
  }
  const forcePathStyle = readBooleanEnv(
    readBlobObjectStoreEnv(env, "BLOB_OBJECT_STORE_S3_FORCE_PATH_STYLE"),
  );
  if (forcePathStyle !== undefined) {
    clientConfig.forcePathStyle = forcePathStyle;
  }
  const accessKeyId = readBlobObjectStoreEnv(
    env,
    "BLOB_OBJECT_STORE_S3_ACCESS_KEY_ID",
  );
  const secretAccessKey = readBlobObjectStoreEnv(
    env,
    "BLOB_OBJECT_STORE_S3_SECRET_ACCESS_KEY",
  );
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
