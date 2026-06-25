import { expect } from "bun:test";
import {
  fireEvent,
  render,
  screen,
  waitFor,
  within,
} from "@testing-library/react";
import invariant from "invariant";
import { act, useEffect, useRef } from "react";
import {
  DualPaneProvider,
  PaneSideProvider,
} from "../../../src/components/pane/DualPaneProvider";
import { Pane } from "../../../src/components/pane/Pane";
import { PaneProvider } from "../../../src/components/pane/PaneProvider";
import { useRegisterCurrentIdentity } from "../../../src/identity/useRegisterCurrentIdentity";
import { useCryptoSession } from "../../../src/providers/crypto/CryptoSessionProvider";
import { useDatabase } from "../../../src/providers/db/DatabaseProvider";
import { useIdentity } from "../../../src/providers/identity/IdentityProvider";
import { AppTestRuntimeScopeProbe } from "../appRuntimeIdle";
import { truncateText } from "../dualPaneRequestSummary";
import { createTestHostConfig } from "../paneTestUtils";
import { waitForCondition } from "../waitForCondition";

export const DUAL_PANE_TEST_TIMEOUT_MS = 20_000;
export const DUAL_PANE_ATTACHMENT_TEST_TIMEOUT_MS = 60_000;
export const POST_SHARE_SYNC_SETTLE_TIMEOUT_MS = 6_000;
export const POST_SHARE_NETWORK_IDLE_QUIET_MS = 25;
export const SHARED_NOTE_TITLE = "Peer one note with attachment";

export async function interact(operation: () => void): Promise<void> {
  await act(async () => {
    operation();
  });
}

function PaneAutoProvisioner() {
  const { status } = useDatabase();
  const { containerId, userId } = useCryptoSession();
  const { generateKey, signingKeyPair } = useIdentity();
  const { canRegisterCurrentIdentity, registerCurrentIdentity } =
    useRegisterCurrentIdentity();
  const registrationInFlight = useRef(false);

  useEffect(() => {
    if (signingKeyPair === null) {
      generateKey();
    }
  }, [generateKey, signingKeyPair]);

  useEffect(() => {
    if (
      status !== "ready" ||
      containerId === null ||
      userId !== null ||
      !canRegisterCurrentIdentity ||
      registrationInFlight.current
    ) {
      return;
    }

    registrationInFlight.current = true;
    void registerCurrentIdentity().finally(() => {
      registrationInFlight.current = false;
    });
  }, [
    canRegisterCurrentIdentity,
    containerId,
    registerCurrentIdentity,
    status,
    userId,
  ]);

  return null;
}

export function renderDualPane(): ReturnType<typeof render> {
  const hostConfig = createTestHostConfig();

  return render(
    <DualPaneProvider>
      <PaneSideProvider side="left">
        <PaneProvider hostConfig={hostConfig}>
          <AppTestRuntimeScopeProbe />
          <PaneAutoProvisioner />
          <Pane className="pane pane-left" />
        </PaneProvider>
      </PaneSideProvider>
      <PaneSideProvider side="right">
        <PaneProvider hostConfig={hostConfig}>
          <AppTestRuntimeScopeProbe />
          <PaneAutoProvisioner />
          <Pane className="pane pane-right" />
        </PaneProvider>
      </PaneSideProvider>
    </DualPaneProvider>,
  );
}

export function renderSinglePane({
  autoProvision = true,
}: {
  autoProvision?: boolean;
} = {}): ReturnType<typeof render> {
  const hostConfig = createTestHostConfig();

  return render(
    <DualPaneProvider>
      <PaneSideProvider side="left">
        <PaneProvider hostConfig={hostConfig}>
          <AppTestRuntimeScopeProbe />
          {autoProvision && <PaneAutoProvisioner />}
          <Pane className="pane pane-left" />
        </PaneProvider>
      </PaneSideProvider>
    </DualPaneProvider>,
  );
}

