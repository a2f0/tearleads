import { afterEach, expect, spyOn, test } from "bun:test";
import { type RenderResult, waitFor, within } from "@testing-library/react";
import {
  answerAccountNamePrompt,
  sealedAccountNamingKey,
  waitForPaneKey,
} from "../../test/helpers/accountNamePrompt";
import { openIdentityManagerFromPane } from "../../test/helpers/identityPaneTestUtils";
import {
  MOCK_SERVER_RESET_TIMEOUT_MS,
  useTestApiAppHandlers,
} from "../../test/helpers/msw/server";
import { renderLifecyclePane } from "../../test/helpers/paneLifecycleTestUtils";
import {
  cleanupPaneTestEnvironment,
  createSharedMemoryLocalKeyringFactory,
  createTestHostConfig,
  getPaneStatusText,
  PANE_ASYNC_TEST_TIMEOUT_MS,
  PANE_LONG_ASYNC_TEST_TIMEOUT_MS,
  waitForPaneRuntimeToSettle,
  waitForPersistedPaneLocalIdentity,
} from "../../test/helpers/paneTestUtils";
import {
  ACCOUNT_NAME_SEAL_FAILED_MESSAGE,
  ACCOUNT_NAME_UNREADABLE_MESSAGE,
} from "./accountNamingMachine";

afterEach(cleanupPaneTestEnvironment, MOCK_SERVER_RESET_TIMEOUT_MS);

const NAME_PROMPT = { name: "What should we call you?" } as const;

/**
 * Swaps in a localStorage that refuses naming records while `refusing()`,
 * before the pane takes its storage handles.
 */
function refuseNamingRecords(refusing: () => boolean) {
  const real = globalThis.localStorage;
  const descriptor = Object.getOwnPropertyDescriptor(
    globalThis,
    "localStorage",
  );
  let refusals = 0;
  const setItem = (key: string, value: string) => {
    if (refusing() && key.startsWith("tearleads.account-naming:")) {
      refusals += 1;
      throw new DOMException("Storage is full", "QuotaExceededError");
    }
    real.setItem(key, value);
  };
  const storage = new Proxy(real, {
    get: (target, property) => {
      if (property === "setItem") return setItem;
      const value: unknown = Reflect.get(target, property);
      return typeof value === "function" ? value.bind(target) : value;
    },
  });
  Object.defineProperty(globalThis, "localStorage", {
    configurable: true,
    value: storage,
  });
  return {
    refusals: () => refusals,
    restore: () => {
      if (descriptor) {
        Object.defineProperty(globalThis, "localStorage", descriptor);
      } else {
        Reflect.deleteProperty(globalThis, "localStorage");
      }
    },
  };
}

function hostConfig(namespace: string) {
  return createTestHostConfig({
    autoProvisionIdentity: true,
    createLocalKeyring: createSharedMemoryLocalKeyringFactory(),
    localIdentityNamespace: namespace,
    promptAccountName: true,
  });
}

/** Answers the prompt, then waits for registration under that name. */
async function answerAndRegister(
  view: RenderResult,
  register: { readonly mock: { readonly calls: readonly unknown[][] } },
): Promise<void> {
  await answerAccountNamePrompt(view.container);
  await waitFor(
    () => {
      expect(getPaneStatusText(view)).not.toMatch(/userId:\s*none/);
    },
    { timeout: PANE_LONG_ASYNC_TEST_TIMEOUT_MS },
  );
  expect(register.mock.calls[0]?.[0]).toMatchObject({
    organizationProfileName: "Bob's Org",
    rosterProfileNickname: "Bob",
  });
  await waitForPaneRuntimeToSettle(PANE_LONG_ASYNC_TEST_TIMEOUT_MS);
}

