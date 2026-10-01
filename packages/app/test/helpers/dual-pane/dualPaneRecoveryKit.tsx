import { expect } from "bun:test";
import { fireEvent, waitFor, within } from "@testing-library/react";
import invariant from "invariant";
import { RECOVERY_KEY_ACKNOWLEDGEMENT_PHRASE } from "../../../src/mini-apps/identity-manager/actions/recoveryKeyDisclosure";
import {
  DUAL_PANE_TEST_TIMEOUT_MS,
  interact,
  openIdentityManagerForPane,
} from "./dualPaneCore";
import { restorePaneRecoveryKey as restorePaneRecoveryKeyAction } from "./dualPaneRecoveryKeyActions";
import { waitForExplorerDocumentRow } from "./explorerDocumentRow";

export async function createPaneCustomContact(
  pane: HTMLElement,
  input: {
    firstName: string;
    lastName: string;
    nickname: string;
  },
) {
  await interact(() => {
    fireEvent.contextMenu(pane, { clientX: 140, clientY: 140 });
  });
  const paneMenu = document.querySelector<HTMLElement>(".menu");
  invariant(paneMenu, "Expected pane menu for Contacts.");
  await interact(() => {
    fireEvent.click(within(paneMenu).getByRole("button", { name: "Contacts" }));
  });

  const contactsWindow = await waitFor(() => {
    const contacts = pane.querySelector<HTMLElement>(".contacts");
    const window = contacts?.closest<HTMLElement>(".window");
    expect(window).toBeTruthy();
    return window;
  });
  invariant(contactsWindow, "Expected Contacts window.");

  const newContactButton = await within(contactsWindow).findByRole("button", {
    name: "New Contact",
  });
  invariant(
    newContactButton instanceof HTMLButtonElement,
    "Expected New Contact button.",
  );
  await waitFor(() => {
    expect(newContactButton.disabled).toBe(false);
  });
  await interact(() => {
    fireEvent.click(newContactButton);
  });

  await interact(() => {
    fireEvent.change(within(contactsWindow).getByLabelText("Nickname"), {
      target: { value: input.nickname },
    });
    fireEvent.change(within(contactsWindow).getByLabelText("First name"), {
      target: { value: input.firstName },
    });
    fireEvent.change(within(contactsWindow).getByLabelText("Last name"), {
      target: { value: input.lastName },
    });
  });

  const createButton = within(contactsWindow).getByRole("button", {
    name: "Create",
  });
  invariant(
    createButton instanceof HTMLButtonElement,
    "Expected Create button.",
  );
  await waitFor(() => {
    expect(createButton.disabled).toBe(false);
  });
  await interact(() => {
    fireEvent.click(createButton);
  });
  await waitFor(() => {
    expect(
      within(contactsWindow).getAllByText(input.nickname).length,
    ).toBeGreaterThan(0);
  });
}

export async function downloadPaneRecoveryKey(
  pane: HTMLElement,
): Promise<string> {
  const downloaded = { blob: null as Blob | null };
  const originalCreateObjectUrl = URL.createObjectURL;
  const originalRevokeObjectUrl = URL.revokeObjectURL;
  const originalAnchorClick = HTMLAnchorElement.prototype.click;

  try {
    URL.createObjectURL = ((blob: Blob) => {
      downloaded.blob = blob;
      return "blob:tearleads-recovery-key-test";
    }) as typeof URL.createObjectURL;
    URL.revokeObjectURL = (() => undefined) as typeof URL.revokeObjectURL;
    HTMLAnchorElement.prototype.click = () => undefined;

    const identityManager = await openIdentityManagerForPane(pane);
    fireEvent.click(
      within(identityManager).getByRole("button", { name: "Recovery Key" }),
    );
    await interact(() => {
      fireEvent.click(
        within(identityManager).getByRole("button", {
          name: "Download Recovery Key",
        }),
      );
    });

    // Exporting the recovery key is gated behind a typed acknowledgement.
    const acknowledgement = await within(identityManager).findByLabelText(
      new RegExp(
        `Type ${RECOVERY_KEY_ACKNOWLEDGEMENT_PHRASE} to continue`,
        "u",
      ),
    );
    await interact(() => {
      fireEvent.change(acknowledgement, {
        target: { value: RECOVERY_KEY_ACKNOWLEDGEMENT_PHRASE },
      });
    });
    await interact(() => {
      fireEvent.click(
        within(identityManager).getByRole("button", { name: "Download File" }),
      );
    });

    const blob = downloaded.blob;
    if (!blob) {
      throw new Error("Expected recovery key backup blob.");
    }
    return (await blob.text()).trim();
  } finally {
    URL.createObjectURL = originalCreateObjectUrl;
    URL.revokeObjectURL = originalRevokeObjectUrl;
    HTMLAnchorElement.prototype.click = originalAnchorClick;
  }
}

export async function restorePaneRecoveryKey(
  pane: HTMLElement,
  recoveryKey: string,
) {
  const identityManager = await openIdentityManagerForPane(pane);
  await restorePaneRecoveryKeyAction({
    identityManager,
    pane,
    seedPhrase: recoveryKey,
    timeoutMs: DUAL_PANE_TEST_TIMEOUT_MS,
  });
}

