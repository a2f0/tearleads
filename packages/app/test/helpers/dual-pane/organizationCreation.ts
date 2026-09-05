import { expect } from "bun:test";
import { fireEvent, screen, waitFor, within } from "@testing-library/react";
import invariant from "invariant";
import { waitForCondition } from "../waitForCondition";
import { interact } from "./dualPaneCore";

export async function createAdditionalOrganization(
  pane: HTMLElement,
  name: string,
) {
  const organizationSelect = within(pane).getByRole("combobox", {
    name: "Organizations",
  });
  invariant(
    organizationSelect instanceof HTMLButtonElement,
    "Expected organization selector.",
  );
  await waitFor(() => {
    expect(organizationSelect.disabled).toBe(false);
  });
  await interact(() => {
    fireEvent.click(organizationSelect);
  });
  await interact(() => {
    fireEvent.click(
      within(pane).getByRole("button", { name: "New Organization" }),
    );
  });

  const dialog = await screen.findByRole("dialog", {
    name: "New Organization",
  });
  await interact(() => {
    fireEvent.change(within(dialog).getByLabelText("Organization name"), {
      target: { value: name },
    });
  });
  await interact(() => {
    fireEvent.click(within(dialog).getByRole("button", { name: "Create" }));
  });
  await waitForCondition(
    () => screen.queryByRole("dialog", { name: "New Organization" }) === null,
    `Organization creation did not finish: ${dialog.textContent?.trim() ?? "unknown dialog state"}`,
    20_000,
  );
}
