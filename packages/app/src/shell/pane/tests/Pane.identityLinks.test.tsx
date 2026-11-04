import { afterEach, beforeEach, expect, test } from "bun:test";
import {
  cleanup,
  fireEvent,
  screen,
  waitFor,
  within,
} from "@testing-library/react";
import {
  getPaneRoot,
  getPaneUserId,
  interact,
  openWindowMenuDialog,
  renderDualPane,
  waitForDualPaneProvisioning,
} from "../../../../test/helpers/dual-pane/dualPaneCore";
import {
  importMiniAppContact,
  openMiniApp,
} from "../../../../test/helpers/dual-pane/dualPaneMiniAppKit";
import {
  fillRosterImportNames,
  importPeerIntoRoster,
} from "../../../../test/helpers/dual-pane/dualPaneRosterKit";
import { openOrgManager } from "../../../../test/helpers/dual-pane/dualPaneSharingKit";
import { createPeerIdentityLink } from "../../../../test/helpers/identityLinkFixtures";
import { mockClipboardWrites } from "../../../../test/helpers/identityLinkResolverTestKit";
import {
  listProxiedApiRequests,
  MOCK_SERVER_RESET_TIMEOUT_MS,
  resetMockServer,
  useTestApiAppHandlers,
} from "../../../../test/helpers/mswServer";
import { waitForPersonalBootstrap } from "../../../../test/helpers/waitForPersonalBootstrap";

const browser = window as typeof window & {
  happyDOM: { setURL: (url: string) => void };
};
let previousUrl = window.location.href;
beforeEach(() => {
  previousUrl = window.location.href;
});

afterEach(async () => {
  cleanup();
  globalThis.localStorage.clear();
  browser.happyDOM.setURL(previousUrl);
  window.history.replaceState(null, "", previousUrl);
  await resetMockServer();
}, MOCK_SERVER_RESET_TIMEOUT_MS);

function mismatchedLink(link: string): string {
  const url = new URL(link);
  const token = url.pathname.split("/").at(-1) ?? "";
  const record: unknown[] = JSON.parse(
    Buffer.from(token, "base64url").toString(),
  );
  record[3] = "f".repeat(64);
  url.pathname = `/app/contacts/import/${Buffer.from(JSON.stringify(record)).toString("base64url")}`;
  return url.href;
}

test("local identity links onboard contacts and roster users; a mismatch never grants membership", async () => {
  browser.happyDOM.setURL("http://localhost/");
  useTestApiAppHandlers();
  const view = renderDualPane();
  const alice = getPaneRoot(view, "left");
  const bob = getPaneRoot(view, "right");
  await waitForDualPaneProvisioning(alice, bob);
  await waitForPersonalBootstrap(2);
  const bobId = getPaneUserId(bob);
  const bobLink = await createPeerIdentityLink(bobId);

  const bobContacts = await openMiniApp(bob, "Contacts");
  const copyLink = await within(bobContacts).findByRole("button", {
    name: "Copy my identity link",
  });
  await waitFor(() => expect(copyLink.hasAttribute("disabled")).toBe(false));
  const clipboard = mockClipboardWrites();
  try {
    await interact(() => fireEvent.click(copyLink));
    await waitFor(() => expect(clipboard.writes).toHaveLength(1));
  } finally {
    clipboard.restore();
  }
  const [copied] = clipboard.writes;
  if (!copied) throw new Error("Expected the copied identity link");
  expect(new URL(copied).pathname).toBe(new URL(bobLink).pathname);
  // One click, no rendered URL; the window status bar reports the copy.
  expect(within(bobContacts).queryByRole("textbox")).toBeNull();
  await waitFor(() =>
    expect(
      within(bob)
        .getAllByRole("status")
        .map((s) => s.textContent),
    ).toContain("Successfully copied to clipboard"),
  );

  await openOrgManager(alice);
  const dialog = await openWindowMenuDialog({
    scope: alice,
    dialogName: "Add by Identity Link",
    itemName: "Add by Identity Link",
  });
  const input = within(dialog).getByLabelText("Identity link");
  const before = listProxiedApiRequests().length;
  await interact(() => {
    fireEvent.change(input, { target: { value: mismatchedLink(bobLink) } });
    fillRosterImportNames(dialog);
  });
  await interact(() =>
    fireEvent.click(
      within(dialog).getByRole("button", { name: "Verify and Add" }),
    ),
  );
  await within(dialog).findByText(/identity keys do not match/u);
  expect(
    listProxiedApiRequests()
      .slice(before)
      .filter(
        (request) =>
          request.method === "PUT" && request.url.endsWith("/policy-commit"),
      ),
  ).toHaveLength(0);
  await interact(() =>
    fireEvent.click(within(dialog).getByRole("button", { name: "Cancel" })),
  );
  await importPeerIntoRoster(alice, bobId);
  // The names typed into the dialog seed the new member's roster profile.
  expect(
    (await within(alice).findAllByText("Roster Peer", {}, { timeout: 15_000 }))
      .length,
  ).toBeGreaterThan(0);

  const aliceContacts = await openMiniApp(alice, "Contacts");
  await importMiniAppContact(aliceContacts, bobLink);
  expect(
    await within(aliceContacts).findByRole("heading", {
      name: "Untitled contact",
    }),
  ).toBeTruthy();
  expect(within(aliceContacts).queryByText(bobId)).toBeNull();
}, 120_000);

test("org manager shares your own identity link from your roster row's kebab", async () => {
  browser.happyDOM.setURL("http://localhost/");
  useTestApiAppHandlers();
  const view = renderDualPane();
  const alice = getPaneRoot(view, "left");
  const bob = getPaneRoot(view, "right");
  await waitForDualPaneProvisioning(alice, bob);
  await waitForPersonalBootstrap(2);
  const aliceLink = await createPeerIdentityLink(getPaneUserId(alice));
  const clipboard = mockClipboardWrites();
  try {
    await openOrgManager(alice);
    // The windowed directory has no standalone copy button; the row menu has it.
    expect(
      within(alice).queryByRole("button", { name: "Copy my identity link" }),
    ).toBeNull();
    const roster = await within(alice).findByRole(
      "table",
      { name: "Roster" },
      { timeout: 15_000 },
    );
    const [kebab, ...others] = await within(roster).findAllByRole("button", {
      name: /^Actions for /u,
    });
    expect(others).toHaveLength(0);
    if (!kebab) throw new Error("Expected the roster row's actions button");
    await interact(() => fireEvent.click(kebab));
    const copy = await screen.findByRole(
      "button",
      { name: "Copy identity link" },
      { timeout: 15_000 },
    );
    await interact(() => fireEvent.click(copy));
    await waitFor(() => expect(clipboard.writes).toHaveLength(1));
    expect(new URL(clipboard.writes[0] ?? "").pathname).toBe(
      new URL(aliceLink).pathname,
    );
  } finally {
    clipboard.restore();
  }
}, 120_000);
