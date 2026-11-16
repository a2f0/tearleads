import { afterEach, expect, spyOn, test } from "bun:test";
import { waitFor, within } from "@testing-library/react";
import { answerAccountNamePrompt } from "../../test/helpers/accountNamePrompt";
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
  openContacts,
  PANE_ASYNC_TEST_TIMEOUT_MS,
  PANE_LONG_ASYNC_TEST_TIMEOUT_MS,
  waitForPaneRuntimeToSettle,
  waitForPersistedPaneLocalIdentity,
} from "../../test/helpers/paneTestUtils";

afterEach(cleanupPaneTestEnvironment, MOCK_SERVER_RESET_TIMEOUT_MS);

/** The sealed naming record of the left pane's only identity, if any. */
function sealedAccountNaming(namespace: string): string | null {
  const prefix = `tearleads.account-naming:${namespace}.left:`;
  const key = Array.from({ length: globalThis.localStorage.length }, (_, i) =>
    globalThis.localStorage.key(i),
  ).find((candidate) => candidate?.startsWith(prefix));
  return key ? globalThis.localStorage.getItem(key) : null;
}

async function waitForPaneKey(view: Parameters<typeof getPaneStatusText>[0]) {
  await waitFor(
    () => {
      expect(getPaneStatusText(view)).toMatch(/publicKey:\s*[0-9a-f]{64}/u);
    },
    { timeout: PANE_LONG_ASYNC_TEST_TIMEOUT_MS },
  );
}

test(
  "a generated identity registers only once named, as that person's org and contact",
  async () => {
    useTestApiAppHandlers();
    const { sdk, view } = renderLifecyclePane(
      createTestHostConfig({
        autoProvisionIdentity: true,
        promptAccountName: true,
      }),
    );
    await waitForPaneKey(view);
    const register = spyOn(sdk().session, "registerIdentity");

    // System bootstrap settles with the key in place, yet nothing registers
    // until the user says what to call them.
    await waitForPaneRuntimeToSettle(PANE_ASYNC_TEST_TIMEOUT_MS);
    expect(register).not.toHaveBeenCalled();
    expect(getPaneStatusText(view)).toMatch(/userId:\s*none/);

    // Identity Manager stays open behind the gate and carries the prompt.
    await answerAccountNamePrompt(await openIdentityManagerFromPane(view));
    await waitFor(
      () => {
        expect(getPaneStatusText(view)).not.toMatch(/userId:\s*none/);
      },
      { timeout: PANE_LONG_ASYNC_TEST_TIMEOUT_MS },
    );
    expect(register).toHaveBeenCalledTimes(1);
    expect(register.mock.calls[0]?.[0]).toMatchObject({
      organizationProfileName: "Bob's Org",
    });

    await waitForPaneRuntimeToSettle(PANE_LONG_ASYNC_TEST_TIMEOUT_MS);
    const contactsWindow = await openContacts(view);
    await waitFor(
      () => {
        expect(
          within(contactsWindow).getAllByRole("button", { name: "Bob" }),
        ).toHaveLength(1);
      },
      { timeout: PANE_ASYNC_TEST_TIMEOUT_MS },
    );
    expect(
      within(contactsWindow).queryByRole("button", { name: "You" }),
    ).toBeNull();
    view.unmount();
  },
  PANE_LONG_ASYNC_TEST_TIMEOUT_MS * 3,
);

