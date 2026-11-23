import { afterEach, expect, test } from "bun:test";
import { act, fireEvent, within } from "@testing-library/react";
import { createIdentityManagerHostConfig } from "../../../../test/helpers/identityManagerTestRuntime";
import {
  ACKNOWLEDGEMENT_LABEL,
  cleanupRecoveryKeyTestEnvironment,
  renderRecoveryKeyView,
} from "../../../../test/helpers/recoveryKeyTestKit";
import "../../../../test/helpers/msw/server";
import { MOCK_SERVER_RESET_TIMEOUT_MS } from "../../../../test/helpers/msw/server";
import { RECOVERY_KEY_ACKNOWLEDGEMENT_PHRASE } from "./recoveryKeyDisclosure";

afterEach(cleanupRecoveryKeyTestEnvironment, MOCK_SERVER_RESET_TIMEOUT_MS);

/** A host with a password manager, so every action is offered. */
const WITH_KEYCHAIN = createIdentityManagerHostConfig().withOverrides({
  createPasswordKeychain: () => ({
    pick: async () => null,
    save: async () => "saved",
  }),
});

function actionRows(
  view: Awaited<ReturnType<typeof renderRecoveryKeyView>>["view"],
) {
  const menu = view.getByRole("list", { name: "Recovery key actions" });
  return {
    menu,
    rows: within(menu)
      .getAllByRole("listitem")
      .map((item) => within(item).getByRole("button")),
  };
}

test("the recovery key actions are a menu of labelled rows, one per line", async () => {
  const { view } = await renderRecoveryKeyView(0x51, WITH_KEYCHAIN);
  const { rows } = actionRows(view);

  expect(rows.map((row) => row.textContent)).toEqual([
    "View",
    "QR Code",
    "Print",
    "Download",
    "Save",
    "Copy",
  ]);
  const names = rows.map((row) => row.getAttribute("aria-label") ?? "");
  expect(names).toEqual([
    "View Recovery Key",
    "QR Code for Recovery Key",
    "Print Recovery Key",
    "Download Recovery Key",
    "Save to Password Manager",
    "Copy Recovery Key",
  ]);
  // Speech control says what a row reads, so each name starts with its label.
  for (const [index, row] of rows.entries()) {
    expect(names[index]?.startsWith(row.textContent ?? "\u0000")).toBe(true);
  }
  // Borderless menu rows, not framed buttons.
  for (const row of rows) {
    expect(row.classList.contains("mini-app-row--button")).toBe(true);
    expect(row.classList.contains("mini-app-button")).toBe(false);
  }
});

test("revealing swaps the row's label in place and shows the key below the menu", async () => {
  const { seedPhrase, view } = await renderRecoveryKeyView(0x52);
  const before = actionRows(view);

  fireEvent.click(view.getByRole("button", { name: "View Recovery Key" }));
  fireEvent.change(view.getByLabelText(ACKNOWLEDGEMENT_LABEL), {
    target: { value: RECOVERY_KEY_ACKNOWLEDGEMENT_PHRASE },
  });
  await act(async () => {
    fireEvent.click(view.getByRole("button", { name: "Show Passphrase" }));
  });

  const after = actionRows(view);
  expect(after.rows[0]?.textContent).toBe("Hide");
  expect(after.rows[0]?.getAttribute("aria-label")).toBe("Hide Recovery Key");
  expect(after.rows.length).toBe(before.rows.length);
  // The revealed passphrase comes after the menu, so no row moves under the
  // pointer when it appears.
  const passphrase = view.getByDisplayValue(seedPhrase);
  expect(
    after.menu.compareDocumentPosition(passphrase) &
      Node.DOCUMENT_POSITION_FOLLOWING,
  ).toBeTruthy();
});
