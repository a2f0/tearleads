import { afterEach, expect, test } from "bun:test";
import { act, cleanup, renderHook } from "@testing-library/react";
import type { ReactNode } from "react";
import {
  useWindowStateData,
  WindowStateProvider,
} from "../window/WindowStateProvider";
import {
  LauncherNavigationProvider,
  useLauncherNavigationActions,
} from "./LauncherNavigationProvider";
import type { LauncherDefinition } from "./launcherDefinition";

const EmptyMiniApp = () => null;

const LAUNCHER: LauncherDefinition<"settings" | "notes"> = {
  apps: {
    notes: { createComponent: () => EmptyMiniApp, title: "Notes" },
    settings: {
      createComponent: () => EmptyMiniApp,
      title: "Settings",
      windowSize: { height: 300, width: 420 },
    },
  },
};

afterEach(() => {
  cleanup();
  window.history.replaceState(null, "", "/");
});

function Providers({ children }: { children: ReactNode }) {
  return (
    <WindowStateProvider>
      <LauncherNavigationProvider definition={LAUNCHER} mode="windowed">
        {children}
      </LauncherNavigationProvider>
    </WindowStateProvider>
  );
}

test("a new window opens at its app's window size, and others keep the default", () => {
  const { result } = renderHook(
    () => ({
      actions: useLauncherNavigationActions(),
      state: useWindowStateData(),
    }),
    { wrapper: Providers },
  );

  act(() => {
    result.current.actions.openMiniApp({ appId: "settings" });
    result.current.actions.openMiniApp({ appId: "notes" });
  });

  const sizes = new Map(
    result.current.state.windows.map((entry) => [entry.appId, entry.size]),
  );
  expect(sizes.get("settings")).toEqual({ height: 300, width: 420 });
  expect(sizes.get("notes")).not.toEqual({ height: 300, width: 420 });
});
