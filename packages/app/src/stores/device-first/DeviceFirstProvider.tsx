import type {
  ContainerContentsStoreRuntime,
  DeviceFirstContainerContents,
} from "@symcrypt/client-sdk";
import {
  createContext,
  type PropsWithChildren,
  useContext,
  useMemo,
} from "react";
import {
  useSymCrypt,
  useSymCryptRuntime,
} from "../../providers/sdk/SymCryptProvider";
import { useRuntimeScopedMemo } from "../../providers/sdk/useRuntimeScopedMemo";
import { useDeviceFirstBinding } from "./useDeviceFirstBinding";

interface DeviceFirstContextValue extends DeviceFirstContainerContents {
  readonly runtime: ContainerContentsStoreRuntime;
}

const DeviceFirstContext = createContext<DeviceFirstContextValue | null>(null);

export function DeviceFirstProvider({ children }: PropsWithChildren) {
  const appData = useSymCryptRuntime();
  const symcrypt = useSymCrypt();
  const runtime = useRuntimeScopedMemo(
    () => symcrypt.containerContents.workflowRuntime(),
    [symcrypt],
  );
  const deviceFirst = useDeviceFirstBinding({
    events: appData.state.events,
    logLabel: "Container contents",
    runtime,
  });
  const value = useMemo(
    () => ({ ...deviceFirst, runtime }),
    [deviceFirst, runtime],
  );

  return (
    <DeviceFirstContext.Provider value={value}>
      {children}
    </DeviceFirstContext.Provider>
  );
}

export function useDeviceFirstContainerContents(): DeviceFirstContextValue {
  const context = useContext(DeviceFirstContext);
  if (!context) {
    throw new Error(
      "useDeviceFirstContainerContents must be used within a DeviceFirstProvider.",
    );
  }

  return context;
}
