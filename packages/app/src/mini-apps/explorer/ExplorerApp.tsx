import type { PropsWithChildren } from "react";
import { useAppFeatureFlags } from "../../providers/feature-flags/AppFeatureFlagsProvider";
import { ExplorerProvider } from "../../stores/explorer/ExplorerProvider";
import { AppWindow } from "../AppWindow";
import { LocalKeyringUnlockGate } from "../LocalKeyringUnlockGate";
import { Explorer } from "./Explorer";

function ExplorerFeatureFlagProvider({ children }: PropsWithChildren) {
  const { builtInSystemContainersVisible } = useAppFeatureFlags();

  return (
    <ExplorerProvider
      showBuiltInSystemContainers={builtInSystemContainersVisible}
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
