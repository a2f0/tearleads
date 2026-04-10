import { wrapDekForRecipients } from "@tearleads/crypto";
import type { PublicKeyRequest } from "@tearleads/validators/request";
import { db as defaultDb } from "../../src/adapters/postgres";
import type { ApiServiceRuntime } from "../../src/services/runtime";
import type { TestUser } from "./createTestUser";

export function createServiceTestRuntime(
  db: ApiServiceRuntime["db"] = defaultDb,
): ApiServiceRuntime {
  const values = new Map<string, string>();

  return {
    db,
    eventPublisher: {
      publish: async () => {},
    },
    keyValueStore: {
      del: async (key) => {
        values.delete(key);
      },
      get: async (key) => values.get(key) ?? null,
      set: async (key, value) => {
        values.set(key, value);
      },
    },
    principalSignerTrustStore: {
      getTrustedSignerPublicKey: async () => null,
    },
    sessionTokenIssuer: {
      createSession: async () => "test-session",
    },
  };
}

export async function createPublicKeyRequest(
  user: TestUser,
): Promise<PublicKeyRequest> {
  const dek = crypto.getRandomValues(new Uint8Array(32));
  const [wrappedDekEnvelope] = await wrapDekForRecipients(dek, [
    user.kem.publicKey,
  ]);

  if (!wrappedDekEnvelope) {
    throw new Error("Failed to wrap DEK for test user");
  }

  return {
    rootContainerId: crypto.randomUUID(),
    signingPublicKey: Array.from(user.signing.signingPublicKey),
    encapsulationPublicKey: Array.from(user.kem.publicKey),
    initialRootMetadataUpdates: [],
    wrappedDekEnvelope: {
      keyFingerprint: wrappedDekEnvelope.keyFingerprint,
      kemCipherText: Array.from(wrappedDekEnvelope.kemCipherText),
      wrappedKey: Array.from(wrappedDekEnvelope.wrappedKey),
    },
  };
}

export function createRecordingDb(): {
  calls: ReadonlyMap<string, number>;
  db: ApiServiceRuntime["db"];
} {
  const calls = new Map<string, number>();
  const db = new Proxy(defaultDb, {
    get(target, property, receiver) {
      const value = Reflect.get(target, property, receiver);

      if (typeof property !== "string" || typeof value !== "function") {
        return value;
      }

      return (...args: unknown[]) => {
        calls.set(property, (calls.get(property) ?? 0) + 1);
        return Reflect.apply(value, target, args);
      };
    },
  }) as ApiServiceRuntime["db"];

  return { calls, db };
}
