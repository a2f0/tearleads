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
import { ROOT_TEST_IDENTITIES } from "../../../test/helpers/mswServer";
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
