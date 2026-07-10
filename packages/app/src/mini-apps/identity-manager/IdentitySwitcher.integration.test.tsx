import { afterEach, expect, test } from "bun:test";
import { createMemoryBlobStore } from "@tearleads/client-sdk";
import type { WorkerRequest } from "@tearleads/sqlite-worker/types";
import { fireEvent, waitFor, within } from "@testing-library/react";
import { openIdentityManagerFromPane } from "../../../test/helpers/identityPaneTestUtils";
import { MockWorker } from "../../../test/helpers/mockWorker";
import {
  cleanupPaneTestEnvironment,
  createSharedMemoryLocalKeyringFactory,
  createTestHostConfig,
  generateIdentityAndWaitForDb,
  getPanePublicKey,
  getPaneStatusText,
  PANE_LONG_ASYNC_TEST_TIMEOUT_MS,
  renderPane,
  waitForPersistedPaneLocalIdentity,
} from "../../../test/helpers/paneTestUtils";
import { compactIdentityFingerprint } from "./IdentitySwitcher";

const initializedDatabaseNames: string[] = [];
const initializedBlobNamespaces: string[] = [];
const userIdPattern =
  /userId:\s*([0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12})/u;

function collapseConsecutiveDuplicates(values: readonly string[]): string[] {
  return values.filter((value, index) => value !== values[index - 1]);
}

class RecordingMockWorker extends MockWorker {
  override postMessage(message: WorkerRequest) {
    if (message.method === "init") {
      initializedDatabaseNames.push(message.params.dbName);
    }
    super.postMessage(message);
  }
}

async function registerCurrentIdentity(
  view: ReturnType<typeof renderPane>,
  identityManager: ReturnType<typeof within>,
): Promise<string> {
  const register = await identityManager.findByRole("button", {
    name: "Register",
  });
  fireEvent.click(register);
  let userId = "";
  await waitFor(
    () => {
      userId = userIdPattern.exec(getPaneStatusText(view))?.[1] ?? "";
      expect(userId).not.toBe("");
    },
    { timeout: PANE_LONG_ASYNC_TEST_TIMEOUT_MS },
  );
  return userId;
}

async function waitForPersistedSession(
  localIdentityNamespace: string,
  signingFingerprint: string,
): Promise<void> {
  const storageKey =
    `tearleads.local-session:${localIdentityNamespace}.left:` +
    signingFingerprint;
  await waitFor(
    () => expect(globalThis.localStorage.getItem(storageKey)).not.toBeNull(),
    { timeout: PANE_LONG_ASYNC_TEST_TIMEOUT_MS },
  );
}

afterEach(async () => {
  initializedDatabaseNames.length = 0;
  initializedBlobNamespaces.length = 0;
  await cleanupPaneTestEnvironment();
});

test(
  "identity manager switches A to B and back with isolated storage and sessions",
  async () => {
    const localIdentityNamespace = `identity-switch-${crypto.randomUUID()}`;
    const hostConfig = createTestHostConfig({
      createLocalKeyring: createSharedMemoryLocalKeyringFactory(),
      localIdentityNamespace,
      workerConstructor: RecordingMockWorker,
    }).withOverrides({
      createBlobStore: (namespace) => {
        initializedBlobNamespaces.push(namespace);
        return createMemoryBlobStore();
      },
    });
    const view = renderPane({ hostConfig });

    await generateIdentityAndWaitForDb(view);
    await waitForPersistedPaneLocalIdentity(localIdentityNamespace);
    const identityA = getPanePublicKey(view);
    const identityManagerWindow = await openIdentityManagerFromPane(view);
    const identityManager = within(identityManagerWindow);
    const userA = await registerCurrentIdentity(view, identityManager);
    await waitForPersistedSession(localIdentityNamespace, identityA);

    fireEvent.click(
      identityManager.getByRole("combobox", { name: "Identities" }),
    );
    fireEvent.click(identityManager.getByText("New Identity"));

    let identityB = "";
    await waitFor(
      () => {
        expect(getPaneStatusText(view)).toMatch(/sqlite worker:\s*ready/u);
        identityB = getPanePublicKey(view);
        expect(identityB).not.toBe(identityA);
      },
      { timeout: PANE_LONG_ASYNC_TEST_TIMEOUT_MS },
    );
    const userB = await registerCurrentIdentity(view, identityManager);
    expect(userB).not.toBe(userA);
    await waitForPersistedSession(localIdentityNamespace, identityB);
    fireEvent.click(
      identityManager.getByRole("combobox", { name: "Identities" }),
    );
    await waitFor(() => {
      expect(
        identityManager.getByRole("option", {
          name: compactIdentityFingerprint(identityA),
        }),
      ).toBeTruthy();
    });
    fireEvent.click(
      identityManager.getByRole("option", {
        name: compactIdentityFingerprint(identityA),
      }),
    );

    await waitFor(
      () => {
        expect(getPaneStatusText(view)).toMatch(/sqlite worker:\s*ready/u);
        expect(getPanePublicKey(view)).toBe(identityA);
        expect(getPaneStatusText(view)).toContain(`userId: ${userA}`);
      },
      { timeout: PANE_LONG_ASYNC_TEST_TIMEOUT_MS },
    );

    expect(collapseConsecutiveDuplicates(initializedDatabaseNames)).toEqual([
      `/app-identity-${identityA}.db`,
      `/app-identity-${identityB}.db`,
      `/app-identity-${identityA}.db`,
    ]);
    expect(collapseConsecutiveDuplicates(initializedBlobNamespaces)).toEqual([
      identityA,
      identityB,
      identityA,
    ]);
    view.unmount();
  },
  PANE_LONG_ASYNC_TEST_TIMEOUT_MS * 2,
);
