import { afterEach, expect, spyOn, test } from "bun:test";
import { fireEvent, waitFor, within } from "@testing-library/react";
import {
  answerAccountNamePrompt,
  sealedAccountNamingRecord as sealedAccountNaming,
  waitForPaneKey,
} from "../../test/helpers/accountNamePrompt";
import { openIdentityManagerFromPane } from "../../test/helpers/identityPaneTestUtils";
import {
  MOCK_SERVER_RESET_TIMEOUT_MS,
  useTestApiAppHandlers,
} from "../../test/helpers/msw/server";
import {
  renderLifecyclePane,
  unmountLifecyclePane,
} from "../../test/helpers/paneLifecycleTestUtils";
import {
  cleanupPaneTestEnvironment,
  clickPaneAppMenuItem,
  createSharedMemoryLocalKeyringFactory,
  createTestHostConfig,
  getPaneStatusText,
  openContacts,
  PANE_ASYNC_TEST_TIMEOUT_MS,
  PANE_LONG_ASYNC_TEST_TIMEOUT_MS,
  waitForPaneRuntimeToSettle,
  waitForPersistedPaneLocalIdentity,
} from "../../test/helpers/paneTestUtils";
import { createPersistedPaneStorage } from "../../test/helpers/persistedPaneStorage";

afterEach(cleanupPaneTestEnvironment, MOCK_SERVER_RESET_TIMEOUT_MS);

test(
  "a generated identity registers only once named, as that person's org, contact, and roster entry",
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
      rosterProfileNickname: "Bob",
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

    // The roster lists the account under its name, not "You".
    fireEvent.contextMenu(view.getByRole("application"), {
      clientX: 120,
      clientY: 120,
    });
    clickPaneAppMenuItem(view, "Org Manager");
    const roster = await view.findByRole(
      "table",
      { name: "Roster" },
      { timeout: PANE_LONG_ASYNC_TEST_TIMEOUT_MS },
    );
    expect(
      await within(roster).findByRole(
        "button",
        { name: "Actions for Bob" },
        { timeout: PANE_LONG_ASYNC_TEST_TIMEOUT_MS },
      ),
    ).toBeTruthy();
    expect(within(roster).queryByText("You")).toBeNull();
    await waitForPaneRuntimeToSettle(PANE_LONG_ASYNC_TEST_TIMEOUT_MS);
    view.unmount();
  },
  PANE_LONG_ASYNC_TEST_TIMEOUT_MS * 3,
);

test(
  "the prompt and a name given offline both survive restarts until the name is saved",
  async () => {
    useTestApiAppHandlers();
    const namespace = `test-account-name-${crypto.randomUUID()}`;
    const storage = createPersistedPaneStorage();
    const hostConfig = createTestHostConfig({
      autoProvisionIdentity: true,
      createLocalKeyring: createSharedMemoryLocalKeyringFactory(),
      localIdentityNamespace: namespace,
      promptAccountName: true,
    }).withOverrides({ createSQLiteRuntime: storage.createRuntime });

    // First launch: closed before answering. The identity is stored only
    // after its pending prompt, so no restart can find one without the other.
    const first = renderLifecyclePane(hostConfig);
    const firstRegister = spyOn(first.sdk().session, "registerIdentity");
    await waitForPersistedPaneLocalIdentity(namespace);
    expect(sealedAccountNaming(namespace)).not.toBeNull();
    await waitForPaneKey(first.view);
    await openIdentityManagerFromPane(first.view);
    await within(first.view.container).findByRole(
      "textbox",
      { name: "What should we call you?" },
      { timeout: PANE_LONG_ASYNC_TEST_TIMEOUT_MS },
    );
    expect(firstRegister).not.toHaveBeenCalled();
    await unmountLifecyclePane(first);

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
    await unmountLifecyclePane(second);

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
      rosterProfileNickname: "Bob",
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
    await unmountLifecyclePane(third);

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
