import {
  type PropsWithChildren,
  useLayoutEffect,
  useMemo,
  useRef,
} from "react";
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

/**
 * Whether the bootstrap panel should stand in for the app right now.
 *
 * This gate blocks an app from *opening* before its system containers exist. It
 * must not also close one that is already open.
 *
 * Bootstrap reports "not bootstrapping" both before its first run starts and
 * after it finishes, and the run cannot start until its inputs are ready — so on
 * a deep link the app renders during that pending window, gets replaced by the
 * panel the moment the run begins, and returns when it ends. That reads as a
 * flash of the app, then a spinner, then the app.
 *
 * Blocking on the pending window instead is not the fix: those inputs never
 * arrive at all for an unauthenticated or local-only session, so the panel would
 * be permanent. Once the app is on screen, let the run finish behind it — no
 * weaker than what already happens while the run is merely pending, and the same
 * reasoning the provider uses to let post-completion re-runs reconcile without
 * blanking an open mini-app.
 *
 * A hook rather than inline state so it can be tested without standing up (or
 * module-mocking) the bootstrap and window-sidebar providers around it.
 */
export function useSystemBootstrapBlocking(isBootstrapping: boolean): boolean {
  const hasRendered = useRef(false);
  const blocking = isBootstrapping && !hasRendered.current;

  // Latched in an effect rather than during render, so only a render that
  // actually committed counts as having shown the app. React may abandon a
  // concurrent render, and latching there would let a later run through on the
  // strength of a render the user never saw — waving past the one case this gate
  // exists to catch.
  useLayoutEffect(() => {
    if (!blocking) {
      hasRendered.current = true;
    }
  }, [blocking]);

  return blocking;
}

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
  const blocking = useSystemBootstrapBlocking(isBootstrapping);

  useRegisteredWindowSidebar({
    enabled: blocking,
    setSidebar,
    sidebar,
  });

  if (blocking) {
    return (
      <MiniAppRoot centered>
        <MiniAppStatus>{message}</MiniAppStatus>
      </MiniAppRoot>
    );
  }

  return children;
}
