import { afterEach, expect, test } from "bun:test";
import {
  act,
  cleanup,
  fireEvent,
  render,
  screen,
  waitFor,
  within,
} from "@testing-library/react";
import invariant from "invariant";
import { useEffect, useRef } from "react";
import {
  AppTestRuntimeScopeProbe,
  waitForAppTestRuntimeToSettle,
} from "../../../../test/helpers/appRuntimeIdle";
import {
  listProxiedApiRequests,
  resetMockServer,
  useTestApiAppHandlers,
} from "../../../../test/helpers/mswServer";
import {
  createTestHostConfig,
  flattenPaneStatusText,
} from "../../../../test/helpers/paneTestUtils";
import { waitForCondition } from "../../../../test/helpers/waitForCondition";
import { useRegisterCurrentIdentity } from "../../../identity/useRegisterCurrentIdentity";
import { ORG_MANAGER_LABELS } from "../../../mini-apps/org-manager/labels";
import {
  saveSystemMonitorMode,
  systemMonitorModeStorageKey,
} from "../../../mini-apps/system-monitor/systemMonitorMode";
import { useCryptoSession } from "../../../providers/crypto/CryptoSessionProvider";
import { useDatabase } from "../../../providers/db/DatabaseProvider";
import { useIdentity } from "../../../providers/identity/IdentityProvider";
import { DualPaneProvider, PaneSideProvider } from "../dual-pane";
import { PaneProvider } from "../runtime/PaneProvider";
import { Pane } from "../shell/Pane";

const ORG_MANAGER_USAGE_TEST_TIMEOUT_MS = 20_000;
const ORG_MANAGER_OPEN_TIMEOUT_MS = 3_000;
const BOOTSTRAP_SYNC_SETTLE_TIMEOUT_MS = 6_000;
const NETWORK_IDLE_QUIET_MS = 25;
const INITIAL_HYDRATION_DATA_USAGE_REQUEST_BUDGET = 6;
const MAX_REQUEST_SUMMARY_BODY_LENGTH = 500;
const PANE_USER_ID_PATTERN =
  /userId:\s*[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}/u;
const PANE_SESSION_PATTERN = /session:\s*(?!none\b)\S+/u;

afterEach(async () => {
  cleanup();
  globalThis.localStorage.clear();
  await resetMockServer();
});

