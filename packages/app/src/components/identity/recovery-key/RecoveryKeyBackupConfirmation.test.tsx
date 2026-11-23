import { afterEach, expect, mock, test } from "bun:test";
import type { Tearleads } from "@tearleads/client-sdk";
import { createIdentitySeedPhraseFromEntropy } from "@tearleads/crypto";
import { act, fireEvent, render, waitFor } from "@testing-library/react";
import { RECOVERY_KEY_BACKUP_AGREEMENT_LABEL } from "../../../../test/helpers/accountNamePrompt";
import {
  cleanupIdentityManagerTestEnvironment,
  createIdentityManagerHostConfig,
  IdentityManagerTestRuntime,
} from "../../../../test/helpers/identityManagerTestRuntime";
import { ACKNOWLEDGEMENT_LABEL } from "../../../../test/helpers/recoveryKeyTestKit";
import { RecoveryKeyBackupConfirmation } from "./RecoveryKeyBackupConfirmation";
import { RECOVERY_KEY_ACKNOWLEDGEMENT_PHRASE } from "./recoveryKeyDisclosure";

afterEach(cleanupIdentityManagerTestEnvironment);

async function renderConfirmation() {
  const onConfirm = mock(() => {});
  const sdk: { current: Tearleads | null } = { current: null };
  const view = render(
    <IdentityManagerTestRuntime
      hostConfig={createIdentityManagerHostConfig()}
      onTearleadsReady={(ready) => {
        sdk.current = ready;
      }}
    >
      <RecoveryKeyBackupConfirmation onConfirm={onConfirm} />
    </IdentityManagerTestRuntime>,
  );
  await waitFor(() => expect(sdk.current).not.toBeNull());
  const seedPhrase = createIdentitySeedPhraseFromEntropy(
    new Uint8Array(32).fill(0x21),
  );
  await act(async () => {
    await sdk.current?.identity.importSeedPhrase(seedPhrase);
  });
  await view.findByRole("button", { name: "Reveal Recovery Key" });
  return { onConfirm, seedPhrase, view };
}

test("continuing requires the exact agreement phrase", async () => {
  const { onConfirm, view } = await renderConfirmation();
  const agreement = view.getByLabelText(RECOVERY_KEY_BACKUP_AGREEMENT_LABEL);
  const proceed = view.getByRole("button", { name: "Continue" });

  expect(
    view.getByRole("heading", { name: "Back up your recovery key" }),
  ).toBeTruthy();
  expect(proceed.hasAttribute("disabled")).toBe(true);
  fireEvent.change(agreement, { target: { value: "i agree" } });
  expect(proceed.hasAttribute("disabled")).toBe(true);
  fireEvent.submit(proceed);
  expect(onConfirm).not.toHaveBeenCalled();

  fireEvent.change(agreement, { target: { value: "  I agree " } });
  expect(proceed.hasAttribute("disabled")).toBe(false);
  fireEvent.click(proceed);
  expect(onConfirm).toHaveBeenCalledTimes(1);
});

test("the backup controls keep their own acknowledgement before revealing", async () => {
  const { onConfirm, seedPhrase, view } = await renderConfirmation();

  fireEvent.click(view.getByRole("button", { name: "Reveal Recovery Key" }));
  expect(view.queryByText(seedPhrase)).toBeNull();
  fireEvent.change(view.getByLabelText(ACKNOWLEDGEMENT_LABEL), {
    target: { value: RECOVERY_KEY_ACKNOWLEDGEMENT_PHRASE },
  });
  fireEvent.click(view.getByRole("button", { name: "Show Passphrase" }));

  expect(view.getByRole("textbox", { name: "Passphrase" })).toHaveProperty(
    "value",
    seedPhrase,
  );
  // Revealing the key is not the agreement that it is backed up.
  expect(onConfirm).not.toHaveBeenCalled();
});
