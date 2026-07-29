import type { PropsWithChildren } from "react";
import { DemoPeerBootstrap } from "../demo/DemoPeerBootstrap";
import type { AppHostConfig } from "../host/AppHostConfig";
import { IdentityAutopilot } from "../identity/IdentityAutopilot";
import { DeviceFirstProvider } from "../stores/device-first/DeviceFirstProvider";
import { BillingProvider } from "./billing/BillingProvider";
import { CryptoSessionProvider } from "./crypto/CryptoSessionProvider";
import { DatabaseProvider } from "./db/DatabaseProvider";
import { DirectCheckoutProvider } from "./direct-checkout/DirectCheckoutProvider";
import { FileSaverProvider } from "./file-saver/FileSaverProvider";
import { FileViewerProvider } from "./file-viewer/FileViewerProvider";
import { AppHostConfigProvider } from "./host/AppHostConfigProvider";
import { IdentityProvider } from "./identity/IdentityProvider";
import { LocalKeyringLockProvider } from "./local-keyring/LocalKeyringLockProvider";
import { LogProvider } from "./logging/LogProvider";
import { PurchasesProvider } from "./purchases/PurchasesProvider";
import { TearleadsProvider } from "./sdk/TearleadsProvider";
import { SyncModeProvider } from "./sync-mode/SyncModeProvider";
import { SystemBootstrapProvider } from "./system-bootstrap/SystemBootstrapProvider";

interface AppRuntimeProviderProps extends PropsWithChildren {
  hostConfig: AppHostConfig;
  /**
   * Whether this runtime's identity autopilot may auto-provision. Defaults to
   * true; the workspace layer passes the workspace's active state so concurrently
   * mounted but inactive workspaces do not provision a second identity.
   */
  autoProvisionEnabled?: boolean | undefined;
}

export function AppRuntimeProvider({
  autoProvisionEnabled = true,
  children,
  hostConfig,
}: AppRuntimeProviderProps) {
  return (
    <AppHostConfigProvider value={hostConfig}>
      <FileSaverProvider>
        <FileViewerProvider>
          <PurchasesProvider>
            <DirectCheckoutProvider>
              <LocalKeyringLockProvider>
                <LogProvider>
                  <SyncModeProvider>
                    <TearleadsProvider>
                      <DatabaseProvider>
                        <IdentityProvider>
                          <CryptoSessionProvider>
                            <DeviceFirstProvider>
                              <SystemBootstrapProvider
                                enabled={autoProvisionEnabled}
                              >
                                <IdentityAutopilot
                                  enabled={autoProvisionEnabled}
                                />
                                {hostConfig.profile.features
                                  .seedPeerIdentities && (
                                  <DemoPeerBootstrap
                                    enabled={autoProvisionEnabled}
                                  />
                                )}
                                <BillingProvider>{children}</BillingProvider>
                              </SystemBootstrapProvider>
                            </DeviceFirstProvider>
                          </CryptoSessionProvider>
                        </IdentityProvider>
                      </DatabaseProvider>
                    </TearleadsProvider>
                  </SyncModeProvider>
                </LogProvider>
              </LocalKeyringLockProvider>
            </DirectCheckoutProvider>
          </PurchasesProvider>
        </FileViewerProvider>
      </FileSaverProvider>
    </AppHostConfigProvider>
  );
}
