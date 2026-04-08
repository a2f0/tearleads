import { base64ToBytes } from "@tearleads/encoding";
import { db } from "../adapters/postgres";
import { del, get, set } from "../adapters/redis";
import { publish } from "../adapters/redisPubSub";
import { createSession } from "../middleware/session";
import type { SessionData } from "../validators/session";

export interface KeyValueStore {
  del: (key: string) => Promise<void>;
  get: (key: string) => Promise<string | null>;
  set: (key: string, value: string, ttlSeconds?: number) => Promise<void>;
}

export interface EventPublisher {
  publish: (event: Record<string, unknown>) => Promise<void>;
}

export interface SessionTokenIssuer {
  createSession: (data: SessionData) => Promise<string>;
}

export interface PrincipalSignerTrustStore {
  getTrustedSignerPublicKey: (
    signerKeyId: string,
  ) => Promise<Uint8Array | null>;
}

export interface ApiServiceRuntime {
  db: typeof db;
  eventPublisher: EventPublisher;
  keyValueStore: KeyValueStore;
  principalSignerTrustStore: PrincipalSignerTrustStore;
  sessionTokenIssuer: SessionTokenIssuer;
}

export const TRUSTED_POLICY_SIGNERS_ENV_VAR =
  "TEARLEADS_TRUSTED_POLICY_SIGNERS";

let cachedTrustedPolicySignersEnvRaw: string | null = null;
let cachedTrustedPolicySigners = new Map<string, Uint8Array>();

function isTrustedPolicySignersRecord(
  value: unknown,
): value is Record<string, string> {
  if (typeof value !== "object" || value === null || Array.isArray(value)) {
    return false;
  }

  return Object.entries(value).every(
    ([key, entry]) => key.length > 0 && typeof entry === "string",
  );
}

function getTrustedPolicySignersFromEnv(): Map<string, Uint8Array> {
  const envRaw = process.env[TRUSTED_POLICY_SIGNERS_ENV_VAR] ?? "";

  if (cachedTrustedPolicySignersEnvRaw === envRaw) {
    return cachedTrustedPolicySigners;
  }

  if (envRaw.length === 0) {
    cachedTrustedPolicySignersEnvRaw = envRaw;
    cachedTrustedPolicySigners = new Map();
    return cachedTrustedPolicySigners;
  }

  let parsedValue: unknown;

  try {
    parsedValue = JSON.parse(envRaw);
  } catch {
    throw new Error(
      `${TRUSTED_POLICY_SIGNERS_ENV_VAR} must be valid JSON when configured`,
    );
  }

  if (!isTrustedPolicySignersRecord(parsedValue)) {
    throw new Error(
      `${TRUSTED_POLICY_SIGNERS_ENV_VAR} must be a JSON object of signer ids to base64-encoded public keys`,
    );
  }

  cachedTrustedPolicySignersEnvRaw = envRaw;
  cachedTrustedPolicySigners = new Map(
    Object.entries(parsedValue).map(([signerKeyId, publicKeyBase64]) => [
      signerKeyId,
      base64ToBytes(publicKeyBase64),
    ]),
  );

  return cachedTrustedPolicySigners;
}

export const defaultApiServiceRuntime: ApiServiceRuntime = {
  db,
  eventPublisher: { publish },
  keyValueStore: { del, get, set },
  principalSignerTrustStore: {
    getTrustedSignerPublicKey: async (signerKeyId: string) =>
      getTrustedPolicySignersFromEnv().get(signerKeyId) ?? null,
  },
  sessionTokenIssuer: { createSession },
};
