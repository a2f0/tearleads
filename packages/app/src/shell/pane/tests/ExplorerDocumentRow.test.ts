import { expect, test } from "bun:test";
import { waitForExplorerDocumentRow } from "../../../../test/helpers/dual-pane/explorerDocumentRow";

test("contact lookup reselects its folder after a recovery remap", async () => {
  const pane = document.createElement("section");
  const sidebarItem = document.createElement("button");
  sidebarItem.className = "explorer-sidebar-item";
  sidebarItem.textContent = "Contacts";
  const table = document.createElement("table");
  const row = table.insertRow();
  const button = document.createElement("button");
  button.textContent = "You";
  row.insertCell().append(button);
  table.setAttribute("aria-label", "Items in /");
  pane.append(sidebarItem, table);
  document.body.append(pane);

  let selections = 0;
  sidebarItem.addEventListener("click", () => {
    selections += 1;
    table.setAttribute("aria-label", "Items in Contacts");
    if (selections === 1) {
      // Hydration replaces the provisional folder after the click succeeds.
      queueMicrotask(() => table.setAttribute("aria-label", "Items in /"));
    }
  });

  try {
    expect(await waitForExplorerDocumentRow(pane, "You", "Contacts")).toBe(row);
    expect(selections).toBe(2);
    expect(table.getAttribute("aria-label")).toBe("Items in Contacts");
  } finally {
    pane.remove();
  }
});