test(
  "the prompt and a name given offline both survive restarts until the name is saved",
  async () => {
    useTestApiAppHandlers();
    const namespace = `test-account-name-${crypto.randomUUID()}`;
    const hostConfig = createTestHostConfig({
      autoProvisionIdentity: true,
      createLocalKeyring: createSharedMemoryLocalKeyringFactory(),
      localIdentityNamespace: namespace,
      promptAccountName: true,
    });

    // First launch: closed before answering.
    const first = renderLifecyclePane(hostConfig);
    const firstRegister = spyOn(first.sdk().session, "registerIdentity");
    await waitForPaneKey(first.view);
    await openIdentityManagerFromPane(first.view);
    await within(first.view.container).findByRole(
      "textbox",
      { name: "What should we call you?" },
      { timeout: PANE_LONG_ASYNC_TEST_TIMEOUT_MS },
    );
    await waitForPersistedPaneLocalIdentity(namespace);
    await waitFor(() => expect(sealedAccountNaming(namespace)).not.toBeNull());
    expect(firstRegister).not.toHaveBeenCalled();
    first.view.unmount();

    // The restarted identity asks again, and its answer fails to register.
    const second = renderLifecyclePane(hostConfig);
    const offline = spyOn(
      second.sdk().session,
      "registerIdentity",
    ).mockRejectedValue(new TypeError("Failed to fetch"));
    const awaitingRecord = sealedAccountNaming(namespace);
    await waitForPaneKey(second.view);
    await answerAccountNamePrompt(
      await openIdentityManagerFromPane(second.view),
      "Bob",
      PANE_LONG_ASYNC_TEST_TIMEOUT_MS,
    );
    await waitFor(
      () => {
        expect(offline).toHaveBeenCalledTimes(1);
        expect(sealedAccountNaming(namespace)).not.toBe(awaitingRecord);
      },
      { timeout: PANE_LONG_ASYNC_TEST_TIMEOUT_MS },
    );
    await waitForPaneRuntimeToSettle(PANE_ASYNC_TEST_TIMEOUT_MS);
    second.view.unmount();

    // Back online after another restart: registers under the given name
    // without asking again, names the account's self contact, and only then
    // drops the sealed record.
    const third = renderLifecyclePane(hostConfig);
    const register = spyOn(third.sdk().session, "registerIdentity");
    await waitFor(
      () => {
        expect(getPaneStatusText(third.view)).not.toMatch(/userId:\s*none/);
      },
      { timeout: PANE_LONG_ASYNC_TEST_TIMEOUT_MS },
    );
    expect(register.mock.calls[0]?.[0]).toMatchObject({
      organizationProfileName: "Bob's Org",
    });
    expect(
      within(third.view.container).queryByRole("textbox", {
        name: "What should we call you?",
      }),
    ).toBeNull();
    await waitForPaneRuntimeToSettle(PANE_LONG_ASYNC_TEST_TIMEOUT_MS);
    const contactsWindow = await openContacts(third.view);
    await waitFor(
      () => {
        expect(
          within(contactsWindow).getAllByRole("button", { name: "Bob" }),
        ).toHaveLength(1);
      },
      { timeout: PANE_ASYNC_TEST_TIMEOUT_MS },
    );
    await waitFor(() => expect(sealedAccountNaming(namespace)).toBeNull(), {
      timeout: PANE_LONG_ASYNC_TEST_TIMEOUT_MS,
    });
    await waitForPaneRuntimeToSettle(PANE_LONG_ASYNC_TEST_TIMEOUT_MS);
    third.view.unmount();

    // The saved nickname is still there after a restart, nothing asks again,
    // and nothing re-registers.
    const fourth = renderLifecyclePane(hostConfig);
    const reRegister = spyOn(fourth.sdk().session, "registerIdentity");
    await waitFor(
      () => {
        expect(getPaneStatusText(fourth.view)).not.toMatch(/userId:\s*none/);
      },
      { timeout: PANE_LONG_ASYNC_TEST_TIMEOUT_MS },
    );
    await waitForPaneRuntimeToSettle(PANE_LONG_ASYNC_TEST_TIMEOUT_MS);
    const reloadedContacts = await openContacts(fourth.view);
    await waitFor(
      () => {
        expect(
          within(reloadedContacts).getAllByRole("button", { name: "Bob" }),
        ).toHaveLength(1);
      },
      { timeout: PANE_ASYNC_TEST_TIMEOUT_MS },
    );
    expect(sealedAccountNaming(namespace)).toBeNull();
    expect(reRegister).not.toHaveBeenCalled();
    await waitForPaneRuntimeToSettle(PANE_LONG_ASYNC_TEST_TIMEOUT_MS);
    fourth.view.unmount();
  },
  PANE_LONG_ASYNC_TEST_TIMEOUT_MS * 5,
);
