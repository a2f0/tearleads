import { expect, test } from "bun:test";
import {
  type ContactProjectionKeyRuntime,
  createContactProjectionUserKeyResolver,
  didContactProjectionKeyRuntimeChange,
} from "@tearleads/client-sdk/workflows/contacts/projectionKeys";
import { toFingerprint } from "@tearleads/crypto";

function createRuntime(
  patch: Partial<ContactProjectionKeyRuntime> = {},
): ContactProjectionKeyRuntime {
  return {
    apiClient: {
      getEncapsulationKey: async () => null,
    },
    ...patch,
  };
}

test("createContactProjectionUserKeyResolver resolves the local user key", async () => {
  const encapsulationPublicKey = Uint8Array.from([1, 2, 3]);
  const signingPublicKey = Uint8Array.from([4, 5, 6]);
  const signingFingerprint = await toFingerprint(signingPublicKey);
  let remoteFetchCount = 0;
  const resolver = createContactProjectionUserKeyResolver(
    createRuntime({
      apiClient: {
        getEncapsulationKey: async () => {
          remoteFetchCount += 1;
          return null;
        },
      },
      encapsulationKeyPair: {
        publicKey: encapsulationPublicKey,
      },
      signingFingerprint,
      signingKeyPair: {
        signingPublicKey,
      },
      userId: "user-1",
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

test("didContactProjectionKeyRuntimeChange tracks resolver dependencies", () => {
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
    encapsulationKeyPair,
    signingFingerprint: "fingerprint-1",
    signingKeyPair,
    userId: "user-1",
  });

  expect(didContactProjectionKeyRuntimeChange(runtime, runtime)).toBe(false);
  expect(
    didContactProjectionKeyRuntimeChange(runtime, {
      ...runtime,
      userId: "user-2",
    }),
  ).toBe(true);
  expect(
    didContactProjectionKeyRuntimeChange(runtime, {
      ...runtime,
      signingFingerprint: "fingerprint-2",
    }),
  ).toBe(true);
  expect(
    didContactProjectionKeyRuntimeChange(runtime, {
      ...runtime,
      log: () => {},
    }),
  ).toBe(true);
});
