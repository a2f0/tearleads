import { afterEach, expect, spyOn, test } from "bun:test";
import type { Tearleads } from "@tearleads/client-sdk";
import { fireEvent, waitFor, within } from "@testing-library/react";
import { useEffect } from "react";
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

test(
  "an identity switched to while another registers still registers once that settles",
  async () => {
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
    // Identity A's registration hangs until released.
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

    const identityManager = within(await openIdentityManagerFromPane(view));
    fireEvent.click(
      identityManager.getByRole("combobox", { name: "Identities" }),
    );
    fireEvent.click(
      await identityManager.findByText("New Identity", {}, { timeout: 10_000 }),
    );
    // B is fully ready and waits only on A's request.
    let identityB = "";
    await waitFor(
      () => {
        identityB = getPanePublicKey(view);
        expect(identityB).not.toBe(identityA);
        expect(view.getByTestId("bootstrap").textContent).toBe(
          `${identityB}:ready`,
        );
      },
      { timeout: PANE_LONG_ASYNC_TEST_TIMEOUT_MS },
    );
    await waitForPaneRuntimeToSettle(PANE_LONG_ASYNC_TEST_TIMEOUT_MS);
    expect(register).toHaveBeenCalledTimes(1);

    // A's request settles for an identity no longer current; B still registers.
    stalled.resolve(null);
    await waitFor(
      () => {
        expect(register).toHaveBeenCalledTimes(2);
        expect(getPaneStatusText(view)).not.toMatch(/userId:\s*none/u);
      },
      { timeout: PANE_LONG_ASYNC_TEST_TIMEOUT_MS },
    );
    await waitForPaneRuntimeToSettle(PANE_LONG_ASYNC_TEST_TIMEOUT_MS);
    view.unmount();
  },
  PANE_LONG_ASYNC_TEST_TIMEOUT_MS * 3,
);
