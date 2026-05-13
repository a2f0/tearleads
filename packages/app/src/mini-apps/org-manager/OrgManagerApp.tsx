import { OrgManagerProvider } from "../../stores/org-manager/OrgManagerProvider";
import { AppWindow } from "../AppWindow";
import { OrgManager } from "./OrgManager";

export function OrgManagerApp() {
  return (
    <AppWindow Provider={OrgManagerProvider}>
      <OrgManager />
    </AppWindow>
  );
}
