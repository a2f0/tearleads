import { AppWindow } from "../AppWindow";
import { LocalKeyringUnlockGate } from "../LocalKeyringUnlockGate";
import { BackupRestore } from "./BackupRestore";

export function BackupRestoreApp() {
  return (
    <LocalKeyringUnlockGate appName="Backup / Restore">
      <AppWindow>
        <BackupRestore />
      </AppWindow>
    </LocalKeyringUnlockGate>
  );
}
