import { afterEach, expect, mock, spyOn, test } from "bun:test";
import { Tearleads } from "@tearleads/client-sdk";
import { act, cleanup, renderHook } from "@testing-library/react";
import { createSqlRuntimeBase } from "../../../test/helpers/createSqlRuntime";
import { installProfileEditorRuntime } from "../../../test/helpers/org-manager/profileEditorHarness";
import * as ContactStore from "./contactStore";
import type { ContactRemovalOperation } from "./contactStoreTypes";
import { useContactsStoreForContainer } from "./useContactsStoreForContainer";

afterEach(cleanup);

test("a bound removal stays admitted across non-authority runtime notifications", async () => {
  const runtime = await createSqlRuntimeBase("bound-contact-removal");
  const sdk = new Tearleads({
    database: { execSql: runtime.infra.execSql, id: "bound-contact-removal" },
    blobStore: runtime.infra.blobStore,
    identity: { signingFingerprint: "bound-contact-removal" },
    identityProvisioning: "manual",
    logger: { log: () => undefined, logError: () => undefined },
    online: false,
  });
  const restoreRuntime = installProfileEditorRuntime(sdk);
  // Observe the admission the bound action hands the real store while its
  // Trash lookup is held, as an online Trash provision would be.
  const operations: ContactRemovalOperation[] = [];
  const createStore = ContactStore.getOrCreateContactsStore;
  const storeFactory = spyOn(
    ContactStore,
    "getOrCreateContactsStore",
  ).mockImplementation((...args) => ({
    ...createStore(...args),
    removeContact: mock(async (_contactId, operation) => {
      if (operation) operations.push(operation);
    }),
  }));
  const hook = renderHook(() =>
    useContactsStoreForContainer("bound-removal-contacts", async () => ({
      status: "target",
      trashContainerId: "bound-removal-trash",
    })),
  );
  try {
    await act(async () => {
      await hook.result.current.removeContact("contact-1");
    });
    const [operation] = operations;
    if (!operation) throw new Error("Expected a bound removal operation");
    expect(operation.isCurrent()).toBe(true);
    const version = sdk.runtime.version;
    act(() => {
      sdk.session.setSyncEnabled(false);
    });
    expect(sdk.runtime.version).toBeGreaterThan(version);
    expect(operation.isCurrent()).toBe(true);

    act(() => {
      sdk.session.setUserId("00000000-0000-4000-8000-000000000098");
    });
    expect(operation.isCurrent()).toBe(false);
    // Returning to the original principal does not revive the admission.
    act(() => {
      sdk.session.setUserId(null);
    });
    expect(operation.isCurrent()).toBe(false);
  } finally {
    hook.unmount();
    storeFactory.mockRestore();
    restoreRuntime();
    sdk.dispose();
    runtime.close();
  }
});
