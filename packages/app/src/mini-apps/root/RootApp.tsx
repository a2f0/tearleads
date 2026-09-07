import { AppWindow } from "../AppWindow";
import { LocalKeyringUnlockGate } from "../LocalKeyringUnlockGate";
import { Root } from "./Root";

export function RootApp() {
  return (
    <LocalKeyringUnlockGate appName="Root">
      <AppWindow>
        <Root />
      </AppWindow>
    </LocalKeyringUnlockGate>
  );
}
