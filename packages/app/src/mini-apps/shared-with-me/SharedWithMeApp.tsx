import { AppWindow } from "../AppWindow";
import { LocalKeyringUnlockGate } from "../LocalKeyringUnlockGate";
import { SHARED_WITH_ME_LABELS } from "./labels";
import { SharedWithMe } from "./SharedWithMe";

export function SharedWithMeApp() {
  return (
    <LocalKeyringUnlockGate appName={SHARED_WITH_ME_LABELS.title}>
      <AppWindow>
        <SharedWithMe />
      </AppWindow>
    </LocalKeyringUnlockGate>
  );
}
