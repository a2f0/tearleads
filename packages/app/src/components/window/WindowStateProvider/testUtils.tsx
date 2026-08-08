import type { PropsWithChildren } from "react";
import type { WindowStateData } from "./index";
import { WindowStateProvider } from "./index";

export function wrapper({ children }: PropsWithChildren) {
  return <WindowStateProvider>{children}</WindowStateProvider>;
}

interface HookResult {
  current: { state: WindowStateData };
}

export function byTitle(result: HookResult, title: string) {
  const windowEntry = result.current.state.windows.find(
    (entry: { title: string }) => entry.title === title,
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
