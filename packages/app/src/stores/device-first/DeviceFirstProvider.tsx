import type {
  ContainerContentsWorkflowRuntime,
  LocalProjectionView,
  ReconciliationService,
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
import { useContainerContentsDeviceFirst } from "./useContainerContentsDeviceFirst";

interface DeviceFirstContextValue {
  reconciler: ReconciliationService;
  runtime: ContainerContentsWorkflowRuntime;
  view: LocalProjectionView;
}

const DeviceFirstContext = createContext<DeviceFirstContextValue | null>(null);

export function DeviceFirstProvider({ children }: PropsWithChildren) {
  const appData = useTearleadsRuntime();
  const tearleads = useTearleads();
  const runtime = useMemo(
    () => tearleads.containerContents.workflowRuntime(),
    [appData, tearleads],
  );
  const { reconciler, view } = useContainerContentsDeviceFirst({
    events: appData.state.events,
    logLabel: "Container contents",
    runtime,
  });
  const value = useMemo(
    () => ({ reconciler, runtime, view }),
    [reconciler, runtime, view],
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
