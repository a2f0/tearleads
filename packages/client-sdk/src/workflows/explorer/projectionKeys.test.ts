import { expect, test } from "bun:test";
import {
  createExplorerDocumentProjectionUserKeyResolver,
  createExplorerProjectionUserKeyResolver,
  didExplorerProjectionKeyRuntimeChange,
  type ExplorerProjectionKeyRuntime,
} from "@tearleads/client-sdk/workflows/explorer/projectionKeys";
import { toFingerprint } from "@tearleads/crypto";
import { bytesToBase64 } from "@tearleads/encoding";

function createRuntime(
  patch: Partial<ExplorerProjectionKeyRuntime> = {},
): ExplorerProjectionKeyRuntime {
  return {
    apiClient: {
      getEncapsulationKey: async () => null,
    },
    ...patch,
  };
}

test("createExplorerProjectionUserKeyResolver resolves the local user key", async () => {
  const encapsulationPublicKey = Uint8Array.from([1, 2, 3]);
  const signingPublicKey = Uint8Array.from([4, 5, 6]);
  const signingFingerprint = await toFingerprint(signingPublicKey);
  let remoteFetchCount = 0;
  const resolver = createExplorerProjectionUserKeyResolver(
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

test("createExplorerDocumentProjectionUserKeyResolver logs document resolver failures", async () => {
  const logs: string[] = [];
  const resolver = createExplorerDocumentProjectionUserKeyResolver(
    createRuntime({
      apiClient: {
        getEncapsulationKey: async (userId) => ({
          encapsulationPublicKey: bytesToBase64(Uint8Array.from([1])),
          signingKeyFingerprint: "mismatched-fingerprint",
          signingPublicKey: bytesToBase64(Uint8Array.from([2])),
          userId,
        }),
      },
      log: (message) => logs.push(message),
    }),
  );

  await expect(resolver("peer-1")).resolves.toBeNull();
  expect(logs).toEqual([
    "Explorer documents: skipped projection key for peer-1 because the signing fingerprint does not match the public key.",
  ]);
});

test("didExplorerProjectionKeyRuntimeChange tracks resolver dependencies", () => {
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

  expect(didExplorerProjectionKeyRuntimeChange(runtime, runtime)).toBe(false);
  expect(
    didExplorerProjectionKeyRuntimeChange(runtime, {
      ...runtime,
      userId: "user-2",
    }),
  ).toBe(true);
  expect(
    didExplorerProjectionKeyRuntimeChange(runtime, {
      ...runtime,
      signingFingerprint: "fingerprint-2",
    }),
  ).toBe(true);
  expect(
    didExplorerProjectionKeyRuntimeChange(runtime, {
      ...runtime,
      log: () => {},
    }),
  ).toBe(false);
});
