import { expect } from "bun:test";
import { act, fireEvent, waitFor, within } from "@testing-library/react";
import { flattenPaneStatusText } from "../paneTestUtils";
import { waitForCondition } from "../waitForCondition";

/** Wait for the restore action itself, not a transient identity/session pair. */
export async function restorePaneRecoveryKey(input: {
  readonly identityManager: HTMLElement;
  readonly pane: HTMLElement;
  readonly seedPhrase: string;
  readonly timeoutMs: number;
}) {
  const { identityManager, pane, seedPhrase, timeoutMs } = input;
  const previousRestores = within(pane).queryAllByText(
    /Recovery key restored$/u,
  ).length;
  fireEvent.click(
    within(identityManager).getByRole("button", { name: "Recovery Key" }),
  );
  fireEvent.click(
    within(identityManager).getByRole("tab", { name: "Recovery" }),
  );
  const restoreInput =
    within(identityManager).getByLabelText("Restore passphrase");
  await act(() => {
    fireEvent.change(restoreInput, { target: { value: seedPhrase } });
  });
  await act(() => {
    fireEvent.click(
      within(identityManager).getByRole("button", {
        name: "Restore from Passphrase",
      }),
    );
  });

  await waitForCondition(
    () =>
      within(pane).queryAllByText(/Recovery key restored$/u).length >
      previousRestores,
    "Recovery key restoration did not finish.",
    timeoutMs,
  );
  await waitFor(() => {
    expect(flattenPaneStatusText(pane)).toMatch(
      /(?:sqlite worker|SQLite Worker):\s*ready/,
    );
  });
}
