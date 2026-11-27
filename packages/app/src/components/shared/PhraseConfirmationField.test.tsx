import { afterEach, expect, test } from "bun:test";
import { cleanup, render } from "@testing-library/react";
import { RECOVERY_KEY_BACKUP_AGREEMENT_PHRASE } from "../identity/recovery-key/RecoveryKeyBackupConfirmation";
import { RECOVERY_KEY_ACKNOWLEDGEMENT_PHRASE } from "../identity/recovery-key/recoveryKeyDisclosure";
import { DESTROY_KEY_PACKAGE_CONFIRMATION_PHRASE } from "./DestroyKeyPackageConfirmationDialog";
import {
  isPhraseConfirmed,
  PhraseConfirmationField,
} from "./PhraseConfirmationField";
import { RESET_DEVICE_CONFIRMATION_PHRASE } from "./ResetDeviceConfirmationDialog";

afterEach(() => cleanup());

const PHRASES = [
  DESTROY_KEY_PACKAGE_CONFIRMATION_PHRASE,
  RECOVERY_KEY_ACKNOWLEDGEMENT_PHRASE,
  RECOVERY_KEY_BACKUP_AGREEMENT_PHRASE,
  RESET_DEVICE_CONFIRMATION_PHRASE,
];

/** What a touch keyboard capitalizing sentences makes of plain typing. */
function typedOnTouchKeyboard(keys: string): string {
  return keys.charAt(0).toUpperCase() + keys.slice(1);
}

test("every phrase is what a touch keyboard types without reaching for shift", () => {
  for (const phrase of PHRASES) {
    const typed = typedOnTouchKeyboard(phrase.toLowerCase());
    expect(typed).toBe(phrase);
    expect(isPhraseConfirmed(typed, phrase)).toBe(true);
    // The match is exact, which is why the phrase follows the keyboard.
    expect(isPhraseConfirmed(phrase.toLowerCase(), phrase)).toBe(false);
  }
});

test("the field asks the keyboard to capitalize sentences, as its phrase is", () => {
  const view = render(
    <PhraseConfirmationField
      onChange={() => {}}
      phrase={RESET_DEVICE_CONFIRMATION_PHRASE}
      value=""
    />,
  );

  expect(
    view
      .getByLabelText(`Type ${RESET_DEVICE_CONFIRMATION_PHRASE} to continue`)
      .getAttribute("autocapitalize"),
  ).toBe("sentences");
});
