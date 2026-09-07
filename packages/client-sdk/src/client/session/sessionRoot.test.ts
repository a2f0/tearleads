import { expect, test } from "bun:test";
import { generateSigningSeedAndKeyPair } from "@tearleads/crypto";
import { createMemoryBlobStore } from "../../data/blobs/memoryBlobStore";
import { Tearleads } from "../Tearleads";

const ROOT_FINGERPRINT = "1".repeat(64);

async function createRootSdk(): Promise<Tearleads> {
  const sdk = new Tearleads({
    blobStoreFactory: () => createMemoryBlobStore(),
  });
  await sdk.identity.setKeyPairs({
    encapsulationKeyPair: null,
    signingFingerprint: ROOT_FINGERPRINT,
    signingKeyPair: generateSigningSeedAndKeyPair(),
  });
  return sdk;
}

const ROOT_CONTEXT = {
  authToken: "token-root",
  containerId: "container-1",
  defaultOrganizationId: "personal-org",
  isAuthenticated: true,
  isRoot: true,
  organizationId: "personal-org",
  userId: "user-root",
} as const;

test("the root flag reaches the session snapshot and workflow runtime", async () => {
  const sdk = await createRootSdk();
  expect(sdk.session.isRoot).toBe(false);
  expect(sdk.root.isAvailable).toBe(false);

  sdk.session.setContext(ROOT_CONTEXT);

  expect(sdk.session.isRoot).toBe(true);
  expect(sdk.session.snapshot.isRoot).toBe(true);
  expect(sdk.runtime.input().auth.isRoot).toBe(true);
  expect(sdk.root.isAvailable).toBe(true);
});

test("a partial context update keeps the root flag until it is cleared", async () => {
  const sdk = await createRootSdk();
  sdk.session.setContext(ROOT_CONTEXT);

  sdk.session.setContext({ authToken: "token-renewed" });
  expect(sdk.session.isRoot).toBe(true);
  expect(sdk.root.isAvailable).toBe(true);

  sdk.session.setContext({ isRoot: false });
  expect(sdk.session.isRoot).toBe(false);
  expect(sdk.root.isAvailable).toBe(false);
});

test("logout drops the root flag along with the session", async () => {
  const sdk = await createRootSdk();
  sdk.session.setContext(ROOT_CONTEXT);

  sdk.session.logout();

  expect(sdk.session.isAuthenticated).toBe(false);
  expect(sdk.session.isRoot).toBe(false);
  expect(sdk.runtime.input().auth.isRoot).toBe(false);
  expect(sdk.root.isAvailable).toBe(false);
});

test("the root facade refuses calls without a root session", async () => {
  const sdk = await createRootSdk();
  sdk.session.setContext({ ...ROOT_CONTEXT, isRoot: false });

  const outcome = await sdk.root.listIdentities();

  expect(outcome.ok).toBe(false);
  if (outcome.ok) {
    throw new Error("expected a refused outcome");
  }
  expect(outcome.status).toBeNull();
  expect(outcome.message).toContain("not a platform operator");
});

import type { RequestResult } from "@tearleads/api-client";
import type { RootIdentitiesResponse } from "@tearleads/validators/response";
import { createRoot, type RootRuntime } from "../root";

function createDeferredRootRuntime() {
  let resolveListing: (result: RequestResult<RootIdentitiesResponse>) => void =
    () => undefined;
  const listing = new Promise<RequestResult<RootIdentitiesResponse>>(
    (resolve) => {
      resolveListing = resolve;
    },
  );
  const state = {
    auth: {
      isAuthenticated: true,
      isRoot: true,
      organizationId: "org-1",
      userId: "user-root",
    },
    authToken: "token-1" as string | null,
    signingFingerprint: "f".repeat(64) as string | null,
  };
  const listeners = new Set<() => void>();
  const runtime: RootRuntime = {
    authToken: () => state.authToken,
    subscribe: (listener) => {
      listeners.add(listener);
      return () => listeners.delete(listener);
    },
    workflowInput: () => ({
      apiClient: {
        getRootIdentityResult: async () => {
          throw new Error("not used");
        },
        listRootIdentitiesResult: () => listing,
        listRootIdentityOrganizationsResult: async () => {
          throw new Error("not used");
        },
      },
      auth: state.auth,
      crypto: { signingFingerprint: state.signingFingerprint },
    }),
  };
  const page: RootIdentitiesResponse = { identities: [], nextCursor: null };
  const notify = () => {
    for (const listener of listeners) {
      listener();
    }
  };
  return {
    notify,
    resolveListing: () => resolveListing({ data: page, ok: true }),
    root: createRoot(runtime),
    state,
  };
}

test("a lookup that completes in the same session returns its data", async () => {
  const { resolveListing, root } = createDeferredRootRuntime();

  const pending = root.listIdentities();
  resolveListing();

  const outcome = await pending;
  expect(outcome.ok).toBe(true);
});

test("a lookup that completes after a logout is dropped", async () => {
  const { notify, resolveListing, root, state } = createDeferredRootRuntime();

  const pending = root.listIdentities();
  state.auth = { ...state.auth, isAuthenticated: false, isRoot: false };
  notify();
  resolveListing();

  const outcome = await pending;
  expect(outcome.ok).toBe(false);
  if (outcome.ok) {
    throw new Error("expected a dropped outcome");
  }
  expect(outcome.message).toContain("session changed");
});

