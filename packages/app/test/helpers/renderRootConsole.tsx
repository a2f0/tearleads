import { expect, spyOn } from "bun:test";
import type { Tearleads } from "@tearleads/client-sdk";
import { generateSigningSeedAndKeyPair } from "@tearleads/crypto";
import { WindowMenuProvider, WindowToolBar } from "@tearleads/windowing";
import {
  act,
  fireEvent,
  type RenderResult,
  render,
  waitFor,
  within,
} from "@testing-library/react";
import { Root } from "../../src/mini-apps/root/Root";
import {
  createIdentityManagerHostConfig,
  IdentityManagerTestRuntime,
  TestWebSocket,
} from "./identityManagerTestRuntime";

const TEST_HOST_CONFIG = createIdentityManagerHostConfig();

/**
 * Renders the root console for a logged-in session, root or not, under the
 * window toolbar that carries its Back, Refresh, and Audit activity.
 */
export async function renderRootWithSession(isRoot: boolean): Promise<{
  readonly restore: () => void;
  readonly tearleads: Tearleads;
  readonly view: RenderResult;
}> {
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
      <WindowMenuProvider>
        <WindowToolBar />
        <Root />
      </WindowMenuProvider>
    </IdentityManagerTestRuntime>,
  );
  return {
    tearleads,
    restore: () => Reflect.set(globalThis, "WebSocket", originalWebSocket),
    view,
  };
}

/** The window toolbar the console registers its Back, Refresh, and actions in. */
export function rootToolbar(view: RenderResult) {
  return within(view.getByRole("toolbar", { name: "Toolbar" }));
}

/** Clicks a window toolbar button: Back, Refresh, or Audit activity. */
export function clickRootToolbarButton(view: RenderResult, name: string) {
  fireEvent.click(rootToolbar(view).getByRole("button", { name }));
}

/** Opens Reports, then the report the listing labels `label`. */
export async function openRootReport(
  view: RenderResult,
  label: string,
): Promise<void> {
  fireEvent.click(view.getByRole("button", { name: "Reports" }));
  const listing = await view.findByRole("table", { name: "Reports" });
  fireEvent.click(within(listing).getByRole("button", { name: label }));
}
