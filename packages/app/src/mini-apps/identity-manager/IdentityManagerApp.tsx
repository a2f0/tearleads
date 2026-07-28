import { AppWindow } from "../AppWindow";
import { LocalKeyringUnlockGate } from "../LocalKeyringUnlockGate";
import { IdentityManager } from "./IdentityManager";

export function IdentityManagerApp() {
  return (
    <LocalKeyringUnlockGate
      appName="Identity Manager"
      requireLocalIdentity={false}
    >
      <AppWindow>
        <IdentityManager />
      </AppWindow>
    </LocalKeyringUnlockGate>
  );
}
