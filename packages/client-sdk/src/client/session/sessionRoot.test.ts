import { expect, test } from "bun:test";
import { generateSigningSeedAndKeyPair } from "@tearleads/crypto";
import { createMemoryBlobStore } from "../../data/blobs/memoryBlobStore";
import { Tearleads } from "../Tearleads";

const ROOT_CONTEXT = {
  authToken: "token-root",
  containerId: "container-1",
  defaultOrganizationId: "personal-org",
  isAuthenticated: true,
  isRoot: true,
  organizationId: "personal-org",
  userId: "user-root",
} as const;

test("the root flag reaches the session snapshot and workflow runtime", () => {
  const sdk = new Tearleads();
  expect(sdk.session.isRoot).toBe(false);
  expect(sdk.root.isAvailable).toBe(false);

  sdk.session.setContext(ROOT_CONTEXT);

  expect(sdk.session.isRoot).toBe(true);
  expect(sdk.session.snapshot.isRoot).toBe(true);
  expect(sdk.runtime.input().auth.isRoot).toBe(true);
  expect(sdk.root.isAvailable).toBe(true);
});

test("a partial context update keeps the root flag until it is cleared", () => {
  const sdk = new Tearleads();
  sdk.session.setContext(ROOT_CONTEXT);

  sdk.session.setContext({ authToken: "token-renewed" });
  expect(sdk.session.isRoot).toBe(true);
  expect(sdk.root.isAvailable).toBe(true);

  sdk.session.setContext({ isRoot: false });
  expect(sdk.session.isRoot).toBe(false);
  expect(sdk.root.isAvailable).toBe(false);
});

test("logout drops the root flag along with the session", () => {
  const sdk = new Tearleads();
  sdk.session.setContext(ROOT_CONTEXT);

  sdk.session.logout();

  expect(sdk.session.isAuthenticated).toBe(false);
  expect(sdk.session.isRoot).toBe(false);
  expect(sdk.runtime.input().auth.isRoot).toBe(false);
  expect(sdk.root.isAvailable).toBe(false);
});

test("the root facade refuses calls without a root session", async () => {
  const sdk = new Tearleads();
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
    sessionGeneration: 1,
    signingFingerprint: "f".repeat(64) as string | null,
  };
  const runtime: RootRuntime = {
    get sessionGeneration() {
      return state.sessionGeneration;
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
  return {
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
  const { resolveListing, root, state } = createDeferredRootRuntime();

  const pending = root.listIdentities();
  state.auth = { ...state.auth, isAuthenticated: false, isRoot: false };
  state.sessionGeneration += 1;
  resolveListing();

  const outcome = await pending;
  expect(outcome.ok).toBe(false);
  if (outcome.ok) {
    throw new Error("expected a dropped outcome");
  }
  expect(outcome.message).toContain("session changed");
});

test("a lookup that completes after an identity switch is dropped", async () => {
  const { resolveListing, root, state } = createDeferredRootRuntime();

  const pending = root.listIdentities();
  // A switch to another root identity still advances the generation, so the
  // reply requested by the previous identity must not surface to the new one.
  state.auth = { ...state.auth, userId: "user-other-root" };
  state.sessionGeneration += 1;
  resolveListing();

  const outcome = await pending;
  expect(outcome.ok).toBe(false);
});

test("a lookup that completes after the signing identity changes is dropped", async () => {
  const { resolveListing, root, state } = createDeferredRootRuntime();

  const pending = root.listIdentities();
  // Swapping key pairs does not touch the session generation, so the guard
  // must notice the fingerprint moving on its own.
  state.signingFingerprint = "0".repeat(64);
  resolveListing();

  const outcome = await pending;
  expect(outcome.ok).toBe(false);
});

test("a lookup that completes after the identity is destroyed is dropped", async () => {
  const { resolveListing, root, state } = createDeferredRootRuntime();

  const pending = root.listIdentities();
  state.signingFingerprint = null;
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
    get sessionGeneration() {
      return 0;
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
