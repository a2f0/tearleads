import { expect, test } from "bun:test";
import { KeyingVerificationError } from "@tearleads/crypto";
import { createTestTrustedUserIdentity } from "../../../test/helpers/trustedUserIdentity";
import type { TrustedUserIdentity } from "../../data/trustedUserIdentity";
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
    resolveTrustedUserIdentity: async () => null,
    util: { ...patch.util },
    ...patch,
  };
}

test("createContainerContentsProjectionUserKeyResolver maps a trusted identity", async () => {
  const encapsulationPublicKey = Uint8Array.from([1, 2, 3]);
  const signingPublicKey = Uint8Array.from([4, 5, 6]);
  const resolver = createContainerContentsProjectionUserKeyResolver(
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

test("projection identity integrity failures remain hard failures", async () => {
  const integrityError = new KeyingVerificationError(
    "equivocation",
    "identity changed",
  );
  const resolver = createContainerContentsDocumentProjectionUserKeyResolver(
    createRuntime({
      resolveTrustedUserIdentity: async () => {
        throw integrityError;
      },
    }),
  );

  await expect(resolver("peer-1")).rejects.toBe(integrityError);
});

test("projection transport failures remain soft and retryable", async () => {
  const logs: string[] = [];
  let attempts = 0;
  const resolver = createContainerContentsDocumentProjectionUserKeyResolver(
    createRuntime({
      resolveTrustedUserIdentity: async () => {
        attempts += 1;
        throw new Error("offline");
      },
      util: { log: (message) => logs.push(message) },
    }),
  );

  await expect(resolver("peer-1")).resolves.toBeNull();
  await expect(resolver("peer-1")).resolves.toBeNull();
  expect(attempts).toBe(2);
  expect(logs).toEqual([
    "Container document projections: skipped projection key for peer-1 because it could not be loaded.",
    "Container document projections: skipped projection key for peer-1 because it could not be loaded.",
  ]);
});

test("didContainerContentsProjectionKeyRuntimeChange tracks the trusted resolver", () => {
  const runtime = createRuntime({
    resolveTrustedUserIdentity: async () => null,
  });

  expect(didContainerContentsProjectionKeyRuntimeChange(runtime, runtime)).toBe(
    false,
  );
  expect(
    didContainerContentsProjectionKeyRuntimeChange(runtime, {
      ...runtime,
      resolveTrustedUserIdentity: async () => null,
    }),
  ).toBe(true);
  expect(
    didContainerContentsProjectionKeyRuntimeChange(runtime, {
      ...runtime,
      util: { log: () => {} },
    }),
  ).toBe(false);
});
