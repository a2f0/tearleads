import {
  ListObjectsV2Command,
  type ListObjectsV2CommandInput,
  S3Client,
  type S3ClientConfig,
} from "@aws-sdk/client-s3";

interface RuntimeEnv {
  readonly BLOB_OBJECT_STORE?: string | undefined;
  readonly BLOB_OBJECT_STORE_S3_ACCESS_KEY_ID?: string | undefined;
  readonly BLOB_OBJECT_STORE_S3_BUCKET?: string | undefined;
  readonly BLOB_OBJECT_STORE_S3_ENDPOINT?: string | undefined;
  readonly BLOB_OBJECT_STORE_S3_FORCE_PATH_STYLE?: string | undefined;
  readonly BLOB_OBJECT_STORE_S3_REGION?: string | undefined;
  readonly BLOB_OBJECT_STORE_S3_SECRET_ACCESS_KEY?: string | undefined;
  readonly [key: string]: string | undefined;
}

interface S3BlobStoreListKeysSettings {
  readonly bucket: string;
  readonly clientConfig: S3ClientConfig;
}

interface ListS3BlobStoreKeysInput {
  readonly env?: RuntimeEnv;
  readonly prefix?: string | undefined;
  readonly withSize?: boolean | undefined;
  readonly writeKey?: (key: string, size: number | undefined) => void;
}

function readEnv(env: RuntimeEnv, key: string): string | undefined {
  const value = env[key];
  if (value && value.trim().length > 0) {
    return value.trim();
  }

  return undefined;
}

function requireEnv(env: RuntimeEnv, key: string, message: string): string {
  const value = readEnv(env, key);
  if (!value) {
    throw new Error(message);
  }

  return value;
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

export function readS3BlobStoreListKeysSettings(
  env: RuntimeEnv = process.env,
): S3BlobStoreListKeysSettings {
  const objectStore = readEnv(env, "BLOB_OBJECT_STORE");
  if (objectStore !== "s3") {
    throw new Error("BLOB_OBJECT_STORE must be s3 to list blob store keys");
  }

  const bucket = requireEnv(
    env,
    "BLOB_OBJECT_STORE_S3_BUCKET",
    "BLOB_OBJECT_STORE_S3_BUCKET is required to list blob store keys",
  );
  const clientConfig: S3ClientConfig = {
    region: requireEnv(
      env,
      "BLOB_OBJECT_STORE_S3_REGION",
      "BLOB_OBJECT_STORE_S3_REGION is required to list blob store keys",
    ),
  };
  const endpoint = readEnv(env, "BLOB_OBJECT_STORE_S3_ENDPOINT");
  if (endpoint !== undefined) {
    clientConfig.endpoint = endpoint;
  }

  const forcePathStyle = readBooleanEnv(
    readEnv(env, "BLOB_OBJECT_STORE_S3_FORCE_PATH_STYLE"),
  );
  if (forcePathStyle !== undefined) {
    clientConfig.forcePathStyle = forcePathStyle;
  }

  const accessKeyId = readEnv(env, "BLOB_OBJECT_STORE_S3_ACCESS_KEY_ID");
  const secretAccessKey = readEnv(
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

  return { bucket, clientConfig };
}

export function formatBlobStoreKeyLine(
  key: string,
  size: number | undefined,
  withSize: boolean,
): string {
  return withSize ? `${size ?? ""}\t${key}` : key;
}

export async function listS3BlobStoreKeys({
  env = process.env,
  prefix,
  withSize = false,
  writeKey = (key, size) => {
    process.stdout.write(`${formatBlobStoreKeyLine(key, size, withSize)}\n`);
  },
}: ListS3BlobStoreKeysInput = {}): Promise<void> {
  const { bucket, clientConfig } = readS3BlobStoreListKeysSettings(env);
  const client = new S3Client(clientConfig);
  let continuationToken: string | undefined;

  do {
    const input: ListObjectsV2CommandInput = { Bucket: bucket };
    if (prefix) {
      input.Prefix = prefix;
    }
    if (continuationToken) {
      input.ContinuationToken = continuationToken;
    }

    const response = await client.send(new ListObjectsV2Command(input));
    for (const object of response.Contents ?? []) {
      if (object.Key) {
        writeKey(object.Key, object.Size);
      }
    }

    continuationToken = response.IsTruncated
      ? response.NextContinuationToken
      : undefined;
    if (response.IsTruncated && !continuationToken) {
      throw new Error(
        "S3 list response was truncated without a continuation token",
      );
    }
  } while (continuationToken);
}
