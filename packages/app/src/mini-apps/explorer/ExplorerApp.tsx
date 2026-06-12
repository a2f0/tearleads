import { ExplorerProvider } from "../../stores/explorer/ExplorerProvider";
import { AppWindow } from "../AppWindow";
import { LocalKeyringUnlockGate } from "../LocalKeyringUnlockGate";
import { Explorer } from "./Explorer";

export function ExplorerApp() {
  return (
    <LocalKeyringUnlockGate appName="Explorer">
      <AppWindow Provider={ExplorerProvider}>
        <Explorer />
      </AppWindow>
    </LocalKeyringUnlockGate>
  );
}
