import { afterEach, expect, test } from "bun:test";
import { fireEvent, waitFor, within } from "@testing-library/react";
import invariant from "invariant";
import { settleAppTestRuntimeInAct } from "../../../../test/helpers/appRuntimeIdle";
import {
  DUAL_PANE_ATTACHMENT_TEST_TIMEOUT_MS,
  DUAL_PANE_TEST_TIMEOUT_MS,
  formatExplorerWindowDebug,
  generatePaneKeyPairFromMenu,
  getExplorerSidebarItemsByName,
  getExplorerWindowRoot,
  getPaneRoot,
  getPaneUserId,
  interact,
  renderDualPane,
  selectContainerAndWaitForItemTable,
  waitForSinglePaneProvisioning,
} from "../../../../test/helpers/dual-pane/dualPaneCore";
import { openExplorer } from "../../../../test/helpers/dual-pane/dualPaneExplorerKit";
import {
  downloadPaneRecoveryKey,
  readPaneExplorerDocumentIdentity,
  restorePaneRecoveryKey,
} from "../../../../test/helpers/dual-pane/dualPaneRecoveryKit";
import {
  getProxiedApiNetworkActivitySnapshot,
  listProxiedApiRequests,
  MOCK_SERVER_RESET_TIMEOUT_MS,
  useTestApiAppHandlers,
} from "../../../../test/helpers/msw/server";
import { cleanupPaneTestEnvironment } from "../../../../test/helpers/paneTestUtils";
import { waitForCondition } from "../../../../test/helpers/waitForCondition";
import { waitForPersonalBootstrap } from "../../../../test/helpers/waitForPersonalBootstrap";

const WAIT_OPTIONS = { timeout: DUAL_PANE_TEST_TIMEOUT_MS };
const HOME = { "Street address": "12 King Street", "Postal code": "00123" };
const WORK = { "Street address": "99 Queen Street" };
const CABIN = { "Street address": "7 Lake Road" };
type AddressCards = Readonly<Record<string, Readonly<Record<string, string>>>>;

afterEach(cleanupPaneTestEnvironment, MOCK_SERVER_RESET_TIMEOUT_MS);

async function settleRuntime() {
  expect(
    await settleAppTestRuntimeInAct({ timeoutMs: DUAL_PANE_TEST_TIMEOUT_MS }),
  ).toBe(true);
}

async function clickButton(scope: HTMLElement, name: string) {
  await waitFor(() => {
    const button = within(scope).getByRole("button", { name });
    invariant(button instanceof HTMLButtonElement, "Expected a button.");
    expect(button.disabled).toBe(false);
  }, WAIT_OPTIONS);
  await interact(() =>
    fireEvent.click(within(scope).getByRole("button", { name })),
  );
}

async function selectOnlySelfContact(pane: HTMLElement, localId?: string) {
  const explorer = getExplorerWindowRoot(pane);
  await interact(() => fireEvent.pointerDown(explorer));
  await selectContainerAndWaitForItemTable(pane, "Contacts");
  await waitFor(() => {
    // Recovery can replace the provisional Contacts table; reacquire each time.
    const table = within(explorer).getByRole("table", {
      name: "Items in Contacts",
    });
    const self = within(table).getAllByRole("button", { name: "You" });
    expect(self).toHaveLength(1);
    expect(table.querySelectorAll("tr.explorer-item-table-row")).toHaveLength(
      1,
    );
    expect(getExplorerSidebarItemsByName(pane, "Contacts")).toHaveLength(1);
    if (localId !== undefined) {
      expect(self[0]?.getAttribute("data-document-local-id")).toBe(localId);
    }
  }, WAIT_OPTIONS);
  const table = within(explorer).getByRole("table", {
    name: "Items in Contacts",
  });
  await clickButton(table, "You");
  await within(explorer).findByRole(
    "region",
    { name: "Addresses" },
    WAIT_OPTIONS,
  );
}

function expectAddresses(pane: HTMLElement, expected: AddressCards) {
  const addresses = within(getExplorerWindowRoot(pane)).getByRole("region", {
    name: "Addresses",
  });
  expect(within(addresses).getAllByRole("group")).toHaveLength(
    Object.keys(expected).length,
  );
  for (const [label, values] of Object.entries(expected)) {
    const card = within(addresses).getByRole("group", { name: label });
    const fields = Object.fromEntries(
      Array.from(card.querySelectorAll("dl > div"), (field) => [
        field.querySelector("dt")?.textContent,
        field.querySelector("dd")?.textContent,
      ]),
    );
    expect(fields).toEqual(values);
  }
}

async function saveAddress(
  pane: HTMLElement,
  label: string,
  fields: Readonly<Record<string, string>>,
  existing = false,
) {
  const explorer = getExplorerWindowRoot(pane);
  if (existing) {
    await clickButton(
      within(explorer).getByRole("group", { name: label }),
      "Edit address",
    );
  } else {
    await clickButton(explorer, "Add address");
  }
  const editor = await within(explorer).findByRole(
    "form",
    { name: "Address editor" },
    WAIT_OPTIONS,
  );
  await interact(() => {
    for (const [name, value] of Object.entries(
      existing ? fields : { Label: label, ...fields },
    )) {
      fireEvent.change(within(editor).getByLabelText(name), {
        target: { value },
      });
    }
  });
  await clickButton(editor, "Save address");
  await waitFor(() => {
    expect(
      within(explorer).queryByRole("form", { name: "Address editor" }),
    ).toBeNull();
    const card = within(explorer).getByRole("group", { name: label });
    for (const value of Object.values(fields))
      expect(within(card).getByText(value)).toBeTruthy();
  }, WAIT_OPTIONS);
}

