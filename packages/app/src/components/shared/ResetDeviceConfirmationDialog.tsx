import { useState } from "react";
import { requestDeviceReset } from "../../providers/device-reset/deviceReset";
import { PhraseConfirmationDialog } from "./PhraseConfirmationDialog";

interface ResetDeviceConfirmationDialogProps {
  readonly onCancel: () => void;
}

/** Confirms a device reset, then restarts the app into it. */
export function ResetDeviceConfirmationDialog({
  onCancel,
}: ResetDeviceConfirmationDialogProps) {
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  return (
    <PhraseConfirmationDialog
      busy={busy}
      error={error}
      confirmLabel={busy ? "Restarting..." : "Reset Device"}
      isOpen
      onCancel={onCancel}
      onConfirm={() => {
        setBusy(true);
        setError(null);
        try {
          requestDeviceReset();
        } catch {
          setBusy(false);
          setError("Could not start the reset: storage is unavailable.");
        }
      }}
      phrase="reset device"
      title="Reset this device"
      warning="This is a non-recoverable operation. It erases everything the app keeps on this device: every identity's keys, databases, and stored files, the PIN, and your preferences. The app then restarts as a fresh install. Data on the server remains; an identity's recovery phrase signs it back in."
    />
  );
}
