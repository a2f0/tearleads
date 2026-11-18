import { useTearleadsRuntime } from "../../providers/sdk/TearleadsProvider";
import { OrgManagerProvider } from "../../stores/org-manager/OrgManagerProvider";
import { AppWindow } from "../AppWindow";
import { LocalKeyringUnlockGate } from "../LocalKeyringUnlockGate";
import { OrgManager } from "./OrgManager";

export function OrgManagerApp() {
  const { domainScope } = useTearleadsRuntime().state;
  return (
    <LocalKeyringUnlockGate appName="Org Manager">
      <AppWindow key={domainScope.id} Provider={OrgManagerProvider}>
        <OrgManager />
      </AppWindow>
    </LocalKeyringUnlockGate>
  );
}