interface PaneExplorerDocumentIdentity {
  containerId: string;
  documentId: string | null;
  localId: string;
}

function getInfoRowTitle(pane: HTMLElement, label: string): string | null {
  const rowHeader = within(pane).getByRole("rowheader", { name: label });
  return (
    rowHeader.closest("tr")?.querySelector("td")?.getAttribute("title") ?? null
  );
}

function queryMenuGetInfoButton(): HTMLElement | null {
  const buttons = within(document.body)
    .queryAllByRole("button", { name: "Get Info" })
    .filter((button) => button.closest(".menu") !== null);
  expect(buttons.length).toBeLessThanOrEqual(1);
  return buttons[0] ?? null;
}

async function navigateToPaneExplorerDocumentInfo(
  pane: HTMLElement,
  itemLabel: string,
  containerName?: string,
): Promise<void> {
  // Recovery can replace the folder between the row lookup and the right
  // click, leaving the context menu on a detached row that never opens. Each
  // poll reacquires the row and reopens the menu until Get Info appears. A
  // menu is reused only once this helper opened one; another pane's stays.
  let requested = false;
  const getInfoButton = await waitFor(
    async () => {
      const open = requested ? queryMenuGetInfoButton() : null;
      if (open) return open;
      const itemRow = await waitForExplorerDocumentRow(
        pane,
        itemLabel,
        containerName,
      );
      await interact(() => {
        fireEvent.contextMenu(itemRow);
      });
      requested = true;
      const opened = queryMenuGetInfoButton();
      if (!opened) {
        throw new Error("Expected the Explorer Get Info action.");
      }
      return opened;
    },
    // Longer than the row lookup's own 10s, so its error surfaces first.
    { timeout: 20_000 },
  );
  await interact(() => {
    fireEvent.click(getInfoButton);
  });
}

async function openPaneExplorerDocumentInfo(
  pane: HTMLElement,
  itemLabel: string,
  containerName?: string,
): Promise<PaneExplorerDocumentIdentity> {
  await navigateToPaneExplorerDocumentInfo(pane, itemLabel, containerName);

  return waitFor(
    async () => {
      // Recovery may replace the provisional folder after Get Info opens,
      // invalidating that route. Reacquire the named folder only if the panel
      // disappeared; an intact panel may still be loading its identity rows.
      if (!pane.querySelector(".explorer-detail--document-info")) {
        await navigateToPaneExplorerDocumentInfo(
          pane,
          itemLabel,
          containerName,
        );
      }
      const documentId = getInfoRowTitle(pane, "Document ID");
      const localId = getInfoRowTitle(pane, "Local ID");
      const containerId = getInfoRowTitle(pane, "Container");
      expect(localId?.length).toBeGreaterThan(0);
      expect(containerId).toMatch(/^[0-9a-f-]{36}$/u);
      const typeRow = within(pane).getByRole("rowheader", { name: "Type" });
      expect(typeRow.closest("tr")?.querySelector("td")?.textContent).toBe(
        "contact",
      );
      if (documentId !== null) {
        expect(documentId).toMatch(/^[0-9a-f-]{36}$/u);
      }
      return {
        containerId: containerId ?? "",
        documentId,
        localId: localId ?? "",
      };
    },
    { timeout: 10_000 },
  );
}

export async function readPaneExplorerDocumentIdentity(
  pane: HTMLElement,
  itemLabel: string,
  options: {
    /**
     * Re-open the Info panel until it shows this remote document id. The panel
     * is a point-in-time read: without polling, the first render races a peer
     * whose discovery adoption stamps the id onto the row moments later, and
     * the already-open panel never refreshes to show it. Requires
     * `containerName`: re-opening Get Info on the same route preserves the
     * mounted panel (context-menu Get Info does not select the document, so
     * the loader identity never changes) — each retry must first navigate back
     * to the container so the next open remounts the panel and reloads.
     */
    expectedDocumentId?: string | undefined;
    containerName?: string | undefined;
  } = {},
): Promise<PaneExplorerDocumentIdentity> {
  const { containerName } = options;
  if (options.expectedDocumentId === undefined) {
    return openPaneExplorerDocumentInfo(pane, itemLabel, containerName);
  }
  invariant(
    containerName,
    "expectedDocumentId polling requires containerName to remount the Info panel between reads.",
  );

  const deadline = Date.now() + 20_000;
  while (true) {
    const identity = await openPaneExplorerDocumentInfo(
      pane,
      itemLabel,
      containerName,
    );
    if (
      identity.documentId === options.expectedDocumentId ||
      Date.now() > deadline
    ) {
      // On timeout, return the mismatch so the caller's assertion reports it.
      return identity;
    }
    await new Promise((resolve) => setTimeout(resolve, 250));
    // The row lookup reopens the named container from the info route on the
    // next iteration, remounting the panel so Get Info reads fresh state.
  }
}
