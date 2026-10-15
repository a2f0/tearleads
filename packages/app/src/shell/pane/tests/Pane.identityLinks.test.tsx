import { afterEach, expect, test } from "bun:test";
import { cleanup, fireEvent, waitFor, within } from "@testing-library/react";
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
import { importPeerIntoRoster } from "../../../../test/helpers/dual-pane/dualPaneRosterKit";
import { openOrgManager } from "../../../../test/helpers/dual-pane/dualPaneSharingKit";
import { createPeerIdentityLink } from "../../../../test/helpers/identityLinkFixtures";
import {
  listProxiedApiRequests,
  resetMockServer,
  useTestApiAppHandlers,
} from "../../../../test/helpers/mswServer";
import { waitForPersonalBootstrap } from "../../../../test/helpers/waitForPersonalBootstrap";

afterEach(async () => {
  cleanup();
  globalThis.localStorage.clear();
  window.history.replaceState(null, "", "/");
  await resetMockServer();
});

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
  const browser = window as typeof window & {
    happyDOM: { setURL: (url: string) => void };
  };
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
  const share = await within(bobContacts).findByRole("button", {
    name: "Share my identity link",
  });
  await waitFor(() => expect(share.hasAttribute("disabled")).toBe(false));
  await interact(() => fireEvent.click(share));
  const shared = await within(bobContacts).findByRole("textbox", {
    name: "My identity link",
  });
  if (!(shared instanceof HTMLInputElement))
    throw new Error("Expected a shareable identity link");
  expect(new URL(shared.value).pathname).toBe(new URL(bobLink).pathname);

  await openOrgManager(alice);
  const dialog = await openWindowMenuDialog({
    scope: alice,
    dialogName: "Add by Identity Link",
    itemName: "Add by Identity Link",
  });
  const input = within(dialog).getByLabelText("Identity link");
  const before = listProxiedApiRequests().length;
  await interact(() =>
    fireEvent.change(input, { target: { value: mismatchedLink(bobLink) } }),
  );
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

  const aliceContacts = await openMiniApp(alice, "Contacts");
  await importMiniAppContact(aliceContacts, bobId);
  expect(within(aliceContacts).getByText(bobId)).toBeTruthy();
}, 120_000);
