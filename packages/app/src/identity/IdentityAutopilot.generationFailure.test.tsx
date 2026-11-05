import { afterEach, expect, spyOn, test } from "bun:test";
import * as Crypto from "@tearleads/crypto";
import { waitFor } from "@testing-library/react";
import { AppTestRuntimeScopeProbe } from "../../test/helpers/appRuntimeIdle";
import { MOCK_SERVER_RESET_TIMEOUT_MS } from "../../test/helpers/mswServer";
import {
  cleanupPaneTestEnvironment,
  createTestHostConfig,
  PANE_LONG_ASYNC_TEST_TIMEOUT_MS,
} from "../../test/helpers/paneTestUtils";
import { renderEmptyDesktop } from "../../test/helpers/renderEmptyDesktop";
import { DeveloperModeProvider } from "../providers/developer-mode/DeveloperModeProvider";
import { DualPaneProvider, PaneSideProvider } from "../shell/pane/dual-pane";
import { PaneProvider } from "../shell/pane/runtime/PaneProvider";
import { useAutoProvisioningStatus } from "./autoProvisioningStatus";
import { useAccountBootstrapProgress } from "./useAccountBootstrapProgress";

afterEach(cleanupPaneTestEnvironment, MOCK_SERVER_RESET_TIMEOUT_MS);

function ProvisioningProbe() {
  const { generation } = useAutoProvisioningStatus();
  const progress = useAccountBootstrapProgress();
  return (
    <output data-testid="provisioning">
      {`${generation.status}|${progress?.title ?? "none"}`}
    </output>
  );
}

test(
  "a failed automatic key generation is reported instead of spinning",
  async () => {
    const generate = spyOn(
      Crypto,
      "generateIdentityKeyPairsFromSeedPhrase",
    ).mockImplementation(() => {
      throw new Error("entropy unavailable");
    });
    try {
      const view = renderEmptyDesktop(
        <DeveloperModeProvider>
          <DualPaneProvider>
            <PaneSideProvider side="left">
              <PaneProvider
                hostConfig={createTestHostConfig({
                  autoProvisionIdentity: true,
                })}
              >
                <AppTestRuntimeScopeProbe />
                <ProvisioningProbe />
              </PaneProvider>
            </PaneSideProvider>
          </DualPaneProvider>
        </DeveloperModeProvider>,
      );

      await waitFor(
        () => {
          expect(view.getByTestId("provisioning").textContent).toBe(
            "failed|none",
          );
        },
        { timeout: PANE_LONG_ASYNC_TEST_TIMEOUT_MS },
      );
      expect(generate).toHaveBeenCalled();
      view.unmount();
    } finally {
      generate.mockRestore();
    }
  },
  PANE_LONG_ASYNC_TEST_TIMEOUT_MS * 2,
);
