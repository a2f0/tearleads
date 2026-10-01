import type { PropsWithChildren } from "react";
import {
  useWindowActions,
  useWindowStateData,
  WindowStateProvider,
} from "./index";

export function wrapper({ children }: PropsWithChildren) {
  return <WindowStateProvider>{children}</WindowStateProvider>;
}

export function useWindowStateTestHarness() {
  return {
    actions: useWindowActions(),
    state: useWindowStateData(),
  };
}

interface HookResult {
  current: ReturnType<typeof useWindowStateTestHarness>;
}

export function byTitle(result: HookResult, title: string) {
  const windowEntry = result.current.state.windows.find(
    (entry) => entry.title === title,
  );
  if (!windowEntry) {
    throw new Error(`window "${title}" not found`);
  }
  return windowEntry;
}

export function at(result: HookResult, index: number) {
  const windowEntry = result.current.state.windows[index];
  if (!windowEntry) {
    throw new Error(`no window at index ${index}`);
  }
  return windowEntry;
}
