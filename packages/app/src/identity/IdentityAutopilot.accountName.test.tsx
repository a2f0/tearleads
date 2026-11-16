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
  createTestHostConfig,
  getPaneStatusText,
  openContacts,
  PANE_ASYNC_TEST_TIMEOUT_MS,
  PANE_LONG_ASYNC_TEST_TIMEOUT_MS,
  waitForPaneRuntimeToSettle,
} from "../../test/helpers/paneTestUtils";

afterEach(cleanupPaneTestEnvironment, MOCK_SERVER_RESET_TIMEOUT_MS);

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
    await waitFor(
      () => {
        expect(getPaneStatusText(view)).toMatch(/publicKey:\s*[0-9a-f]{64}/u);
      },
      { timeout: PANE_LONG_ASYNC_TEST_TIMEOUT_MS },
    );
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
