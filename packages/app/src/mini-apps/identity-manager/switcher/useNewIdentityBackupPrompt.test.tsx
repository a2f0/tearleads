import { afterEach, beforeEach, expect, test } from "bun:test";
import type { Tearleads } from "@tearleads/client-sdk";
import { fireEvent, render, waitFor } from "@testing-library/react";
import { confirmRecoveryKeyBackup } from "../../../../test/helpers/accountNamePrompt";
import {
  cleanupIdentityManagerTestEnvironment,
  createIdentityManagerHostConfig,
  IdentityManagerTestRuntime,
  TestWebSocket,
} from "../../../../test/helpers/identityManagerTestRuntime";
import "../../../../test/helpers/msw/server";
import { MOCK_SERVER_RESET_TIMEOUT_MS } from "../../../../test/helpers/msw/server";
import { IdentityManager } from "../IdentityManager";

const originalWebSocket = globalThis.WebSocket;
beforeEach(() => Reflect.set(globalThis, "WebSocket", TestWebSocket));
afterEach(async () => {
  await cleanupIdentityManagerTestEnvironment();
  Reflect.set(globalThis, "WebSocket", originalWebSocket);
}, MOCK_SERVER_RESET_TIMEOUT_MS);

test("a key pair generated in Identity Manager waits for its backup agreement, even across a reopen", async () => {
  const hostConfig = createIdentityManagerHostConfig();
  const sdk: { current: Tearleads | null } = { current: null };
  const surface = (open: boolean) => (
    <IdentityManagerTestRuntime
      hostConfig={hostConfig}
      onTearleadsReady={(ready) => {
        sdk.current = ready;
      }}
    >
      {open && <IdentityManager />}
    </IdentityManagerTestRuntime>
  );
  const view = render(surface(true));
  fireEvent.click(view.getByRole("button", { name: "General" }));
  fireEvent.click(
    await view.findByRole("button", { name: "Generate Key Pair" }),
  );

  await view.findByRole(
    "heading",
    { name: "Back up your recovery key" },
    { timeout: 10_000 },
  );
  expect(sdk.current?.identity.signingFingerprint).toBeTruthy();
  expect(view.queryByRole("button", { name: "General" })).toBeNull();

  // Closing and reopening the window does not skip the agreement.
  view.rerender(surface(false));
  view.rerender(surface(true));
  await view.findByRole("heading", { name: "Back up your recovery key" });

  await confirmRecoveryKeyBackup(view.container);
  await waitFor(() =>
    expect(
      view.queryByRole("heading", { name: "Back up your recovery key" }),
    ).toBeNull(),
  );
  expect(view.getByRole("button", { name: "General" })).toBeTruthy();
});
