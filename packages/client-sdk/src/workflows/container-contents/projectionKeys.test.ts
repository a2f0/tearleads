import { expect, test } from "bun:test";
import { toFingerprint } from "@tearleads/crypto";
import { bytesToBase64 } from "@tearleads/encoding";
import {
  type ContainerContentsProjectionKeyRuntime,
  createContainerContentsDocumentProjectionUserKeyResolver,
  createContainerContentsProjectionUserKeyResolver,
  didContainerContentsProjectionKeyRuntimeChange,
} from "./projectionKeys";

function createRuntime(
  patch: Partial<ContainerContentsProjectionKeyRuntime> = {},
): ContainerContentsProjectionKeyRuntime {
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

test("createContainerContentsProjectionUserKeyResolver resolves the local user key", async () => {
  const encapsulationPublicKey = Uint8Array.from([1, 2, 3]);
  const signingPublicKey = Uint8Array.from([4, 5, 6]);
  const signingFingerprint = await toFingerprint(signingPublicKey);
  let remoteFetchCount = 0;
  const resolver = createContainerContentsProjectionUserKeyResolver(
    createRuntime({
      apiClient: {
        getEncapsulationKey: async () => {
          remoteFetchCount += 1;
          return null;
        },
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
      auth: {
        userId: "user-1",
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

test("createContainerContentsDocumentProjectionUserKeyResolver logs document resolver failures", async () => {
  const logs: string[] = [];
  const resolver = createContainerContentsDocumentProjectionUserKeyResolver(
    createRuntime({
      apiClient: {
        getEncapsulationKey: async (userId) => ({
          encapsulationPublicKey: bytesToBase64(Uint8Array.from([1])),
          signingKeyFingerprint: "mismatched-fingerprint",
          signingPublicKey: bytesToBase64(Uint8Array.from([2])),
          userId,
        }),
      },
      util: {
        log: (message) => logs.push(message),
      },
    }),
  );

  await expect(resolver("peer-1")).resolves.toBeNull();
  expect(logs).toEqual([
    "Container document projections: skipped projection key for peer-1 because the signing fingerprint does not match the public key.",
  ]);
});

test("didContainerContentsProjectionKeyRuntimeChange tracks resolver dependencies", () => {
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

  expect(didContainerContentsProjectionKeyRuntimeChange(runtime, runtime)).toBe(
    false,
  );
  expect(
    didContainerContentsProjectionKeyRuntimeChange(runtime, {
      ...runtime,
      auth: {
        ...runtime.auth,
        userId: "user-2",
      },
    }),
  ).toBe(true);
  expect(
    didContainerContentsProjectionKeyRuntimeChange(runtime, {
      ...runtime,
      crypto: {
        ...runtime.crypto,
        signingFingerprint: "fingerprint-2",
      },
    }),
  ).toBe(true);
  expect(
    didContainerContentsProjectionKeyRuntimeChange(runtime, {
      ...runtime,
      util: {
        log: () => {},
      },
    }),
  ).toBe(false);
});