export function getPaneRoot(
  view: ReturnType<typeof renderDualPane>,
  side: "left" | "right",
): HTMLElement {
  const pane = view.container.querySelector<HTMLElement>(`.pane-${side}`);
  invariant(pane, `Expected ${side} pane root.`);
  return pane;
}

export function queryExplorerItemTable(root: HTMLElement): HTMLElement | null {
  return within(root).queryByRole("table", { name: /^Items in /u });
}

export function getPaneUserId(pane: HTMLElement): string {
  const match = pane.textContent?.match(
    /userId:\s*([0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12})/u,
  );
  invariant(match?.[1] && match[1] !== "none", "Expected pane user id.");
  return match[1];
}

export function getExplorerSidebarItem(
  pane: HTMLElement,
  name: string,
): HTMLButtonElement {
  const item = getExplorerSidebarItemsByName(pane, name)[0];

  invariant(item, `Expected explorer sidebar item "${name}".`);
  return item;
}

export function getExplorerSidebarItemsByName(
  pane: HTMLElement,
  name: string,
): HTMLButtonElement[] {
  return Array.from(
    pane.querySelectorAll<HTMLButtonElement>("button.explorer-sidebar-item"),
  ).filter((button) => button.textContent?.trim() === name);
}

export function listExplorerContainerItems(
  pane: HTMLElement,
): HTMLButtonElement[] {
  return Array.from(
    pane.querySelectorAll<HTMLButtonElement>("button.explorer-sidebar-item"),
  ).filter(
    (button) => !button.classList.contains("explorer-sidebar-item--note"),
  );
}

export function getExplorerWindowRoot(pane: HTMLElement): HTMLElement {
  const explorerTitle = within(pane).getByText("Explorer");
  const explorerWindow = explorerTitle.closest<HTMLElement>(".window");
  invariant(explorerWindow, "Expected Explorer window.");
  return explorerWindow;
}

export function openExplorerViewMenu(pane: HTMLElement): HTMLElement {
  const explorerWindow = getExplorerWindowRoot(pane);
  const viewMenuButton = within(explorerWindow).getByRole("menuitem", {
    name: "View",
  });

  if (viewMenuButton.getAttribute("aria-expanded") !== "true") {
    fireEvent.click(viewMenuButton);
  }

  return explorerWindow;
}

export function formatExplorerWindowDebug(pane: HTMLElement): string {
  const explorerWindow = getExplorerWindowRoot(pane);
  const rowSummaries = Array.from(
    explorerWindow.querySelectorAll<HTMLTableRowElement>("tr"),
  ).map((row) => {
    const cells = Array.from(row.querySelectorAll("th, td")).map((cell) => {
      const title = cell.getAttribute("title");
      const text = cell.textContent?.replace(/\s+/gu, " ").trim() ?? "";
      return title ? `${text} [title=${title}]` : text;
    });
    return cells.join(" | ");
  });

  return [
    `explorer=${truncateText(
      explorerWindow.textContent?.replace(/\s+/gu, " ").trim() ?? "",
      2_000,
    )}`,
    `rows=${rowSummaries.length > 0 ? rowSummaries.join("\n") : "(none)"}`,
  ].join("\n");
}

export async function selectContainerAndWaitForItemTable(
  pane: HTMLElement,
  name: string,
): Promise<HTMLElement> {
  await interact(() => {
    fireEvent.click(getExplorerSidebarItem(pane, name));
  });

  let table: HTMLElement | null = null;
  await waitFor(() => {
    table = within(pane).getByRole("table", {
      name: `Items in ${name}`,
    });
    expect(table).toBeTruthy();
  });

  invariant(table, `Expected explorer item table for "${name}".`);
  return table;
}

export async function waitForSinglePaneProvisioning(pane: HTMLElement) {
  await waitForCondition(
    () =>
      !pane.textContent?.includes("userId: none") &&
      !pane.textContent?.includes("session: none"),
    "Left pane identity did not finish provisioning.",
    DUAL_PANE_TEST_TIMEOUT_MS,
  );
}

