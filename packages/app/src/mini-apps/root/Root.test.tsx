import "../../../test/helpers/mswServer";
import { afterEach, expect, spyOn, test } from "bun:test";
import type { Tearleads } from "@tearleads/client-sdk";
import { generateSigningSeedAndKeyPair } from "@tearleads/crypto";
import {
  act,
  fireEvent,
  render,
  waitFor,
  within,
} from "@testing-library/react";
import {
  cleanupIdentityManagerTestEnvironment,
  createIdentityManagerHostConfig,
  IdentityManagerTestRuntime,
  TestWebSocket,
} from "../../../test/helpers/identityManagerTestRuntime";
import { ROOT_TEST_IDENTITIES } from "../../../test/helpers/rootConsoleFixtures";
import { Root } from "./Root";

const TEST_HOST_CONFIG = createIdentityManagerHostConfig();

afterEach(async () => {
  await cleanupIdentityManagerTestEnvironment();
});

async function renderRootWithSession(isRoot: boolean) {
  const originalWebSocket = globalThis.WebSocket;
  Reflect.set(globalThis, "WebSocket", TestWebSocket);
  const tearleadsRef: { current: Tearleads | null } = { current: null };
  const view = render(
    <IdentityManagerTestRuntime
      hostConfig={TEST_HOST_CONFIG}
      onTearleadsReady={(sdk) => {
        tearleadsRef.current = sdk;
      }}
    />,
  );
  await waitFor(() => {
    expect(tearleadsRef.current).toBeTruthy();
  });
  const tearleads = tearleadsRef.current;
  if (!tearleads) {
    throw new Error("Expected Tearleads SDK to be available after render.");
  }
  spyOn(tearleads, "requestWebSocketTicket").mockResolvedValue(null);
  await act(async () => {
    // Root standing is bound to the signing identity that logged in, so the
    // session needs a loaded key pair just as a real login would.
    await tearleads.identity.setKeyPairs({
      encapsulationKeyPair: null,
      signingFingerprint: "c".repeat(64),
      signingKeyPair: generateSigningSeedAndKeyPair(),
    });
    tearleads.session.setContext({
      authToken: "test-token",
      containerId: "container-1",
      isAuthenticated: true,
      isRoot,
      organizationId: "org-1",
      userId: "user-1",
    });
  });
  view.rerender(
    <IdentityManagerTestRuntime
      hostConfig={TEST_HOST_CONFIG}
      onTearleadsReady={(sdk) => {
        tearleadsRef.current = sdk;
      }}
    >
      <Root />
    </IdentityManagerTestRuntime>,
  );
  return {
    tearleads,
    restore: () => Reflect.set(globalThis, "WebSocket", originalWebSocket),
    view,
  };
}

test("the root console refuses non-root sessions", async () => {
  const { restore, view } = await renderRootWithSession(false);
  try {
    await waitFor(() => {
      expect(
        view.getByText(/This identity is not a platform operator/),
      ).toBeTruthy();
    });
    expect(view.queryByRole("table", { name: "Identities" })).toBeNull();
  } finally {
    restore();
  }
});

test("the root console lists identities and opens their detail", async () => {
  const { restore, view } = await renderRootWithSession(true);
  try {
    fireEvent.click(view.getByRole("button", { name: "Identities" }));
    const table = await waitFor(() =>
      view.getByRole("table", { name: "Identities" }),
    );
    const [rootIdentity, memberIdentity] = ROOT_TEST_IDENTITIES;
    if (!rootIdentity || !memberIdentity) {
      throw new Error("Expected root test identities.");
    }
    const body = table.querySelector("tbody");
    if (!body) {
      throw new Error("Expected an identities table body.");
    }
    await waitFor(() => {
      expect(within(body).getAllByRole("row")).toHaveLength(2);
    });
    const rows = within(body).getAllByRole("row");
    expect(rows[0]?.textContent).toContain("Yes");
    expect(rows[1]?.textContent).toContain("No");

    fireEvent.click(
      within(table).getByTitle(memberIdentity.signingKeyFingerprint),
    );
    await waitFor(() => {
      expect(view.getByRole("table", { name: "Identity" })).toBeTruthy();
    });
    expect(
      view.getByRole("button", { name: "Copy signing key fingerprint" }),
    ).toBeTruthy();
    await waitFor(() => {
      expect(view.getByRole("table", { name: "Live sessions" })).toBeTruthy();
      expect(view.getByRole("table", { name: "Organizations" })).toBeTruthy();
    });
    expect(view.getByText("Root Test Org (default)")).toBeTruthy();
    expect(view.getByText("trialing")).toBeTruthy();
    expect(view.getAllByText("203.0.113.7").length).toBeGreaterThanOrEqual(2);

    fireEvent.click(view.getByRole("button", { name: "Back" }));
    await waitFor(() => {
      expect(view.getByRole("table", { name: "Identities" })).toBeTruthy();
    });
  } finally {
    restore();
  }
});

