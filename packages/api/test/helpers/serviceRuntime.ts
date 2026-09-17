import { db as defaultDb } from "@tearleads/api-shared/postgres";
import type { TestUser } from "@tearleads/bob-and-alice";
import type { RegistrationRequest } from "@tearleads/validators/request";
import {
  type BlobObjectStore,
  createMemoryBlobObjectStore,
} from "../../src/adapters/blobObjectStore";
import type { ApiServiceRuntime } from "../../src/services/runtime";
import { createRegistrationRequestBody } from "./api/submitRegistration";

export function createServiceTestRuntime(
  db: ApiServiceRuntime["db"] = defaultDb,
  overrides: {
    readonly blobObjectStore?: BlobObjectStore;
  } = {},
): ApiServiceRuntime {
  const values = new Map<string, string>();

  return {
    blobObjectStore: overrides.blobObjectStore ?? createMemoryBlobObjectStore(),
    db,
    documentSyncCursorHmacKey: "tearleads-test-document-sync-cursor-hmac-key",
    eventPublisher: {
      publish: async () => {},
    },
    keyValueStore: {
      del: async (key) => {
        values.delete(key);
      },
      get: async (key) => values.get(key) ?? null,
      getdel: async (key) => {
        const value = values.get(key) ?? null;
        values.delete(key);
        return value;
      },
      set: async (key, value) => {
        values.set(key, value);
      },
    },
    sessionTokenIssuer: {
      createSession: async () => "test-session",
    },
  };
}

export function createFailingRuntime(
  onPublish?: (event: Record<string, unknown>) => void,
  db: ApiServiceRuntime["db"] = defaultDb,
): ApiServiceRuntime {
  return {
    ...createServiceTestRuntime(db),
    eventPublisher: {
      publish: async (event) => {
        onPublish?.(event);
        throw new Error("broker unavailable");
      },
    },
  };
}

export async function createRegistrationRequest(
  user: TestUser,
): Promise<RegistrationRequest> {
  return createRegistrationRequestBody(
    user.signing.signingPublicKey,
    user.signing.signingPrivateKey,
    user.kem.publicKey,
    { userId: user.userId || crypto.randomUUID() },
  );
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
