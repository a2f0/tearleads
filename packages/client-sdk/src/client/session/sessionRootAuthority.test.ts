import { afterEach, expect, test } from "bun:test";
import {
  generateSigningSeedAndKeyPair,
  KeyingVerificationError,
} from "@tearleads/crypto";
import { setGeneratedIdentity } from "../../../test/helpers/clientTestSupport";
import { waitFor } from "../../../test/helpers/waitFor";
import { createMemoryBlobStore } from "../../data/blobs/memoryBlobStore";
import { Tearleads } from "../Tearleads";
import { createApi, createSessionHarness } from "./session.testFixtures";
import {
  acknowledgedSessionRoot,
  acknowledgeSessionRoot,
} from "./sessionRootAuthority";

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

const personalRoot = {
  userId: "user",
  organizationId: "org-personal",
  rootContainerId: "root-real",
};

test("an acknowledged organization keeps its root across identical re-acknowledgements", () => {
  const first = acknowledgeSessionRoot([], personalRoot, fingerprint);
  const again = acknowledgeSessionRoot(first, personalRoot, fingerprint);
  expect(again).toEqual([{ ...personalRoot, signingFingerprint: fingerprint }]);
  const other = acknowledgeSessionRoot(
    again,
    { ...personalRoot, organizationId: "org-custom", rootContainerId: "r2" },
    fingerprint,
  );
  expect(other.map((entry) => entry.organizationId).sort()).toEqual([
    "org-custom",
    "org-personal",
  ]);
});

test("a login that names a different root for an acknowledged organization is refused", () => {
  const known = acknowledgeSessionRoot([], personalRoot, fingerprint);
  expect(() =>
    acknowledgeSessionRoot(
      known,
      { ...personalRoot, rootContainerId: "root-attacker" },
      fingerprint,
    ),
  ).toThrow(
    "Session root acknowledgement changed for an acknowledged organization",
  );
  // The refused acknowledgement leaves the original one authoritative.
  const session = {
    userId: "user",
    organizationId: "org-personal",
    snapshot: { rootAcknowledgments: known },
  } as unknown as Parameters<typeof acknowledgedSessionRoot>[0];
  expect(acknowledgedSessionRoot(session, fingerprint)).toBe("root-real");
  // Another identity's acknowledgements are unrelated to this one's.
  expect(
    acknowledgeSessionRoot(
      known,
      { ...personalRoot, rootContainerId: "root-attacker" },
      "b".repeat(64),
    ),
  ).toHaveLength(1);
});

test("a purged root may be acknowledged as gone but never regrows a root", () => {
  const known = acknowledgeSessionRoot([], personalRoot, fingerprint);
  const purged = acknowledgeSessionRoot(
    known,
    { ...personalRoot, rootContainerId: null },
    fingerprint,
  );
  expect(purged).toEqual([
    { ...personalRoot, rootContainerId: null, signingFingerprint: fingerprint },
  ]);
  for (const rootContainerId of ["root-real", "root-attacker"]) {
    expect(() =>
      acknowledgeSessionRoot(
        purged,
        { ...personalRoot, rootContainerId },
        fingerprint,
      ),
    ).toThrow(KeyingVerificationError);
  }
});

test("login refuses a swapped root for the same organization and records an incident", async () => {
  const incidents: Array<{ code: unknown; operation: string }> = [];
  let rootContainerId = "root-real";
  const api = createApi({
    authenticate: async () => ({
      rootContainerId,
      authenticated: true,
      isRoot: false,
      organizationId: "org-personal",
      token: `token-${rootContainerId}`,
      userId: "user-1",
    }),
  });
  const { identity, session } = createSessionHarness({
    api,
    reportSecurityIncident: async (error, context) => {
      incidents.push({
        code: error instanceof KeyingVerificationError ? error.code : error,
        operation: context.operation,
      });
    },
  });
  await setGeneratedIdentity(identity);

  await expect(session.login()).resolves.toBe(true);
  await expect(session.login()).resolves.toBe(true);
  expect(session.snapshot.rootAcknowledgments).toHaveLength(1);
  expect(incidents).toEqual([]);

  rootContainerId = "root-attacker";
  await expect(session.login()).rejects.toThrow(
    "Session root acknowledgement changed for an acknowledged organization",
  );
  expect(incidents).toEqual([
    { code: "object_mismatch", operation: "session.root.acknowledge" },
  ]);
  expect(session.isAuthenticated).toBe(false);
  expect(session.authToken).toBeNull();
  expect(session.snapshot.rootAcknowledgments).toEqual([
    expect.objectContaining({ rootContainerId: "root-real" }),
  ]);
});

test("overlapping acknowledgements for different organizations are both kept", async () => {
  // Three logins overlap: the personal org (A), a second org (B), and a swap
  // attempt for A. Each read of `rootAcknowledgments` must see the writes the
  // others already committed, otherwise B's (or A's) acknowledgement is lost
  // and the swap for A passes against a stale, empty view. The identity pins
  // are released in one synchronous block so the three continuations run
  // back-to-back with no other work between them.
  const incidents: Array<{ code: unknown; operation: string }> = [];
  const responses = [
    { organizationId: "org-a", rootContainerId: "root-a" },
    { organizationId: "org-b", rootContainerId: "root-b" },
    { organizationId: "org-a", rootContainerId: "root-attacker" },
  ];
  const api = createApi({
    authenticate: async () => {
      const response = responses.shift();
      if (!response) throw new Error("unexpected authentication");
      return {
        ...response,
        authenticated: true,
        isRoot: false,
        token: `token-${response.rootContainerId}`,
        userId: "user-1",
      };
    },
  });
  const releasePins: Array<() => void> = [];
  const { identity, session } = createSessionHarness({
    api,
    onUserIdentityAvailable: () =>
      new Promise<void>((resolve) => {
        releasePins.push(resolve);
      }),
    reportSecurityIncident: async (error, context) => {
      incidents.push({
        code: error instanceof KeyingVerificationError ? error.code : error,
        operation: context.operation,
      });
    },
  });
  await setGeneratedIdentity(identity);

  // Which login draws which response depends on how the three reach
  // `authenticate`, so the outcomes are asserted as a set.
  const outcomes = Promise.allSettled([
    session.login(),
    session.login(),
    session.login(),
  ]);
  await waitFor(() => releasePins.length === 3, "expected three pins");
  for (const release of releasePins) release();

  const settled = await outcomes;
  expect(
    settled.filter(
      (outcome) => outcome.status === "fulfilled" && outcome.value === true,
    ),
  ).toHaveLength(2);
  expect(
    settled.filter(
      (outcome) =>
        outcome.status === "rejected" &&
        outcome.reason instanceof KeyingVerificationError &&
        outcome.reason.code === "object_mismatch",
    ),
  ).toHaveLength(1);
  expect(incidents).toEqual([
    { code: "object_mismatch", operation: "session.root.acknowledge" },
  ]);
  expect(
    session.snapshot.rootAcknowledgments
      .map(({ organizationId, rootContainerId }) => ({
        organizationId,
        rootContainerId,
      }))
      .sort((left, right) =>
        left.organizationId.localeCompare(right.organizationId),
      ),
  ).toEqual([
    { organizationId: "org-a", rootContainerId: "root-a" },
    { organizationId: "org-b", rootContainerId: "root-b" },
  ]);
});
