import { afterEach, expect, spyOn, test } from "bun:test";
import type { Tearleads } from "@tearleads/client-sdk";
import {
  fireEvent,
  type RenderResult,
  waitFor,
  within,
} from "@testing-library/react";
import { useEffect } from "react";
import { confirmRecoveryKeyBackup } from "../../test/helpers/accountNamePrompt";
import { openIdentityManagerFromPane } from "../../test/helpers/identityPaneTestUtils";
import { MOCK_SERVER_RESET_TIMEOUT_MS } from "../../test/helpers/msw/server";
import {
  cleanupPaneTestEnvironment,
  createSharedMemoryLocalKeyringFactory,
  createTestHostConfig,
  getPanePublicKey,
  getPaneStatusText,
  PANE_LONG_ASYNC_TEST_TIMEOUT_MS,
  renderPane,
  waitForPaneRuntimeToSettle,
  waitForPersistedPaneLocalIdentity,
} from "../../test/helpers/paneTestUtils";
import { compactIdentifier } from "../mini-apps/identity-manager/sessions/IdentityManagerSessionDisplay";
import { useIdentity } from "../providers/identity/IdentityProvider";
import { useTearleads } from "../providers/sdk/TearleadsProvider";
import { useSystemBootstrap } from "../providers/system-bootstrap/SystemBootstrapProvider";

afterEach(cleanupPaneTestEnvironment, MOCK_SERVER_RESET_TIMEOUT_MS);

/** Exposes the SDK and, per identity, whether system bootstrap is ready. */
function Probe({ capture }: { capture: (sdk: Tearleads) => void }) {
  const sdk = useTearleads();
  const { status } = useSystemBootstrap();
  const { signingFingerprint } = useIdentity();
  useEffect(() => capture(sdk), [capture, sdk]);
  return (
    <output data-testid="bootstrap">{`${signingFingerprint}:${status}`}</output>
  );
}

/** Waits for an identity `isExpected` accepts to be current and bootstrapped. */
async function waitForReadyIdentity(
  view: RenderResult,
  isExpected: (fingerprint: string) => boolean,
): Promise<string> {
  let current = "";
  await waitFor(
    () => {
      current = getPanePublicKey(view);
      expect(isExpected(current)).toBe(true);
      expect(view.getByTestId("bootstrap").textContent).toBe(
        `${current}:ready`,
      );
    },
    { timeout: PANE_LONG_ASYNC_TEST_TIMEOUT_MS },
  );
  await waitForPaneRuntimeToSettle(PANE_LONG_ASYNC_TEST_TIMEOUT_MS);
  return current;
}

/**
 * Boots identity A with its registration hanging until released, then
 * creates and switches to a new identity B, which waits behind A's request.
 */
async function switchAwayWhileRegistering() {
  const namespace = `autopilot-switch-${crypto.randomUUID()}`;
  let sdk: Tearleads | undefined;
  const view = renderPane({
    hostConfig: createTestHostConfig({
      autoProvisionIdentity: true,
      createLocalKeyring: createSharedMemoryLocalKeyringFactory(),
      localIdentityNamespace: namespace,
    }),
    children: (
      <Probe
        capture={(captured) => {
          sdk = captured;
        }}
      />
    ),
  });
  if (!sdk) throw new Error("Expected the pane's SDK");
  const stalled = Promise.withResolvers<null>();
  const register = spyOn(
    sdk.session,
    "registerIdentity",
  ).mockImplementationOnce(() => stalled.promise);
  await waitFor(() => expect(register).toHaveBeenCalledTimes(1), {
    timeout: PANE_LONG_ASYNC_TEST_TIMEOUT_MS,
  });
  await waitForPersistedPaneLocalIdentity(namespace);
  const identityA = getPanePublicKey(view);

  const managerWindow = await openIdentityManagerFromPane(view);
  const identityManager = within(managerWindow);
  fireEvent.click(
    identityManager.getByRole("combobox", { name: "Identities" }),
  );
  fireEvent.click(
    await identityManager.findByText("New Identity", {}, { timeout: 10_000 }),
  );
  await waitForReadyIdentity(view, (current) => current !== identityA);
  await confirmRecoveryKeyBackup(managerWindow);
  expect(register).toHaveBeenCalledTimes(1);
  return { identityA, identityManager, register, stalled, view };
}

async function waitForRegisteredAgain(
  view: RenderResult,
  register: { readonly mock: { readonly calls: readonly unknown[] } },
): Promise<void> {
  await waitFor(
    () => {
      expect(register.mock.calls).toHaveLength(2);
      expect(getPaneStatusText(view)).not.toMatch(/userId:\s*none/u);
    },
    { timeout: PANE_LONG_ASYNC_TEST_TIMEOUT_MS },
  );
  await waitForPaneRuntimeToSettle(PANE_LONG_ASYNC_TEST_TIMEOUT_MS);
}

test(
  "an identity switched to while another registers still registers once that settles",
  async () => {
    const { register, stalled, view } = await switchAwayWhileRegistering();
    // A's request settles for an identity no longer current; B registers.
    stalled.resolve(null);
    await waitForRegisteredAgain(view, register);
    view.unmount();
  },
  PANE_LONG_ASYNC_TEST_TIMEOUT_MS * 3,
);

test(
  "an identity switched away from and back while it registers retries once that settles",
  async () => {
    const { identityA, identityManager, register, stalled, view } =
      await switchAwayWhileRegistering();
    fireEvent.click(
      identityManager.getByRole("combobox", { name: "Identities" }),
    );
    fireEvent.click(
      await identityManager.findByRole(
        "option",
        { name: compactIdentifier(identityA) },
        { timeout: 10_000 },
      ),
    );
    await waitForReadyIdentity(view, (current) => current === identityA);

    // A is current again, but its old request belongs to the identity before
    // the switches; it settles stale, and A registers anew.
    stalled.resolve(null);
    await waitForRegisteredAgain(view, register);
    expect(getPanePublicKey(view)).toBe(identityA);
    view.unmount();
  },
  PANE_LONG_ASYNC_TEST_TIMEOUT_MS * 3,
);
