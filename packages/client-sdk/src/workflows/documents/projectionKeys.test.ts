import { expect, test } from "bun:test";
import { toFingerprint } from "@tearleads/crypto";
import {
  createDocumentProjectionUserKeyResolver,
  type DocumentProjectionKeyRuntime,
  didDocumentProjectionKeyRuntimeChange,
} from "./projectionKeys";

function createRuntime(
  patch: Partial<DocumentProjectionKeyRuntime> = {},
): DocumentProjectionKeyRuntime {
  return {
    apiClient: {
      getEncapsulationKey: async () => null,
    },
    auth: {
      userId: null,
      ...patch.auth,
    },
    crypto: {
      encapsulationKeyPair: null,
      signingFingerprint: null,
      signingKeyPair: null,
      ...patch.crypto,
    },
    util: {
      ...patch.util,
    },
    ...patch,
  };
}

test("createDocumentProjectionUserKeyResolver resolves the local user key", async () => {
  const encapsulationPublicKey = Uint8Array.from([1, 2, 3]);
  const signingPublicKey = Uint8Array.from([4, 5, 6]);
  const signingFingerprint = await toFingerprint(signingPublicKey);
  let remoteFetchCount = 0;
  const resolver = createDocumentProjectionUserKeyResolver(
    createRuntime({
      apiClient: {
        getEncapsulationKey: async () => {
          remoteFetchCount += 1;
          return null;
        },
      },
      auth: {
        userId: "user-1",
      },
      crypto: {
        encapsulationKeyPair: {
          publicKey: encapsulationPublicKey,
        },
        signingFingerprint,
        signingKeyPair: {
          signingPublicKey,
        },
      },
    }),
  );

  const resolved = await resolver("user-1");

  expect(resolved).toEqual({
    encapsulationPublicKey,
    signingPublicKey,
    userId: "user-1",
  });
  expect(remoteFetchCount).toBe(0);
});

test("didDocumentProjectionKeyRuntimeChange tracks resolver dependencies", () => {
  const apiClient = {
    getEncapsulationKey: async () => null,
  };
  const encapsulationKeyPair = {
    publicKey: Uint8Array.from([1]),
  };
  const signingKeyPair = {
    signingPublicKey: Uint8Array.from([2]),
  };
  const runtime = createRuntime({
    apiClient,
    auth: {
      userId: "user-1",
    },
    crypto: {
      encapsulationKeyPair,
      signingFingerprint: "fingerprint-1",
      signingKeyPair,
    },
  });

  expect(didDocumentProjectionKeyRuntimeChange(runtime, runtime)).toBe(false);
  expect(
    didDocumentProjectionKeyRuntimeChange(runtime, {
      ...runtime,
      auth: {
        ...runtime.auth,
        userId: "user-2",
      },
    }),
  ).toBe(true);
  expect(
    didDocumentProjectionKeyRuntimeChange(runtime, {
      ...runtime,
      crypto: {
        ...runtime.crypto,
        signingFingerprint: "fingerprint-2",
      },
    }),
  ).toBe(true);
  expect(
    didDocumentProjectionKeyRuntimeChange(runtime, {
      ...runtime,
      util: {
        log: () => {},
      },
    }),
  ).toBe(false);
});
