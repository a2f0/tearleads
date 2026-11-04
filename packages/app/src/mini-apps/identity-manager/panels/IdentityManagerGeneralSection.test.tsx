import { afterEach, expect, spyOn, test } from "bun:test";
import type { Tearleads } from "@tearleads/client-sdk";
import {
  generateKemSeedAndKeyPair,
  generateSigningSeedAndKeyPair,
  toFingerprint,
} from "@tearleads/crypto";
import {
  act,
  fireEvent,
  type RenderResult,
  render,
  waitFor,
} from "@testing-library/react";
import {
  createIdentityManagerHostConfig,
  IdentityManagerTestRuntime,
  TestWebSocket,
} from "../../../../test/helpers/identityManagerTestRuntime";
import {
  cleanupRecoveryKeyTestEnvironment,
  installClipboardWriteMock,
} from "../../../../test/helpers/recoveryKeyTestKit";
import "../../../../test/helpers/mswServer";
import { MOCK_SERVER_RESET_TIMEOUT_MS } from "../../../../test/helpers/mswServer";
import { saveDeveloperMode } from "../../../providers/developer-mode/DeveloperModeProvider";
import { IdentityManager } from "../IdentityManager";

const APP_URL = "https://app.example.test";
const TEST_HOST_CONFIG = createIdentityManagerHostConfig().withOverrides({
  identityLinkWebUrl: APP_URL,
});
const USER_ID = "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa";
const DEVELOPER_ROWS = [
  "Signing Key",
  "User ID",
  "Organization ID",
  "Container ID",
] as const;

const originalWebSocket = globalThis.WebSocket;

afterEach(async () => {
  Reflect.set(globalThis, "WebSocket", originalWebSocket);
  await cleanupRecoveryKeyTestEnvironment();
}, MOCK_SERVER_RESET_TIMEOUT_MS);

/** Signs in with real local keys and opens the General tab. */
async function renderSignedInGeneralTab(): Promise<{
  signingFingerprint: string;
  tearleads: Tearleads;
  view: RenderResult;
}> {
  Reflect.set(globalThis, "WebSocket", TestWebSocket);
  const tearleadsRef: { current: Tearleads | null } = { current: null };
  const onTearleadsReady = (sdk: Tearleads) => {
    tearleadsRef.current = sdk;
  };
  const view = render(
    <IdentityManagerTestRuntime
      hostConfig={TEST_HOST_CONFIG}
      onTearleadsReady={onTearleadsReady}
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
  tearleads.session.listSessions = async () => [];
  const signingKeyPair = generateSigningSeedAndKeyPair();
  const signingFingerprint = await toFingerprint(
    signingKeyPair.signingPublicKey,
  );
  await act(async () => {
    await tearleads.identity.setKeyPairs({
      encapsulationKeyPair: generateKemSeedAndKeyPair(),
      signingFingerprint,
      signingKeyPair,
    });
    tearleads.session.setContext({
      authToken: "test-token",
      containerId: "container-1",
      isAuthenticated: true,
      organizationId: "org-1",
      userId: USER_ID,
    });
  });

  view.rerender(
    <IdentityManagerTestRuntime
      hostConfig={TEST_HOST_CONFIG}
      onTearleadsReady={onTearleadsReady}
    >
      <IdentityManager />
    </IdentityManagerTestRuntime>,
  );
  fireEvent.click(view.getByRole("button", { name: "General" }));
  return { signingFingerprint, tearleads, view };
}

test("general tab copies the identity link in one click and hides raw identifiers", async () => {
  const clipboardWrites = installClipboardWriteMock();
  const { tearleads, view } = await renderSignedInGeneralTab();
  const expectedLink = await tearleads.userIdentities.createLink(APP_URL);

  expect(view.getByText("Authenticated")).toBeTruthy();
  for (const label of DEVELOPER_ROWS) {
    expect(view.queryByText(label)).toBeNull();
  }
  expect(view.queryByTitle(USER_ID)).toBeNull();
  expect(view.queryByRole("button", { name: "Copy user ID" })).toBeNull();
  await waitFor(() => {
    expect(
      view
        .getByRole("button", { name: "Copy my identity link" })
        .hasAttribute("disabled"),
    ).toBe(false);
  });

  await act(async () => {
    fireEvent.click(
      view.getByRole("button", { name: "Copy my identity link" }),
    );
  });
  // One click copies; the link itself is never rendered.
  expect(view.queryByText(expectedLink)).toBeNull();
  expect(view.queryByRole("textbox")).toBeNull();
  expect(clipboardWrites).toEqual([expectedLink]);
});

test("developer mode reveals and copies the user ID and signing key", async () => {
  saveDeveloperMode("enabled");
  const clipboardWrites = installClipboardWriteMock();
  const { signingFingerprint, view } = await renderSignedInGeneralTab();

  await waitFor(() => {
    expect(view.getByTitle(USER_ID)).toBeTruthy();
  });
  for (const label of DEVELOPER_ROWS) {
    expect(view.getByText(label)).toBeTruthy();
  }
  expect(
    view.getByRole("button", { name: "Copy my identity link" }),
  ).toBeTruthy();

  await act(async () => {
    fireEvent.click(view.getByRole("button", { name: "Copy user ID" }));
  });
  await act(async () => {
    fireEvent.click(
      view.getByRole("button", { name: "Copy signing key fingerprint" }),
    );
  });
  expect(clipboardWrites).toEqual([USER_ID, signingFingerprint]);
});

test("general tab explains the identity link while signed out", async () => {
  Reflect.set(globalThis, "WebSocket", TestWebSocket);
  const view = render(
    <IdentityManagerTestRuntime
      hostConfig={TEST_HOST_CONFIG}
      onTearleadsReady={() => {}}
    >
      <IdentityManager />
    </IdentityManagerTestRuntime>,
  );
  fireEvent.click(await view.findByRole("button", { name: "General" }));

  expect(
    await view.findByText("Sign in to share your identity link."),
  ).toBeTruthy();
  expect(
    view
      .getByRole("button", { name: "Copy my identity link" })
      .hasAttribute("disabled"),
  ).toBe(true);
});
