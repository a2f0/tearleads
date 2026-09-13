import { afterEach, expect, test } from "bun:test";
import { generateSigningSeedAndKeyPair } from "@tearleads/crypto";
import { createMemoryBlobStore } from "../../data/blobs/memoryBlobStore";
import { Tearleads } from "../Tearleads";

const fingerprint = "a".repeat(64);
const sdks: Tearleads[] = [];
afterEach(() => {
  for (const sdk of sdks.splice(0)) sdk.dispose();
});

async function createSdk() {
  const sdk = new Tearleads({
    blobStoreFactory: () => createMemoryBlobStore(),
  });
  sdks.push(sdk);
  await sdk.identity.setKeyPairs({
    encapsulationKeyPair: null,
    signingFingerprint: fingerprint,
    signingKeyPair: generateSigningSeedAndKeyPair(),
  });
  return sdk;
}

const restoredContext = {
  authToken: "token",
  userId: "user",
  organizationId: "org-a",
  defaultOrganizationId: "org-a",
  isAuthenticated: true,
  containerId: "local-root-awaiting-reconciliation",
  rootAcknowledgments: ["a", "b"].map((suffix) => ({
    signingFingerprint: fingerprint,
    userId: "user",
    organizationId: `org-${suffix}`,
    rootContainerId: `server-root-${suffix}`,
  })),
};

test("restoring a local view preserves the separately acknowledged server root", async () => {
  const sdk = await createSdk();
  sdk.session.setContext(restoredContext);
  expect(sdk.runtime.input().auth.rootContainerId).toBe("server-root-a");
  expect(sdk.session.containerId).toBe("local-root-awaiting-reconciliation");
  expect(await sdk.session.bootstrapLocalRootContainer()).toEqual({
    containerId: "server-root-a",
    created: false,
  });
});

test("organization selection cannot promote an unverified local root", async () => {
  const sdk = await createSdk();
  sdk.session.setContext(restoredContext);
  sdk.session.setContext({
    organizationId: "org-b",
    containerId: "forged-local-root",
  });
  expect(sdk.runtime.input().auth.rootContainerId).toBe("server-root-b");
  sdk.session.setContext({
    organizationId: "unknown-org",
    containerId: "another-forgery",
  });
  expect(sdk.runtime.input().auth.rootContainerId).toBeNull();
  sdk.session.setOrganizationId("org-a");
  expect(sdk.runtime.input().auth.rootContainerId).toBe("server-root-a");
});

test("root acknowledgements cannot be restored for another signing identity", async () => {
  const sdk = await createSdk();
  const root = restoredContext.rootAcknowledgments[0];
  expect(root).toBeDefined();
  expect(() =>
    sdk.session.setContext({
      ...restoredContext,
      rootAcknowledgments: restoredContext.rootAcknowledgments.map((entry) => ({
        ...entry,
        signingFingerprint: "b".repeat(64),
      })),
    }),
  ).toThrow("Restored roots differ from the active identity");
  expect(sdk.runtime.input().auth.rootContainerId).toBeNull();
});

test("an identity swap cannot reuse the previous root acknowledgement", async () => {
  const sdk = await createSdk();
  sdk.session.setContext(restoredContext);
  await sdk.identity.setKeyPairs({
    encapsulationKeyPair: null,
    signingFingerprint: "b".repeat(64),
    signingKeyPair: generateSigningSeedAndKeyPair(),
  });
  expect(sdk.runtime.input().auth.rootContainerId).toBeNull();
});
