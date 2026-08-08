import type { PropsWithChildren } from "react";
import { useAppFeatureFlags } from "../../providers/feature-flags/AppFeatureFlagsProvider";
import { ExplorerProvider } from "../../stores/explorer/ExplorerProvider";
import { AppWindow } from "../AppWindow";
import { LocalKeyringUnlockGate } from "../LocalKeyringUnlockGate";
import { Explorer } from "./Explorer";

function ExplorerFeatureFlagProvider({ children }: PropsWithChildren) {
  const { isEnabled } = useAppFeatureFlags();

  return (
    <ExplorerProvider
      showBuiltInSystemContainers={isEnabled("built-in-system-containers")}
    >
      {children}
    </ExplorerProvider>
  );
}

export function ExplorerApp() {
  return (
    <LocalKeyringUnlockGate appName="Explorer">
      <AppWindow Provider={ExplorerFeatureFlagProvider}>
        <Explorer />
      </AppWindow>
    </LocalKeyringUnlockGate>
  );
}
