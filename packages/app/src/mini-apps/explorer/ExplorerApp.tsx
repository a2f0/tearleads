import { AppWindow } from "../AppWindow";
import { Explorer } from "./Explorer";
import { ExplorerProvider } from "./ExplorerProvider";

export function ExplorerApp() {
  return (
    <AppWindow Provider={ExplorerProvider}>
      <Explorer />
    </AppWindow>
  );
}
