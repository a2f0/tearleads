import { expect, spyOn } from "bun:test";
import type { Tearleads } from "@tearleads/client-sdk";
import { generateSigningSeedAndKeyPair } from "@tearleads/crypto";
import {
  act,
  type RenderResult,
  render,
  waitFor,
} from "@testing-library/react";
import { Root } from "../../src/mini-apps/root/Root";
import {
  createIdentityManagerHostConfig,
  IdentityManagerTestRuntime,
  TestWebSocket,
} from "./identityManagerTestRuntime";

const TEST_HOST_CONFIG = createIdentityManagerHostConfig();

/** Renders the root console for a session the server reported as root or not. */
interface RenderedRootConsole {
  readonly restore: () => void;
  readonly tearleads: Tearleads;
  readonly view: RenderResult;
}

export async function renderRootWithSession(
  isRoot: boolean,
): Promise<RenderedRootConsole> {
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
