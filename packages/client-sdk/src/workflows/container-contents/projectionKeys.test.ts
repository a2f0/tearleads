import { expect, test } from "bun:test";
import {
  generateKemSeedAndKeyPair,
  generateSigningSeedAndKeyPair,
  KeyingVerificationError,
} from "@symcrypt/crypto";
import { createTestTrustedUserIdentity } from "../../../test/helpers/trustedUserIdentity";
import { defaultDocumentProjectorRegistry } from "../../data/documents/documentKinds";
import { createDomainScope } from "../../data/domainScope";
import type { TrustedUserIdentity } from "../../data/trustedUserIdentity";
import {
  type ContainerContentsProjectionKeyRuntime,
  createContainerContentsDocumentProjectionUserKeyResolver,
  createContainerContentsProjectionUserKeyResolver,
  didContainerContentsProjectionKeyRuntimeChange,
} from "./projectionKeys";
import {
  type ContainerContentsWorkflowRuntimeInput,
  createContainerContentsWorkflowRuntime,
} from "./runtime";

function createRuntime(
  patch: Partial<ContainerContentsProjectionKeyRuntime> = {},
): ContainerContentsProjectionKeyRuntime {
  return {
    auth: { isAuthenticated: false, userId: null },
    crypto: {
      encapsulationKeyPair: null,
      signingFingerprint: null,
      signingKeyPair: null,
    },
    resolveTrustedUserIdentity: async () => null,
    state: { domainScope: createDomainScope() },
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

test("projection resolver evicts and rethrows failed identity loads", async () => {
  let attempts = 0;
  const transportError = new Error("offline");
  const resolver = createContainerContentsDocumentProjectionUserKeyResolver(
    createRuntime({
      resolveTrustedUserIdentity: async () => {
        attempts += 1;
        throw transportError;
      },
    }),
  );

  await expect(resolver("peer-1")).rejects.toBe(transportError);
  await expect(resolver("peer-1")).rejects.toBe(transportError);
  expect(attempts).toBe(2);
});

test("container runtime normalization preserves trusted resolver identity", () => {
  const resolveTrustedUserIdentity = async () => null;
  const domainScope = createDomainScope();
  const input: ContainerContentsWorkflowRuntimeInput = {
    apiClient: {} as ContainerContentsWorkflowRuntimeInput["apiClient"],
    auth: {
      isAuthenticated: false,
      organizationId: null,
      userId: null,
    },
    crypto: {
      encapsulationKeyPair: null,
      signingFingerprint: null,
      signingKeyPair: null,
    },
    infra: {
      blobStore:
        {} as ContainerContentsWorkflowRuntimeInput["infra"]["blobStore"],
      dbStatus: "idle",
      documentProjectors: defaultDocumentProjectorRegistry,
      execSql: async () => [],
    },
    resolveTrustedUserIdentity,
    state: {
      containerId: null,
      domainScope,
      events: [],
      online: false,
    },
    util: {
      log: () => {},
      reportSecurityIncident: async () => undefined,
    },
  };

  const first = createContainerContentsWorkflowRuntime(input);
  const second = createContainerContentsWorkflowRuntime(input);

  expect(second.resolveTrustedUserIdentity).toBe(
    first.resolveTrustedUserIdentity,
  );
  expect(didContainerContentsProjectionKeyRuntimeChange(first, second)).toBe(
    false,
  );
});

test("didContainerContentsProjectionKeyRuntimeChange tracks the live trust context", () => {
  const runtime = createRuntime({
    resolveTrustedUserIdentity: async () => null,
  });

  expect(didContainerContentsProjectionKeyRuntimeChange(runtime, runtime)).toBe(
    false,
  );
  expect(
    didContainerContentsProjectionKeyRuntimeChange(runtime, {
      ...runtime,
      auth: { isAuthenticated: true, userId: null },
    }),
  ).toBe(true);
  expect(
    didContainerContentsProjectionKeyRuntimeChange(runtime, {
      ...runtime,
      auth: { ...runtime.auth, userId: "user-2" },
    }),
  ).toBe(true);
  expect(
    didContainerContentsProjectionKeyRuntimeChange(runtime, {
      ...runtime,
      crypto: { ...runtime.crypto, signingFingerprint: "fingerprint-2" },
    }),
  ).toBe(true);
  expect(
    didContainerContentsProjectionKeyRuntimeChange(runtime, {
      ...runtime,
      crypto: {
        ...runtime.crypto,
        encapsulationKeyPair: generateKemSeedAndKeyPair(),
      },
    }),
  ).toBe(true);
  expect(
    didContainerContentsProjectionKeyRuntimeChange(runtime, {
      ...runtime,
      crypto: {
        ...runtime.crypto,
        signingKeyPair: generateSigningSeedAndKeyPair(),
      },
    }),
  ).toBe(true);
  expect(
    didContainerContentsProjectionKeyRuntimeChange(runtime, {
      ...runtime,
      state: { domainScope: createDomainScope() },
    }),
  ).toBe(true);
  expect(
    didContainerContentsProjectionKeyRuntimeChange(runtime, {
      ...runtime,
      resolveTrustedUserIdentity: async () => null,
    }),
  ).toBe(true);
});