test(
  "a name that could not be stored is asked for again before anything registers",
  async () => {
    useTestApiAppHandlers();
    const namespace = `test-account-name-${crypto.randomUUID()}`;
    let refusing = false;
    const storage = refuseNamingRecords(() => refusing);
    const pane = renderLifecyclePane(hostConfig(namespace));
    try {
      await waitForPersistedPaneLocalIdentity(namespace);
      await waitForPaneKey(pane.view);
      const register = spyOn(pane.sdk().session, "registerIdentity");
      const identityManager = await openIdentityManagerFromPane(pane.view);
      refusing = true;
      await answerAccountNamePrompt(
        identityManager,
        "Bob",
        PANE_LONG_ASYNC_TEST_TIMEOUT_MS,
      );
      await within(pane.view.container).findAllByText(
        ACCOUNT_NAME_SEAL_FAILED_MESSAGE,
        {},
        { timeout: PANE_LONG_ASYNC_TEST_TIMEOUT_MS },
      );
      await waitForPaneRuntimeToSettle(PANE_ASYNC_TEST_TIMEOUT_MS);
      expect(register).not.toHaveBeenCalled();

      refusing = false;
      await answerAndRegister(pane.view, register);
    } finally {
      storage.restore();
    }
    pane.view.unmount();
  },
  PANE_LONG_ASYNC_TEST_TIMEOUT_MS * 3,
);

test(
  "an identity whose prompt could not be stored is not kept, so a restart asks",
  async () => {
    useTestApiAppHandlers();
    const config = hostConfig(`test-account-name-${crypto.randomUUID()}`);
    const namespace = config.localIdentityNamespace ?? "";
    const storage = refuseNamingRecords(() => true);
    const first = renderLifecyclePane(config);
    try {
      await waitFor(() => expect(storage.refusals()).toBeGreaterThan(0), {
        timeout: PANE_LONG_ASYNC_TEST_TIMEOUT_MS,
      });
      await waitForPaneRuntimeToSettle(PANE_LONG_ASYNC_TEST_TIMEOUT_MS);
      expect(getPaneStatusText(first.view)).toMatch(/publicKey:\s*none/u);
      expect(
        globalThis.localStorage.getItem(
          `tearleads.local-identity-registry:${namespace}.left`,
        ) ?? "",
      ).not.toMatch(/[0-9a-f]{64}/u);
    } finally {
      storage.restore();
    }
    first.view.unmount();

    const second = renderLifecyclePane(config);
    const register = spyOn(second.sdk().session, "registerIdentity");
    await waitForPersistedPaneLocalIdentity(namespace);
    await waitForPaneKey(second.view);
    await openIdentityManagerFromPane(second.view);
    await within(second.view.container).findAllByRole("textbox", NAME_PROMPT, {
      timeout: PANE_LONG_ASYNC_TEST_TIMEOUT_MS,
    });
    await waitForPaneRuntimeToSettle(PANE_ASYNC_TEST_TIMEOUT_MS);
    expect(register).not.toHaveBeenCalled();
    await answerAndRegister(second.view, register);
    second.view.unmount();
  },
  PANE_LONG_ASYNC_TEST_TIMEOUT_MS * 3,
);

test(
  "a sealed record that cannot be read back asks for the name again",
  async () => {
    useTestApiAppHandlers();
    const config = hostConfig(`test-account-name-${crypto.randomUUID()}`);
    const namespace = config.localIdentityNamespace ?? "";
    const first = renderLifecyclePane(config);
    await waitForPersistedPaneLocalIdentity(namespace);
    await waitForPaneKey(first.view);
    await openIdentityManagerFromPane(first.view);
    await within(first.view.container).findAllByRole("textbox", NAME_PROMPT, {
      timeout: PANE_LONG_ASYNC_TEST_TIMEOUT_MS,
    });
    await waitForPaneRuntimeToSettle(PANE_ASYNC_TEST_TIMEOUT_MS);
    first.view.unmount();

    const key = sealedAccountNamingKey(namespace);
    if (!key) throw new Error("Expected the sealed prompt");
    globalThis.localStorage.setItem(key, "not an envelope");

    const second = renderLifecyclePane(config);
    const register = spyOn(second.sdk().session, "registerIdentity");
    await waitForPaneKey(second.view);
    await openIdentityManagerFromPane(second.view);
    await within(second.view.container).findAllByText(
      ACCOUNT_NAME_UNREADABLE_MESSAGE,
      {},
      { timeout: PANE_LONG_ASYNC_TEST_TIMEOUT_MS },
    );
    await waitForPaneRuntimeToSettle(PANE_ASYNC_TEST_TIMEOUT_MS);
    expect(register).not.toHaveBeenCalled();
    await answerAndRegister(second.view, register);
    second.view.unmount();
  },
  PANE_LONG_ASYNC_TEST_TIMEOUT_MS * 3,
);
