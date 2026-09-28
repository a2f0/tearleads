import { expect, test } from "bun:test";
import { readPaneExplorerDocumentIdentity } from "../../../../test/helpers/dual-pane/dualPaneRecoveryKit";

for (const remap of [false, true]) {
  test(`document identity lookup survives Info navigation during recovery (remap=${remap})`, async () => {
    const pane = document.createElement("section");
    const sidebarItem = document.createElement("button");
    sidebarItem.className = "explorer-sidebar-item";
    sidebarItem.textContent = "Contacts";
    const content = document.createElement("div");
    const menu = document.createElement("div");
    menu.className = "menu";
    const containerId = "00000000-0000-0000-0000-000000000001";
    const documentId = "00000000-0000-0000-0000-000000000002";
    let opens = 0;
    let pending: ReturnType<typeof setTimeout> | undefined;

    const showRows = (panel: HTMLElement) => {
      const table = document.createElement("table");
      for (const [label, value] of [
        ["Document ID", documentId],
        ["Local ID", "self-contact"],
        ["Container", containerId],
        ["Type", "contact"],
      ]) {
        const row = table.insertRow();
        const heading = document.createElement("th");
        heading.scope = "row";
        heading.textContent = label ?? "";
        row.append(heading);
        const cell = row.insertCell();
        cell.title = value ?? "";
        cell.textContent = value ?? "";
      }
      panel.append(table);
    };
    const showFolder = (name: string) => {
      const table = document.createElement("table");
      table.setAttribute("aria-label", `Items in ${name}`);
      const row = table.insertRow();
      const item = document.createElement("button");
      item.textContent = "You";
      row.insertCell().append(item);
      row.addEventListener("contextmenu", () => {
        const action = document.createElement("button");
        action.textContent = "Get Info";
        action.addEventListener("click", () => {
          opens += 1;
          menu.replaceChildren();
          if (remap && opens === 1) {
            // A recovery remap invalidates the provisional container route
            // after Get Info was clicked. Waiting on that route cannot recover.
            showFolder("/");
            return;
          }
          const panel = document.createElement("section");
          panel.className = "explorer-detail--document-info";
          content.replaceChildren(panel);
          // An intact panel must get time to finish its asynchronous read.
          pending = setTimeout(() => showRows(panel), 75);
        });
        menu.replaceChildren(action);
      });
      content.replaceChildren(table);
    };
    sidebarItem.addEventListener("click", () => showFolder("Contacts"));
    pane.append(sidebarItem, content);
    document.body.append(pane, menu);
    showFolder("Contacts");

    try {
      expect(
        await readPaneExplorerDocumentIdentity(pane, "You", {
          containerName: "Contacts",
        }),
      ).toEqual({ containerId, documentId, localId: "self-contact" });
      expect(opens).toBe(remap ? 2 : 1);
    } finally {
      clearTimeout(pending);
      pane.remove();
      menu.remove();
    }
  }, 15_000);
}
