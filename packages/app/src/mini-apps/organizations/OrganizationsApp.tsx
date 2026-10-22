import { AppWindow } from "../AppWindow";
import { LocalKeyringUnlockGate } from "../LocalKeyringUnlockGate";
import { ORGANIZATIONS_LABELS } from "./labels";
import { Organizations } from "./Organizations";

export function OrganizationsApp() {
  return (
    <LocalKeyringUnlockGate appName={ORGANIZATIONS_LABELS.title}>
      <AppWindow>
        <Organizations />
      </AppWindow>
    </LocalKeyringUnlockGate>
  );
}