export async function waitForDualPaneProvisioning(
  leftPane: HTMLElement,
  rightPane: HTMLElement,
) {
  await waitForCondition(
    () =>
      !leftPane.textContent?.includes("userId: none") &&
      !leftPane.textContent?.includes("session: none") &&
      !rightPane.textContent?.includes("userId: none") &&
      !rightPane.textContent?.includes("session: none") &&
      !leftPane.textContent?.includes("peerUserId: none") &&
      !rightPane.textContent?.includes("peerUserId: none"),
    "Dual pane identities did not finish provisioning.",
    DUAL_PANE_TEST_TIMEOUT_MS,
  );
}

export async function provisionPaneFromMenu(pane: HTMLElement) {
  await interact(() => {
    fireEvent.click(within(pane).getByText("Menu"));
  });
  const generateButton = screen.getByRole("button", {
    name: "Generate Key Pair",
  });
  await interact(() => {
    fireEvent.click(generateButton);
  });

  await waitFor(() => {
    expect(within(pane).getByText(/sqlite worker: ready/)).toBeTruthy();
  });

  await interact(() => {
    fireEvent.click(within(pane).getByText("Menu"));
  });
  const registerButton = screen.getByRole("button", {
    name: "Register",
  });
  await interact(() => {
    fireEvent.click(registerButton);
  });

  await waitForSinglePaneProvisioning(pane);
}

export async function downloadPaneKeyPackageBackup(
  pane: HTMLElement,
): Promise<string> {
  const downloaded = { blob: null as Blob | null };
  const originalCreateObjectUrl = URL.createObjectURL;
  const originalRevokeObjectUrl = URL.revokeObjectURL;
  const originalAnchorClick = HTMLAnchorElement.prototype.click;

  try {
    URL.createObjectURL = ((blob: Blob) => {
      downloaded.blob = blob;
      return "blob:tearleads-key-package-test";
    }) as typeof URL.createObjectURL;
    URL.revokeObjectURL = (() => undefined) as typeof URL.revokeObjectURL;
    HTMLAnchorElement.prototype.click = () => undefined;

    await interact(() => {
      fireEvent.click(within(pane).getByText("Menu"));
    });
    const backupButton = screen.getByRole("button", {
      name: "Backup Key Package",
    });
    await interact(() => {
      fireEvent.click(backupButton);
    });

    const blob = downloaded.blob;
    if (!blob) {
      throw new Error("Expected key package backup blob.");
    }
    return blob.text();
  } finally {
    URL.createObjectURL = originalCreateObjectUrl;
    URL.revokeObjectURL = originalRevokeObjectUrl;
    HTMLAnchorElement.prototype.click = originalAnchorClick;
  }
}

export async function destroyPaneKeyPackage(pane: HTMLElement) {
  await interact(() => {
    fireEvent.click(within(pane).getByText("Menu"));
  });
  const destroyButton = screen.getByRole("button", {
    name: "Destroy Key Pair",
  });
  await interact(() => {
    fireEvent.click(destroyButton);
  });

  await waitForCondition(
    () =>
      (pane.textContent?.includes("userId: none") ?? false) &&
      (pane.textContent?.includes("sqlite worker: idle") ?? false),
    "Pane did not clear local identity state after key destruction.",
  );
}

export async function restorePaneKeyPackageBackup(
  pane: HTMLElement,
  backupJson: string,
) {
  await interact(() => {
    fireEvent.click(within(pane).getByText("Menu"));
  });
  const fileInput = screen.getByLabelText("Restore Key Package File");
  const restoreButton = screen.getByRole("button", {
    name: "Restore Key Package",
  });
  await interact(() => {
    fireEvent.click(restoreButton);
  });

  const backupFile = new File([backupJson], "tearleads-key-package.json", {
    type: "application/json",
  });
  await interact(() => {
    fireEvent.change(fileInput, {
      target: { files: [backupFile] },
    });
  });

  await waitForSinglePaneProvisioning(pane);
  await waitFor(() => {
    expect(within(pane).getByText(/sqlite worker: ready/)).toBeTruthy();
  });
}
