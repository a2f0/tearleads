import { AppWindow } from "../AppWindow";
import { Explorer } from "./Explorer";
import { ExplorerProvider } from "./providers/ExplorerProvider";

export function ExplorerApp() {
  return (
    <AppWindow Provider={ExplorerProvider}>
      <Explorer />
    </AppWindow>
  );
}
