import { expect, mock, test } from "bun:test";
import type { Tearleads } from "@tearleads/client-sdk";
import { DATABASE_TRANSACTION_BUSY_MESSAGE } from "@tearleads/sqlite-worker/types";
import { renderHook, waitFor } from "@testing-library/react";
import { useGenerateKey } from "./localIdentityGeneration";

function tearleadsStub(): Tearleads {
  return {
    dispose: () => {},
    events: { clear: () => {} },
    identity: {
      destroy: () => {},
      setKeyPairs: async () => {},
      signingKeyPair: null,
    },
    logError: () => {},
    session: {
      bootstrapLocalRootContainer: async () => {},
      setContext: () => {},
    },
  } as unknown as Tearleads;
}

test("a new identity is stored only after its pre-persist work finished", async () => {
  const persistLocalIdentity = mock(async () => {});
  const { result } = renderHook(() =>
    useGenerateKey({
      ensureIdentityDatabaseReady: async () => {},
      generationIdRef: { current: 0 },
      generationInFlight: { current: false },
      persistLocalIdentity,
      tearleads: tearleadsStub(),
    }),
  );
  const pending = Promise.withResolvers<void>();
  const beforePersist = mock((_signingFingerprint: string) => pending.promise);

  const generated = result.current({ beforePersist });
  await waitFor(() => expect(beforePersist).toHaveBeenCalledTimes(1));
  expect(beforePersist.mock.calls[0]?.[0]).toMatch(/^[0-9a-f]{64}$/u);
  expect(persistLocalIdentity).not.toHaveBeenCalled();

  pending.resolve();
  expect(await generated).toBe(true);
  expect(persistLocalIdentity).toHaveBeenCalledTimes(1);
});

// #3360: an automatic generation that fails is not retried until reload, so a
// refusal behind another tab's transaction must not end it.
test("a root bootstrap refused as busy runs again and the identity is created", async () => {
  const tearleads = tearleadsStub();
  let refusals = 2;
  const bootstrap = mock(async () => {
    if (refusals > 0) {
      refusals -= 1;
      throw new Error(DATABASE_TRANSACTION_BUSY_MESSAGE);
    }
    return { containerId: "root-container", created: true };
  });
  tearleads.session.bootstrapLocalRootContainer = bootstrap;
  const persistLocalIdentity = mock(async () => {});
  const { result } = renderHook(() =>
    useGenerateKey({
      ensureIdentityDatabaseReady: async () => {},
      generationIdRef: { current: 0 },
      generationInFlight: { current: false },
      persistLocalIdentity,
      tearleads,
    }),
  );

  expect(await result.current()).toBe(true);
  expect(bootstrap).toHaveBeenCalledTimes(3);
  expect(persistLocalIdentity).toHaveBeenCalledTimes(1);
});