test("a lookup that completes after an identity switch is dropped", async () => {
  const { notify, resolveListing, root, state } = createDeferredRootRuntime();

  const pending = root.listIdentities();
  // A switch to another root identity still advances the generation, so the
  // reply requested by the previous identity must not surface to the new one.
  state.auth = { ...state.auth, userId: "user-other-root" };
  notify();
  resolveListing();

  const outcome = await pending;
  expect(outcome.ok).toBe(false);
});

test("a lookup that completes after an auth-token renewal is kept", async () => {
  const { notify, resolveListing, root, state } = createDeferredRootRuntime();

  const pending = root.listIdentities();
  // The api client renews an expired token and retries transparently; the
  // user and identity are unchanged, so the retried reply must still land.
  state.auth = { ...state.auth };
  notify();
  resolveListing();

  const outcome = await pending;
  expect(outcome.ok).toBe(true);
});

test("a logout followed by a login of the same user drops the in-flight reply", async () => {
  const { notify, resolveListing, root, state } = createDeferredRootRuntime();
  const rootAuth = state.auth;

  const pending = root.listIdentities();
  state.auth = { ...rootAuth, isAuthenticated: false, isRoot: false };
  notify();
  state.auth = rootAuth;
  notify();
  resolveListing();

  const outcome = await pending;
  expect(outcome.ok).toBe(false);
});

test("a switch to another identity and back drops the in-flight reply", async () => {
  const { notify, resolveListing, root, state } = createDeferredRootRuntime();
  const rootAuth = state.auth;
  const rootFingerprint = state.signingFingerprint;

  const pending = root.listIdentities();
  state.auth = { ...rootAuth, userId: "user-b" };
  state.signingFingerprint = "b".repeat(64);
  notify();
  state.auth = rootAuth;
  state.signingFingerprint = rootFingerprint;
  notify();
  resolveListing();

  const outcome = await pending;
  expect(outcome.ok).toBe(false);
});

test("a lookup that completes after the signing identity changes is dropped", async () => {
  const { notify, resolveListing, root, state } = createDeferredRootRuntime();

  const pending = root.listIdentities();
  // Swapping key pairs does not touch the session generation, so the guard
  // must notice the fingerprint moving on its own.
  state.signingFingerprint = "0".repeat(64);
  notify();
  resolveListing();

  const outcome = await pending;
  expect(outcome.ok).toBe(false);
});

test("a lookup that completes after the identity is destroyed is dropped", async () => {
  const { notify, resolveListing, root, state } = createDeferredRootRuntime();

  const pending = root.listIdentities();
  state.signingFingerprint = null;
  notify();
  resolveListing();

  const outcome = await pending;
  expect(outcome.ok).toBe(false);
});

test("a real SDK key-pair swap drops an in-flight lookup", async () => {
  const sdk = new Tearleads({
    blobStoreFactory: () => createMemoryBlobStore(),
  });
  await sdk.identity.setKeyPairs({
    encapsulationKeyPair: null,
    signingFingerprint: "1".repeat(64),
    signingKeyPair: generateSigningSeedAndKeyPair(),
  });
  sdk.session.setContext(ROOT_CONTEXT);
  let resolveListing: (result: RequestResult<RootIdentitiesResponse>) => void =
    () => undefined;
  const listing = new Promise<RequestResult<RootIdentitiesResponse>>(
    (resolve) => {
      resolveListing = resolve;
    },
  );
  // Adapter over the real SDK: session and identity come from the live
  // runtime, only the network call is faked so it can be held open.
  const root = createRoot({
    authToken: () => sdk.session.authToken,
    subscribe: (listener) => sdk.runtime.subscribe(listener),
    workflowInput: () => ({
      apiClient: {
        getRootIdentityResult: async () => {
          throw new Error("not used");
        },
        listRootIdentitiesResult: () => listing,
        listRootIdentityOrganizationsResult: async () => {
          throw new Error("not used");
        },
      },
      auth: sdk.runtime.input().auth,
      crypto: sdk.runtime.input().crypto,
    }),
  });

  const pending = root.listIdentities();
  await sdk.identity.setKeyPairs({
    encapsulationKeyPair: null,
    signingFingerprint: "2".repeat(64),
    signingKeyPair: generateSigningSeedAndKeyPair(),
  });
  resolveListing({ data: { identities: [], nextCursor: null }, ok: true });

  const outcome = await pending;
  expect(outcome.ok).toBe(false);
});

test("a key-pair swap after login unbinds root until the next login", async () => {
  const sdk = await createRootSdk();
  sdk.session.setContext(ROOT_CONTEXT);
  expect(sdk.root.isAvailable).toBe(true);

  // The session still holds identity A's token and root flag, but the loaded
  // signing identity is now B; B must not inherit A's operator standing.
  await sdk.identity.setKeyPairs({
    encapsulationKeyPair: null,
    signingFingerprint: "2".repeat(64),
    signingKeyPair: generateSigningSeedAndKeyPair(),
  });
  expect(sdk.root.isAvailable).toBe(false);
  const refused = await sdk.root.listIdentities();
  expect(refused.ok).toBe(false);

  // A successful login as B is observable as a new auth token carrying the
  // server's verdict; both flags were already true, so only the token moves.
  sdk.session.setContext({ ...ROOT_CONTEXT, authToken: "token-b" });
  expect(sdk.root.isAvailable).toBe(true);
});

test("a token renewal for the same identity keeps root available", async () => {
  const sdk = await createRootSdk();
  sdk.session.setContext(ROOT_CONTEXT);

  sdk.session.setContext({ authToken: "token-renewed" });

  expect(sdk.root.isAvailable).toBe(true);
});
