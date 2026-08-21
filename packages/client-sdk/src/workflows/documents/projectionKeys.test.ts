import { expect, test } from "bun:test";
import {
  generateKemSeedAndKeyPair,
  generateSigningSeedAndKeyPair,
} from "@symcrypt/crypto";
import { createTestTrustedUserIdentity } from "../../../test/helpers/trustedUserIdentity";
import { defaultDocumentProjectorRegistry } from "../../data/documents/documentKinds";
import { createDomainScope } from "../../data/domainScope";
import type { TrustedUserIdentity } from "../../data/trustedUserIdentity";
import {
  createDocumentProjectionUserKeyResolver,
  type DocumentProjectionKeyRuntime,
  didDocumentProjectionKeyRuntimeChange,
} from "./projectionKeys";
import {
  createDocumentsWorkflowRuntime,
  type DocumentsWorkflowRuntimeInput,
} from "./runtime";

function createRuntime(
  patch: Partial<DocumentProjectionKeyRuntime> = {},
): DocumentProjectionKeyRuntime {
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

test("document runtime normalization preserves trusted resolver identity", () => {
  const resolveTrustedUserIdentity = async () => null;
  const domainScope = createDomainScope();
  const input: DocumentsWorkflowRuntimeInput = {
    apiClient: {} as DocumentsWorkflowRuntimeInput["apiClient"],
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
      blobStore: {} as DocumentsWorkflowRuntimeInput["infra"]["blobStore"],
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

  const first = createDocumentsWorkflowRuntime(input);
  const second = createDocumentsWorkflowRuntime(input);

  expect(second.resolveTrustedUserIdentity).toBe(
    first.resolveTrustedUserIdentity,
  );
  expect(didDocumentProjectionKeyRuntimeChange(first, second)).toBe(false);
});

test("didDocumentProjectionKeyRuntimeChange tracks the live trust context", () => {
  const resolveTrustedUserIdentity = async () => null;
  const runtime = createRuntime({ resolveTrustedUserIdentity });

  expect(didDocumentProjectionKeyRuntimeChange(runtime, runtime)).toBe(false);
  expect(
    didDocumentProjectionKeyRuntimeChange(runtime, {
      ...runtime,
      auth: { isAuthenticated: true, userId: null },
    }),
  ).toBe(true);
  expect(
    didDocumentProjectionKeyRuntimeChange(runtime, {
      ...runtime,
      auth: { ...runtime.auth, userId: "user-2" },
    }),
  ).toBe(true);
  expect(
    didDocumentProjectionKeyRuntimeChange(runtime, {
      ...runtime,
      crypto: { ...runtime.crypto, signingFingerprint: "fingerprint-2" },
    }),
  ).toBe(true);
  expect(
    didDocumentProjectionKeyRuntimeChange(runtime, {
      ...runtime,
      crypto: {
        ...runtime.crypto,
        encapsulationKeyPair: generateKemSeedAndKeyPair(),
      },
    }),
  ).toBe(true);
  expect(
    didDocumentProjectionKeyRuntimeChange(runtime, {
      ...runtime,
      crypto: {
        ...runtime.crypto,
        signingKeyPair: generateSigningSeedAndKeyPair(),
      },
    }),
  ).toBe(true);
  expect(
    didDocumentProjectionKeyRuntimeChange(runtime, {
      ...runtime,
      state: { domainScope: createDomainScope() },
    }),
  ).toBe(true);
  expect(
    didDocumentProjectionKeyRuntimeChange(runtime, {
      ...runtime,
      resolveTrustedUserIdentity: async () => null,
    }),
  ).toBe(true);
});
