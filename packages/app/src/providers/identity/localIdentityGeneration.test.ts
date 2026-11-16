import { expect, mock, test } from "bun:test";
import type { Tearleads } from "@tearleads/client-sdk";
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
