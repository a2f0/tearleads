import type {
  ContainerContentsStoreRuntime,
  DeviceFirstContainerContents,
} from "@tearleads/client-sdk";
import {
  createContext,
  type PropsWithChildren,
  useContext,
  useMemo,
} from "react";
import {
  useTearleads,
  useTearleadsRuntime,
} from "../../providers/sdk/TearleadsProvider";
import { useRuntimeScopedMemo } from "../../providers/sdk/useRuntimeScopedMemo";
import { useDeviceFirstBinding } from "./useDeviceFirstBinding";

interface DeviceFirstContextValue extends DeviceFirstContainerContents {
  readonly runtime: ContainerContentsStoreRuntime;
}

const DeviceFirstContext = createContext<DeviceFirstContextValue | null>(null);

export function DeviceFirstProvider({ children }: PropsWithChildren) {
  const appData = useTearleadsRuntime();
  const tearleads = useTearleads();
  const runtime = useRuntimeScopedMemo(
    () => tearleads.containerContents.workflowRuntime(),
    [tearleads],
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
