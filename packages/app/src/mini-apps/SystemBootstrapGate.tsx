import { type PropsWithChildren, useMemo } from "react";
import {
  MiniAppRoot,
  MiniAppSidebar,
  MiniAppStatus,
} from "../components/mini-app/MiniAppLayout";
import {
  useRegisteredWindowSidebar,
  useWindowSidebar,
} from "../components/window/WindowSidebarContext";
import { useSystemBootstrap } from "../providers/system-bootstrap/SystemBootstrapProvider";

export function SystemBootstrapGate({
  children,
  message,
}: PropsWithChildren<{ readonly message: string }>) {
  const { isBootstrapping } = useSystemBootstrap();
  const { setSidebar } = useWindowSidebar();
  const sidebar = useMemo(
    () => (
      <MiniAppSidebar>
        <MiniAppStatus>{message}</MiniAppStatus>
      </MiniAppSidebar>
    ),
    [message],
  );

  useRegisteredWindowSidebar({
    enabled: isBootstrapping,
    setSidebar,
    sidebar,
  });

  if (isBootstrapping) {
    return (
      <MiniAppRoot centered>
        <MiniAppStatus>{message}</MiniAppStatus>
      </MiniAppRoot>
    );
  }

  return children;
}