async function setNetworkMode(pane: HTMLElement, offline: boolean) {
  const status = within(pane).getByRole("region", { name: "System status" });
  await interact(() =>
    fireEvent.contextMenu(status, { clientX: 30, clientY: 30 }),
  );
  await clickButton(
    document.body,
    offline ? "Force Offline" : "Use Automatic Network",
  );
  await waitFor(() => {
    const row = within(status)
      .getByRole("rowheader", { name: "Network" })
      .closest("tr");
    expect(row?.querySelector("td")?.textContent?.trim()).toBe(
      offline ? "offline (manual)" : "online",
    );
  }, WAIT_OPTIONS);
}

test(
  "the recovered Me contact preserves addresses and converges offline edits on one remote document",
  async () => {
    useTestApiAppHandlers();
    const view = renderDualPane({ autoProvisionRight: false });
    const primary = getPaneRoot(view, "left");
    const recovered = getPaneRoot(view, "right");
    await waitForSinglePaneProvisioning(primary);
    await waitForPersonalBootstrap();
    await settleRuntime();
    const userId = getPaneUserId(primary);
    await openExplorer(primary);
    await selectOnlySelfContact(primary);
    const identity = await readPaneExplorerDocumentIdentity(primary, "You", {
      containerName: "Contacts",
    });
    invariant(
      identity.documentId,
      "Primary Me contact did not acquire a remote identity.",
    );

    await selectOnlySelfContact(primary, identity.localId);
    await clickButton(getExplorerWindowRoot(primary), "Edit");
    await saveAddress(primary, "Home", HOME);
    await clickButton(getExplorerWindowRoot(primary), "Done");
    await settleRuntime();
    expectAddresses(primary, { Home: HOME });

    // The second SQLite database is still pristine when the address is saved.
    // Initialize only its keychain, then recover the first pane's signing identity.
    const recoveryKey = await downloadPaneRecoveryKey(primary);
    await generatePaneKeyPairFromMenu(recovered);
    await restorePaneRecoveryKey(recovered, recoveryKey);
    await waitForCondition(
      () => getPaneUserId(recovered) === userId,
      "Second pane did not recover the same signing identity.",
      DUAL_PANE_TEST_TIMEOUT_MS,
    );
    await settleRuntime();
    await openExplorer(recovered);
    // A matching local ID can still belong to provisional bootstrap state.
    // Wait for verified remote adoption before opening the recovered content:
    // replacing its provisional Contacts container resets Explorer selection.
    expect(
      await readPaneExplorerDocumentIdentity(recovered, "You", {
        containerName: "Contacts",
        expectedDocumentId: identity.documentId,
      }),
    ).toEqual(identity);
    await selectOnlySelfContact(recovered, identity.localId);
    try {
      await waitFor(
        () => expectAddresses(recovered, { Home: HOME }),
        WAIT_OPTIONS,
      );
    } catch (error) {
      console.error(
        "[self-address-recovery]",
        JSON.stringify({
          identity,
          primary: formatExplorerWindowDebug(primary),
          recovered: formatExplorerWindowDebug(recovered),
          requests: listProxiedApiRequests()
            .filter((request) =>
              request.url.includes(`/documents/${identity.documentId}`),
            )
            .map(({ method, status, url }) => ({
              method,
              status,
              path: new URL(url).pathname,
            })),
        }),
      );
      throw error;
    }
    for (const pane of [primary, recovered]) {
      await selectOnlySelfContact(pane, identity.localId);
      await clickButton(getExplorerWindowRoot(pane), "Edit");
    }
    await settleRuntime();
    // Causal concurrency, not a timed race: neither replica can receive the
    // other's operations until both independent SQLite writes have completed.
    await setNetworkMode(primary, true);
    await setNetworkMode(recovered, true);
    await waitForCondition(
      () => getProxiedApiNetworkActivitySnapshot().activeRequestCount === 0,
      "Requests did not drain after both panes went offline.",
      DUAL_PANE_TEST_TIMEOUT_MS,
    );
    await saveAddress(primary, "Home", { "City / locality": "London" }, true);
    await saveAddress(recovered, "Home", { "Postal code": "00999" }, true);
    await saveAddress(primary, "Work", WORK);
    await saveAddress(recovered, "Cabin", CABIN);
    expectAddresses(primary, {
      Home: { ...HOME, "City / locality": "London" },
      Work: WORK,
    });
    expectAddresses(recovered, {
      Home: { ...HOME, "Postal code": "00999" },
      Cabin: CABIN,
    });

    await setNetworkMode(primary, false);
    await setNetworkMode(recovered, false);
    const converged = {
      Home: { ...HOME, "City / locality": "London", "Postal code": "00999" },
      Work: WORK,
      Cabin: CABIN,
    };
    await waitFor(() => {
      expectAddresses(primary, converged);
      expectAddresses(recovered, converged);
    }, WAIT_OPTIONS);
    await settleRuntime();
    for (const pane of [primary, recovered]) {
      expect(
        await readPaneExplorerDocumentIdentity(pane, "You", {
          containerName: "Contacts",
          expectedDocumentId: identity.documentId,
        }),
      ).toEqual(identity);
      // Reopen the document and check the entire collection, not just the ID
      // or a still-mounted editor's local values; reject extra self rows too.
      await selectOnlySelfContact(pane, identity.localId);
      await waitFor(() => expectAddresses(pane, converged), WAIT_OPTIONS);
    }
  },
  DUAL_PANE_ATTACHMENT_TEST_TIMEOUT_MS,
);
