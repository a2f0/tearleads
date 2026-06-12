import { OrgManagerProvider } from "../../stores/org-manager/OrgManagerProvider";
import { AppWindow } from "../AppWindow";
import { LocalKeyringUnlockGate } from "../LocalKeyringUnlockGate";
import { OrgManager } from "./OrgManager";

export function OrgManagerApp() {
  return (
    <LocalKeyringUnlockGate appName="Org Manager">
      <AppWindow Provider={OrgManagerProvider}>
        <OrgManager />
      </AppWindow>
    </LocalKeyringUnlockGate>
  );
}
