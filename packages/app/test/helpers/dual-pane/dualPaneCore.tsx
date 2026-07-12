import { expect } from "bun:test";
import {
  act,
  fireEvent,
  render,
  screen,
  waitFor,
  within,
} from "@testing-library/react";
import invariant from "invariant";
import { useEffect, useRef } from "react";
import {
  DualPaneProvider,
  PaneSideProvider,
} from "../../../src/components/pane/dual-pane";
import { Pane } from "../../../src/components/pane/Pane";
import { PaneProvider } from "../../../src/components/pane/PaneProvider";
import { DESTROY_KEY_PACKAGE_CONFIRMATION_PHRASE } from "../../../src/components/shared/DestroyKeyPackageConfirmationDialog";
import { APP_HOST_PROFILES } from "../../../src/host/AppHostConfig";
import { useRegisterCurrentIdentity } from "../../../src/identity/useRegisterCurrentIdentity";
import {
  saveSystemMonitorDeveloperMode,
  saveSystemMonitorMode,
  systemMonitorDeveloperModeStorageKey,
  systemMonitorModeStorageKey,
} from "../../../src/mini-apps/system-monitor/systemMonitorMode";
import { useCryptoSession } from "../../../src/providers/crypto/CryptoSessionProvider";
import { useDatabase } from "../../../src/providers/db/DatabaseProvider";
import { useIdentity } from "../../../src/providers/identity/IdentityProvider";
import { AppTestRuntimeScopeProbe } from "../appRuntimeIdle";
import { truncateText } from "../dualPaneRequestSummary";
import { createTestHostConfig, flattenPaneStatusText } from "../paneTestUtils";
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

function clickOpenPaneMenuItem(name: string) {
  const menu = document.body.querySelector<HTMLElement>(".menu");
  invariant(menu, "pane menu not found");
  fireEvent.click(within(menu).getByRole("button", { name }));
}