test("operators browse organizations, inspect invoices, and traverse both directions", async () => {
  const { restore, view } = await renderRootWithSession(true);
  try {
    fireEvent.click(view.getByRole("button", { name: "Organizations" }));
    const list = await view.findByRole("table", { name: "Organizations" });
    const organization = await within(list).findByText("Root Test Org");
    fireEvent.click(organization);
    await view.findByRole("table", { name: "Organization" });
    fireEvent.click(view.getByRole("tab", { name: "Billing" }));
    const billing = await view.findByRole("table", {
      name: "Organization billing",
    });
    expect(within(billing).getByText("cus_test")).toBeTruthy();
    expect(view.getByRole("table", { name: "Stripe billing" })).toBeTruthy();
    fireEvent.click(view.getByRole("tab", { name: "History" }));
    const history = view.getByText(/INVOICE_PAID/);
    fireEvent.click(history);
    expect(
      view.getByRole("table", { name: "Billing event event-test" }),
    ).toBeTruthy();
    expect(view.getByText(/60[.,]00/)).toBeTruthy();
    fireEvent.click(view.getByRole("tab", { name: "Identities" }));
    const roster = await view.findByRole("table", {
      name: "Organization identities",
    });
    const fingerprint = ROOT_TEST_IDENTITIES[1]?.signingKeyFingerprint;
    if (!fingerprint) throw new Error("Expected member fingerprint");
    fireEvent.click(
      await within(roster).findByRole("button", {
        name: `Open identity ${fingerprint}`,
      }),
    );
    await view.findByRole("table", { name: "Identity" });
    fireEvent.click(view.getByRole("button", { name: "Back" }));
    expect(
      view
        .getByRole("tab", { name: "Identities" })
        .getAttribute("aria-selected"),
    ).toBe("true");
    const refreshedRoster = await view.findByRole("table", {
      name: "Organization identities",
    });
    fireEvent.click(await within(refreshedRoster).findByTitle(fingerprint));
    await view.findByRole("table", { name: "Identity" });
    fireEvent.click(await view.findByText("Root Test Org (default)"));
    await view.findByRole("table", { name: "Organization" });
  } finally {
    restore();
  }
});

test("organization search handles empty results and restores the directory", async () => {
  const { restore, view } = await renderRootWithSession(true);
  try {
    fireEvent.click(view.getByRole("button", { name: "Organizations" }));
    await view.findByText("Root Test Org");
    const input = view.getByRole("textbox", { name: "Search organizations" });
    fireEvent.change(input, { target: { value: "missing" } });
    const form = input.closest("form");
    if (!form) throw new Error("Expected search form");
    fireEvent.submit(form);
    await view.findByText("No organizations found.");
    fireEvent.change(input, { target: { value: "Root Test" } });
    fireEvent.submit(form);
    await view.findByText("Root Test Org");
  } finally {
    restore();
  }
});

test("reports show usage by org, paginate, search, and open the shared usage tab", async () => {
  const { restore, view } = await renderRootWithSession(true);
  try {
    fireEvent.click(view.getByRole("button", { name: "Reports" }));
    const table = await view.findByRole("table", {
      name: "Data usage by organization",
    });
    await within(table).findByText("2.5 KB");
    expect(within(table).getByTitle("2,560 bytes")).toBeTruthy();
    fireEvent.click(await view.findByRole("button", { name: "Load more" }));
    await within(table).findByText("Empty Org");
    expect(within(table).getAllByText("0 B")).toHaveLength(3);
    expect(view.queryByRole("button", { name: "Load more" })).toBeNull();
    const search = view.getByRole("textbox", { name: "Search organizations" });
    fireEvent.change(search, { target: { value: "missing" } });
    const form = search.closest("form");
    if (!form) throw new Error("Expected search form");
    fireEvent.submit(form);
    await within(table).findByText("No organizations found.");
    fireEvent.change(search, { target: { value: "Root Test" } });
    fireEvent.submit(form);
    fireEvent.click(await within(table).findByText("Root Test Org"));
    const tab = view.getByRole("tab", { name: "Data Usage" });
    expect(tab.getAttribute("aria-selected")).toBe("true");
    const panel = view.getByRole("tabpanel", { name: "Data Usage" });
    await within(panel).findByText("2 documents, 4 updates");
    expect(within(panel).getByText("System · Container metadata")).toBeTruthy();
    expect(within(panel).getByText("User · Documents")).toBeTruthy();
    expect(within(panel).getByText("2.5 KB")).toBeTruthy();
    fireEvent.keyDown(tab, { key: "Home" });
    expect(
      view.getByRole("tab", { name: "Overview" }).getAttribute("aria-selected"),
    ).toBe("true");
    await view.findByRole("table", { name: "Organization" });
  } finally {
    restore();
  }
});

test("usage failures show an error and refresh can recover", async () => {
  const { restore, view, tearleads } = await renderRootWithSession(true);
  const usage = spyOn(tearleads.root, "loadOrganizationDataUsage");
  usage.mockResolvedValueOnce({
    ok: false,
    status: 500,
    message: "Usage temporarily unavailable",
  });
  try {
    fireEvent.click(view.getByRole("button", { name: "Organizations" }));
    fireEvent.click(await view.findByText("Root Test Org"));
    fireEvent.click(view.getByRole("tab", { name: "Data Usage" }));
    await view.findByText("Usage temporarily unavailable");
    expect(view.queryByText("0 B")).toBeNull();
    fireEvent.click(view.getByRole("button", { name: "Refresh usage" }));
    await view.findByText("2.5 KB");
  } finally {
    usage.mockRestore();
    restore();
  }
});
