import { expect, test } from "bun:test";
import { createTestTrustedUserIdentity } from "../../../test/helpers/trustedUserIdentity";
import type { TrustedUserIdentity } from "../../data/trustedUserIdentity";
import {
  createDocumentProjectionUserKeyResolver,
  type DocumentProjectionKeyRuntime,
  didDocumentProjectionKeyRuntimeChange,
} from "./projectionKeys";

function createRuntime(
  patch: Partial<DocumentProjectionKeyRuntime> = {},
): DocumentProjectionKeyRuntime {
  return {
    resolveTrustedUserIdentity: async () => null,
    util: { ...patch.util },
    ...patch,
  };
}

test("createDocumentProjectionUserKeyResolver maps a trusted identity", async () => {
  const encapsulationPublicKey = Uint8Array.from([1, 2, 3]);
  const signingPublicKey = Uint8Array.from([4, 5, 6]);
  const resolver = createDocumentProjectionUserKeyResolver(
    createRuntime({
      resolveTrustedUserIdentity: async (userId) =>
        createTestTrustedUserIdentity({
          encapsulationPublicKey,
          signingKeyFingerprint: "signing-fingerprint",
          signingPublicKey,
          userId,
        }) as unknown as TrustedUserIdentity,
    }),
  );

  await expect(resolver("user-1")).resolves.toMatchObject({
    encapsulationPublicKey,
    signingPublicKey,
    userId: "user-1",
  });
});

test("didDocumentProjectionKeyRuntimeChange tracks the trusted resolver", () => {
  const resolveTrustedUserIdentity = async () => null;
  const runtime = createRuntime({ resolveTrustedUserIdentity });

  expect(didDocumentProjectionKeyRuntimeChange(runtime, runtime)).toBe(false);
  expect(
    didDocumentProjectionKeyRuntimeChange(runtime, {
      ...runtime,
      resolveTrustedUserIdentity: async () => null,
    }),
  ).toBe(true);
  expect(
    didDocumentProjectionKeyRuntimeChange(runtime, {
      ...runtime,
      util: { log: () => {} },
    }),
  ).toBe(false);
});