export async function openIdentityManagerForPane(
  pane: HTMLElement,
): Promise<HTMLElement> {
  const existing = pane.querySelector<HTMLElement>(".identity-manager");
  if (existing) {
    return existing;
  }

  await interact(() => {
    fireEvent.click(within(pane).getByText("Menu"));
  });
  await interact(() => {
    clickOpenPaneMenuItem("Identity Manager");
  });
  const identityManager = await waitFor(() => {
    const app = pane.querySelector<HTMLElement>(".identity-manager");
    expect(app).toBeTruthy();
    return app;
  });
  invariant(identityManager, "identity manager not found");
  return identityManager;
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

// The dual-pane suite exercises the demo profile for its isolated per-pane
// runtimes and peer-user-id plumbing, not the friendly peer seeding. Turn that
// seeding off so its background contact imports/writes don't inject unrelated
// system-container sync churn into the sharing/projection assertions here; the
// seeding logic is covered directly by src/demo/demoPeerSeed.test.ts.
const DUAL_PANE_TEST_PROFILE = {
  ...APP_HOST_PROFILES.demo,
  features: {
    ...APP_HOST_PROFILES.demo.features,
    seedPeerIdentities: false,
  },
};

export function renderDualPane({
  autoProvisionLeft = true,
  autoProvisionRight = true,
}: {
  autoProvisionLeft?: boolean;
  autoProvisionRight?: boolean;
} = {}): ReturnType<typeof render> {
  const hostConfig = createTestHostConfig({ profile: DUAL_PANE_TEST_PROFILE });
  saveSystemMonitorMode(systemMonitorModeStorageKey("left"), "pinned");
  saveSystemMonitorMode(systemMonitorModeStorageKey("right"), "pinned");

  return render(
    <DualPaneProvider>
      <PaneSideProvider side="left">
        <PaneProvider hostConfig={hostConfig}>
          <AppTestRuntimeScopeProbe />
          {autoProvisionLeft && <PaneAutoProvisioner />}
          <Pane className="pane pane-left" />
        </PaneProvider>
      </PaneSideProvider>
      <PaneSideProvider side="right">
        <PaneProvider hostConfig={hostConfig}>
          <AppTestRuntimeScopeProbe />
          {autoProvisionRight && <PaneAutoProvisioner />}
          <Pane className="pane pane-right" />
        </PaneProvider>
      </PaneSideProvider>
    </DualPaneProvider>,
  );
}

export function renderSinglePane({
  autoProvision = true,
  developerMode = false,
}: {
  autoProvision?: boolean;
  developerMode?: boolean;
} = {}): ReturnType<typeof render> {
  const hostConfig = createTestHostConfig();
  saveSystemMonitorMode(systemMonitorModeStorageKey("left"), "pinned");
  saveSystemMonitorDeveloperMode(
    systemMonitorDeveloperModeStorageKey(),
    developerMode ? "enabled" : "disabled",
  );

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

const PANE_USER_ID_PATTERN =
  /(?:userId|User ID):\s*([0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12})/u;
const PANE_SESSION_PATTERN = /(?:session|Session):\s*(?!none\b)\S+/u;
const PANE_PEER_USER_ID_PATTERN =
  /(?:peerUserId|Peer User ID):\s*([0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12})/u;

export function getPaneUserId(pane: HTMLElement): string {
  const match = flattenPaneStatusText(pane).match(PANE_USER_ID_PATTERN);
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
    () => {
      const status = flattenPaneStatusText(pane);
      return (
        PANE_USER_ID_PATTERN.test(status) && PANE_SESSION_PATTERN.test(status)
      );
    },
    "Left pane identity did not finish provisioning.",
    DUAL_PANE_TEST_TIMEOUT_MS,
  );
}

export async function waitForDualPaneProvisioning(
  leftPane: HTMLElement,
  rightPane: HTMLElement,
) {
  await waitForCondition(
    () => {
      const leftText = flattenPaneStatusText(leftPane);
      const rightText = flattenPaneStatusText(rightPane);
      return (
        PANE_USER_ID_PATTERN.test(leftText) &&
        PANE_SESSION_PATTERN.test(leftText) &&
        PANE_PEER_USER_ID_PATTERN.test(leftText) &&
        PANE_USER_ID_PATTERN.test(rightText) &&
        PANE_SESSION_PATTERN.test(rightText) &&
        PANE_PEER_USER_ID_PATTERN.test(rightText)
      );
    },
    "Dual pane identities did not finish provisioning.",
    DUAL_PANE_TEST_TIMEOUT_MS,
  );
}

export async function generatePaneKeyPairFromMenu(pane: HTMLElement) {
  await interact(() => {
    fireEvent.click(within(pane).getByText("Menu"));
  });
  await interact(() => {
    clickOpenPaneMenuItem("Generate Key Pair");
  });

  await waitFor(() => {
    expect(flattenPaneStatusText(pane)).toMatch(
      /(?:sqlite worker|SQLite Worker):\s*ready/,
    );
  });
}

export async function provisionPaneFromMenu(pane: HTMLElement) {
  await generatePaneKeyPairFromMenu(pane);

  const identityManager = await openIdentityManagerForPane(pane);
  await interact(() => {
    fireEvent.click(
      within(identityManager).getByRole("button", { name: "Register" }),
    );
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

    const identityManager = await openIdentityManagerForPane(pane);
    const backupButton = within(identityManager).getByRole("button", {
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
  const identityManager = await openIdentityManagerForPane(pane);
  const destroyButton = within(identityManager).getByRole("button", {
    name: "Destroy Key Pair",
  });
  await interact(() => {
    fireEvent.click(destroyButton);
  });
  const confirmationInput = screen.getByLabelText(
    /Type confirm delete to continue/u,
  );
  await interact(() => {
    fireEvent.change(confirmationInput, {
      target: { value: DESTROY_KEY_PACKAGE_CONFIRMATION_PHRASE },
    });
  });
  await interact(() => {
    fireEvent.click(
      screen.getByRole("button", { name: "Destroy Key Package" }),
    );
  });

  await waitForCondition(() => {
    const status = flattenPaneStatusText(pane);
    return (
      (status.includes("userId: none") || status.includes("User ID: none")) &&
      (status.includes("sqlite worker: idle") ||
        status.includes("SQLite Worker: idle"))
    );
  }, "Pane did not clear local identity state after key destruction.");
}

export async function restorePaneKeyPackageBackup(
  pane: HTMLElement,
  backupJson: string,
) {
  const identityManager = await openIdentityManagerForPane(pane);
  const fileInput = within(identityManager).getByLabelText(
    "Identity Manager Restore Key Package File",
  );
  const restoreButton = within(identityManager).getByRole("button", {
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
    expect(flattenPaneStatusText(pane)).toMatch(
      /(?:sqlite worker|SQLite Worker):\s*ready/,
    );
  });
}
