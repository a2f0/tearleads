import { afterEach, expect, mock, test } from "bun:test";
import { act, fireEvent, waitFor } from "@testing-library/react";
import { createIdentityManagerHostConfig } from "../../../../test/helpers/identityManagerTestRuntime";
import {
  ACKNOWLEDGEMENT_LABEL,
  cleanupRecoveryKeyTestEnvironment,
  renderRecoveryKeyView,
} from "../../../../test/helpers/recoveryKeyTestKit";
import "../../../../test/helpers/msw/server";
import { MOCK_SERVER_RESET_TIMEOUT_MS } from "../../../../test/helpers/msw/server";
import type {
  PasswordKeychain,
  PasswordKeychainEntry,
} from "../../../host/PasswordKeychain";
import {
  identityKeychainEntry,
  KEYCHAIN_SAVE_STATUS,
} from "../../../identity/identityKeychain";
import { RECOVERY_KEY_ACKNOWLEDGEMENT_PHRASE } from "../actions/recoveryKeyDisclosure";

afterEach(cleanupRecoveryKeyTestEnvironment, MOCK_SERVER_RESET_TIMEOUT_MS);

const SAVE = { name: "Save to Password Manager" };
const CONFIRM = { name: "Continue to Password Manager" };

function withKeychain(keychain: Partial<PasswordKeychain>) {
  const complete: PasswordKeychain = {
    pick: async () => null,
    save: async () => "saved",
    ...keychain,
  };
  return createIdentityManagerHostConfig().withOverrides({
    createPasswordKeychain: () => complete,
  });
}

test("without a password manager, the recovery key offers no save", async () => {
  const { view } = await renderRecoveryKeyView(0x31);
  expect(view.queryByRole("button", SAVE)).toBeNull();
});

test("saving to the password manager requires the acknowledgement phrase", async () => {
  const save = mock(async (_entry: PasswordKeychainEntry) => "saved" as const);
  const { seedPhrase, tearleads, view } = await renderRecoveryKeyView(
    0x32,
    withKeychain({ save }),
  );
  fireEvent.click(view.getByRole("button", SAVE));
  expect(
    view.getByRole("heading", {
      name: "Save recovery key to password manager",
    }),
  ).toBeTruthy();
  const confirm = view.getByRole("button", CONFIRM) as HTMLButtonElement;
  expect(confirm.disabled).toBe(true);
  expect(save).not.toHaveBeenCalled();

  fireEvent.change(view.getByLabelText(ACKNOWLEDGEMENT_LABEL), {
    target: { value: RECOVERY_KEY_ACKNOWLEDGEMENT_PHRASE },
  });
  await act(async () => {
    fireEvent.click(confirm);
  });

  const signingFingerprint = tearleads.identity.signingFingerprint;
  if (!signingFingerprint) throw new Error("Expected an identity");
  expect(save).toHaveBeenCalledWith(
    identityKeychainEntry(signingFingerprint, seedPhrase),
  );
  expect(
    await view.findByText("Recovery key saved to your password manager."),
  ).toBeTruthy();
});

test("a password manager that fails reports the failure", async () => {
  const { view } = await renderRecoveryKeyView(
    0x33,
    withKeychain({
      save: async () => {
        throw new Error("No password manager is set up on this device.");
      },
    }),
  );
  fireEvent.click(view.getByRole("button", SAVE));
  fireEvent.change(view.getByLabelText(ACKNOWLEDGEMENT_LABEL), {
    target: { value: RECOVERY_KEY_ACKNOWLEDGEMENT_PHRASE },
  });
  await act(async () => {
    fireEvent.click(view.getByRole("button", CONFIRM));
  });
  expect(
    await view.findByText("No password manager is set up on this device."),
  ).toBeTruthy();
});

test("a device with no password manager says how to set one up", async () => {
  const { view } = await renderRecoveryKeyView(
    0x35,
    withKeychain({ save: async () => "unavailable" }),
  );
  fireEvent.click(view.getByRole("button", SAVE));
  fireEvent.change(view.getByLabelText(ACKNOWLEDGEMENT_LABEL), {
    target: { value: RECOVERY_KEY_ACKNOWLEDGEMENT_PHRASE },
  });
  await act(async () => {
    fireEvent.click(view.getByRole("button", CONFIRM));
  });
  expect(await view.findByText(KEYCHAIN_SAVE_STATUS.unavailable)).toBeTruthy();
});

test("restoring can fill the passphrase from the password manager", async () => {
  const picks: Array<string | null> = [null, "saved phrase from keychain"];
  const { view } = await renderRecoveryKeyView(
    0x34,
    withKeychain({ pick: async () => picks.shift() ?? null }),
  );
  fireEvent.click(view.getByRole("tab", { name: "Recovery" }));
  const input = (await view.findByLabelText(
    "Restore passphrase",
  )) as HTMLTextAreaElement;
  const use = view.getByRole("button", { name: "Use Saved Passphrase" });

  // Dismissing the chooser leaves the field as it was.
  await act(async () => {
    fireEvent.click(use);
  });
  expect(input.value).toBe("");

  await act(async () => {
    fireEvent.click(use);
  });
  await waitFor(() => expect(input.value).toBe("saved phrase from keychain"));
});
