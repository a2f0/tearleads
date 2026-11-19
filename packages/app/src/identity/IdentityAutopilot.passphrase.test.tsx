import { afterEach, expect, spyOn, test } from "bun:test";
import * as Crypto from "@tearleads/crypto";
import { fireEvent, waitFor, within } from "@testing-library/react";
import {
  answerAccountNamePrompt,
  chooseNewIdentity,
} from "../../test/helpers/accountNamePrompt";
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
  createTestHostConfig,
  PANE_LONG_ASYNC_TEST_TIMEOUT_MS,
} from "../../test/helpers/paneTestUtils";

afterEach(cleanupPaneTestEnvironment, MOCK_SERVER_RESET_TIMEOUT_MS);

test(
  "a fresh device restores the original account from a pasted passphrase",
  async () => {
    useTestApiAppHandlers();
    const config = createTestHostConfig({
      autoProvisionIdentity: true,
      promptAccountName: true,
    });
    using generate = spyOn(Crypto, "createIdentitySeedPhrase");
    const original = renderLifecyclePane(config);
    await chooseNewIdentity(original.pane);
    expect(generate).not.toHaveBeenCalled();
    await answerAccountNamePrompt(original.pane);
    await waitFor(
      () => expect(original.sdk().session.snapshot.isAuthenticated).toBe(true),
      { timeout: PANE_LONG_ASYNC_TEST_TIMEOUT_MS },
    );
    const { signingFingerprint, seedPhrase } = original.sdk().identity.snapshot;
    const { userId } = original.sdk().session.snapshot;
    if (!seedPhrase || !signingFingerprint || !userId)
      throw new Error("Expected a registered identity");
    expect(generate).toHaveBeenCalledTimes(1);
    await unmountLifecyclePane(original);

    const device = renderLifecyclePane(config);
    const register = spyOn(device.sdk().session, "registerIdentity");
    const recovery = within(device.pane);
    fireEvent.click(
      await recovery.findByRole("button", { name: "Restore identity" }),
    );
    const phrase = () =>
      recovery.getByRole("textbox", { name: "Recovery passphrase" });
    const submit = () =>
      recovery.getByRole("button", { name: "Restore from passphrase" });
    expect(submit().hasAttribute("disabled")).toBe(true);
    fireEvent.change(phrase(), { target: { value: "invalid words" } });
    fireEvent.click(submit());
    await recovery.findByRole("alert");
    expect(device.sdk().identity.signingKeyPair).toBeNull();
    fireEvent.click(recovery.getByRole("button", { name: "Back" }));
    fireEvent.click(recovery.getByRole("button", { name: "Restore identity" }));
    expect((phrase() as HTMLTextAreaElement).value).toBe("");
    fireEvent.change(phrase(), {
      target: { value: seedPhrase.split(" ").join("\n") },
    });
    fireEvent.click(submit());
    await waitFor(
      () => expect(device.sdk().session.snapshot.isAuthenticated).toBe(true),
      { timeout: PANE_LONG_ASYNC_TEST_TIMEOUT_MS },
    );
    expect(device.sdk().identity.signingFingerprint).toBe(signingFingerprint);
    expect(device.sdk().session.snapshot.userId).toBe(userId);
    expect(register).not.toHaveBeenCalled();
    expect(generate).toHaveBeenCalledTimes(1);
    await unmountLifecyclePane(device);
  },
  PANE_LONG_ASYNC_TEST_TIMEOUT_MS * 3,
);
