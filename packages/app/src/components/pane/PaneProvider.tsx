import type { PropsWithChildren } from "react";
import type { AppHostConfig } from "../../host/AppHostConfig";
import { AppRuntimeProvider } from "../../providers/AppRuntimeProvider";

interface PaneProviderProps extends PropsWithChildren {
  hostConfig: AppHostConfig;
}

export function PaneProvider({ children, hostConfig }: PaneProviderProps) {
  return (
    <AppRuntimeProvider hostConfig={hostConfig}>{children}</AppRuntimeProvider>
  );
}
