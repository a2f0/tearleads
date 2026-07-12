import { expect } from "bun:test";
import { fireEvent, waitFor, within } from "@testing-library/react";
import { flattenPaneStatusText } from "../paneTestUtils";
import {
  interact,
  openIdentityManagerForPane,
  waitForSinglePaneProvisioning,
} from "./dualPaneCore";

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
    await interact(() => {
      fireEvent.click(
        within(identityManager).getByRole("button", {
          name: "Download Recovery Key",
        }),
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
  await interact(() => {
    fireEvent.change(
      within(identityManager).getByLabelText("Restore passphrase"),
      { target: { value: recoveryKey } },
    );
    fireEvent.click(
      within(identityManager).getByRole("button", {
        name: "Restore from Passphrase",
      }),
    );
  });

  await waitForSinglePaneProvisioning(pane);
  await waitFor(() => {
    expect(flattenPaneStatusText(pane)).toMatch(
      /(?:sqlite worker|SQLite Worker):\s*ready/,
    );
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

export async function readPaneExplorerDocumentIdentity(
  pane: HTMLElement,
  itemLabel: string,
): Promise<PaneExplorerDocumentIdentity> {
  const itemTable = within(pane).getByRole("table", {
    name: /^Items in /u,
  });
  const itemButton = within(itemTable).getByRole("button", {
    name: itemLabel,
  });
  const itemRow = itemButton.closest("tr");
  if (!itemRow) {
    throw new Error(`Expected an Explorer row for ${itemLabel}.`);
  }
  await interact(() => {
    fireEvent.contextMenu(itemRow);
  });

  const getInfoButton = await waitFor(() => {
    const buttons = within(document.body)
      .getAllByRole("button", { name: "Get Info" })
      .filter((button) => button.closest(".menu") !== null);
    expect(buttons).toHaveLength(1);
    const button = buttons[0];
    if (!button) {
      throw new Error("Expected the Explorer Get Info action.");
    }
    return button;
  });
  await interact(() => {
    fireEvent.click(getInfoButton);
  });

  return waitFor(
    () => {
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
