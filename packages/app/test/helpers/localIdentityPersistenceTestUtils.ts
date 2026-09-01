import { expect } from "bun:test";
import { waitFor } from "@testing-library/react";

const LOCAL_IDENTITY_PERSIST_TIMEOUT_MS = 30_000;

export async function waitForPersistedPaneLocalIdentity(
  namespace: string,
): Promise<void> {
  const storageKey = `tearleads.local-identity-registry:${namespace}.left`;
  await waitFor(
    () => {
      expect(globalThis.localStorage.getItem(storageKey)).not.toBeNull();
    },
    { timeout: LOCAL_IDENTITY_PERSIST_TIMEOUT_MS },
  );
}