async function interact(operation: () => void): Promise<void> {
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

function renderSinglePane() {
  const hostConfig = createTestHostConfig();
  saveSystemMonitorMode(systemMonitorModeStorageKey("left"), "pinned");

  return render(
    <DualPaneProvider>
      <PaneSideProvider side="left">
        <PaneProvider hostConfig={hostConfig}>
          <AppTestRuntimeScopeProbe />
          <PaneAutoProvisioner />
          <Pane className="pane pane-left" />
        </PaneProvider>
      </PaneSideProvider>
    </DualPaneProvider>,
  );
}

function getPaneRoot(view: ReturnType<typeof renderSinglePane>): HTMLElement {
  const pane = view.container.querySelector<HTMLElement>(".pane-left");
  invariant(pane, "Expected left pane root.");
  return pane;
}

async function waitForSinglePaneProvisioning(pane: HTMLElement) {
  await waitForCondition(() => {
    const status = flattenPaneStatusText(pane);
    return (
      PANE_USER_ID_PATTERN.test(status) && PANE_SESSION_PATTERN.test(status)
    );
  }, "Left pane identity did not finish provisioning.");
}

async function openOrgManager(pane: HTMLElement) {
  await interact(() => {
    fireEvent.contextMenu(pane, {
      clientX: 160,
      clientY: 160,
    });
  });
  const openOrgManagerButton = screen.getByRole("button", {
    name: "Org Manager",
  });
  await interact(() => {
    fireEvent.click(openOrgManagerButton);
  });

  await waitFor(
    () => {
      expect(within(pane).getByRole("button", { name: "Groups" })).toBeTruthy();
    },
    { timeout: ORG_MANAGER_OPEN_TIMEOUT_MS },
  );
}

async function openOrgManagerUsage(pane: HTMLElement) {
  await openOrgManager(pane);
  await interact(() => {
    fireEvent.click(
      within(pane).getByRole("button", { name: ORG_MANAGER_LABELS.usage }),
    );
  });

  await waitFor(() => {
    expect(
      within(pane).getByText(ORG_MANAGER_LABELS.organizationDataUsage),
    ).toBeTruthy();
  });
}

function getOrgManagerWindowRoot(pane: HTMLElement): HTMLElement {
  const orgManagerTitle = within(pane).getByText("Org Manager");
  const orgManagerWindow = orgManagerTitle.closest<HTMLElement>(".window");
  invariant(orgManagerWindow, "Expected Org Manager window.");
  return orgManagerWindow;
}

function openOrgManagerViewMenu(pane: HTMLElement): HTMLElement {
  const orgManagerWindow = getOrgManagerWindowRoot(pane);
  const viewMenuButton = within(orgManagerWindow).getByRole("menuitem", {
    name: "View",
  });

  if (viewMenuButton.getAttribute("aria-expanded") !== "true") {
    fireEvent.click(viewMenuButton);
  }

  return orgManagerWindow;
}

function clickAvailableOrgManagerRefresh(pane: HTMLElement): boolean {
  const orgManagerWindow = openOrgManagerViewMenu(pane);
  const refreshButton = within(orgManagerWindow).queryByRole("menuitem", {
    name: "Refresh",
  });

  if (refreshButton instanceof HTMLButtonElement && !refreshButton.disabled) {
    fireEvent.click(refreshButton);
    return true;
  }

  return false;
}

function requestPath(url: string): string {
  try {
    return new URL(url).pathname;
  } catch {
    return url;
  }
}

function countOrganizationDataUsageRequests(): number {
  return listProxiedApiRequests().filter(
    (request) =>
      request.method === "GET" &&
      requestPath(request.url).endsWith("/data-usage"),
  ).length;
}

function truncateText(
  text: string,
  maxLength = MAX_REQUEST_SUMMARY_BODY_LENGTH,
): string {
  return text.length <= maxLength
    ? text
    : `${text.slice(0, maxLength)}... <${text.length} chars>`;
}

function summarizeRequestBody(body: string | null): string {
  return body === null ? "null" : `<${body.length} chars>`;
}

function summarizeProxiedApiRequests(): string {
  return listProxiedApiRequests()
    .map(
      (request) =>
        `${request.method} ${request.status} ${requestPath(request.url)} request=${summarizeRequestBody(request.requestBody)} response=${truncateText(request.responseBody)}`,
    )
    .join("\n");
}

function listPaneErrorLines(pane: HTMLElement): string[] {
  const text = pane.textContent ?? "";
  return text
    .split(/(?=\[\d{1,2}:\d{2}:\d{2})/u)
    .filter((line) => line.includes("ERROR:"))
    .map((line) => truncateText(line));
}

test(
  "registered pane org manager usage baselines bootstrap documents and updates",
  async () => {
    useTestApiAppHandlers();
    const view = renderSinglePane();
    const pane = getPaneRoot(view);

    await waitForSinglePaneProvisioning(pane);
    await openOrgManagerUsage(pane);
    await act(async () => {
      await waitForAppTestRuntimeToSettle({
        apiQuietMs: NETWORK_IDLE_QUIET_MS,
        timeoutMs: BOOTSTRAP_SYNC_SETTLE_TIMEOUT_MS,
      });
    });
    // The clean-replica probe lists the five eligible bootstrap containers in
    // separate yielded coordinator turns. A visible Usage view may reconcile
    // after each pending-to-settled edge, plus its entry read.
    expect(countOrganizationDataUsageRequests()).toBeLessThanOrEqual(
      INITIAL_HYDRATION_DATA_USAGE_REQUEST_BUDGET,
    );

    // This is the org-manager-plus-system-bootstrap baseline. Usage counts
    // synced document update rows, not every document shell created by
    // registration. Eight documents / nine updates decompose as:
    //   1. root "/"                     (2 updates: one early bootstrap
    //                                     metadata update, then the root sync)
    //   2. "Roster Profiles" container metadata document          (1 update)
    //   3. current user's roster profile document (display names) (1 update)
    //   4. "Organization Metadata" container metadata document    (1 update)
    //   5. Contacts system container metadata document            (1 update)
    //   6. Trash system container metadata document               (1 update)
    //   7. self-contact document inside Contacts                  (1 update)
    //   8. organization profile document ("Personal Org")         (1 update)
    // Document 4 is the org-public metadata container minted at
    // registration and read-granted to the Members group so any active
    // roster member can decrypt org-wide public fields; its own metadata
    // document syncs during bootstrap. Trash metadata is committed in the
    // registration transaction. Documents 5 and 7 come from the post-auth
    // promotion pass: Contacts starts device-first LOCAL-ONLY, then promotion
    // also re-runs the self-contact bootstrap with the remote identity so both
    // become synced. The auth-aware billing bootstrap flushes the organization
    // profile linked into the org metadata container once the trial is loaded.
    await waitForCondition(
      () => {
        if (pane.textContent?.includes("8 documents, 9 updates")) {
          return true;
        }

        clickAvailableOrgManagerRefresh(pane);
        return false;
      },
      `Org Manager usage did not report the bootstrap document baseline.\nrequests=\n${summarizeProxiedApiRequests()}\npane=${truncateText(pane.textContent ?? "")}`,
      10_000,
    );
    expect(listPaneErrorLines(pane)).toEqual([]);
  },
  ORG_MANAGER_USAGE_TEST_TIMEOUT_MS,
);
