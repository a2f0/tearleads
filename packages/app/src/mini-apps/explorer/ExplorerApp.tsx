import { ExplorerProvider } from "../../stores/explorer/ExplorerProvider";
import { AppWindow } from "../AppWindow";
import { Explorer } from "./Explorer";

export function ExplorerApp() {
  return (
    <AppWindow Provider={ExplorerProvider}>
      <Explorer />
    </AppWindow>
  );
}
