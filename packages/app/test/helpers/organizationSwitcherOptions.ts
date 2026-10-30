import { type ByRoleOptions, within } from "@testing-library/react";

/**
 * The options of a pane's open organization switcher, or none while it is
 * closed. Reading them from the switcher's own listbox keeps other options in
 * the pane, such as the desktop's app icons, out of the count.
 */
export function organizationSwitcherOptions(
  pane: HTMLElement,
  options?: ByRoleOptions,
): HTMLElement[] {
  const select = within(pane).getByRole("combobox", { name: "Organizations" });
  const listboxId = select.getAttribute("aria-controls");
  const listbox = listboxId
    ? pane.ownerDocument.getElementById(listboxId)
    : null;
  return listbox ? within(listbox).queryAllByRole("option", options) : [];
}
