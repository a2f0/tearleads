import { waitFor, within } from "@testing-library/react";
import invariant from "invariant";
import { getExplorerSidebarItem, interact } from "./dualPaneCore";

export function waitForExplorerDocumentRow(
  pane: HTMLElement,
  itemLabel: string,
  containerName?: string,
): Promise<HTMLTableRowElement> {
  return waitFor(
    async () => {
      const tableName = containerName
        ? `Items in ${containerName}`
        : /^Items in /u;
      // Recovery can replace a provisional container and reset the selection
      // after navigation completed. Reacquire its named folder on each poll.
      if (
        containerName &&
        !within(pane).queryByRole("table", { name: tableName })
      ) {
        await interact(() =>
          getExplorerSidebarItem(pane, containerName).click(),
        );
      }
      const table = within(pane).getByRole("table", { name: tableName });
      const row = within(table)
        .getByRole("button", { name: itemLabel })
        .closest("tr");
      invariant(row, `Expected an Explorer row for ${itemLabel}.`);
      return row;
    },
    { timeout: 10_000 },
  );
}
