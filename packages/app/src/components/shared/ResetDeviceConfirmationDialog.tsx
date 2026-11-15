import { useState } from "react";
import { requestDeviceReset } from "../../providers/device-reset/deviceReset";
import { PhraseConfirmationDialog } from "./PhraseConfirmationDialog";

interface ResetDeviceConfirmationDialogProps {
  readonly onCancel: () => void;
}

/** Whether confirming has started the restart, or could not record it. */
type ResetRequestState = "idle" | "restarting" | "failed";

/** Confirms a device reset, then restarts the app into it. */
export function ResetDeviceConfirmationDialog({
  onCancel,
}: ResetDeviceConfirmationDialogProps) {
  const [requestState, setRequestState] = useState<ResetRequestState>("idle");
  const restarting = requestState === "restarting";

  return (
    <PhraseConfirmationDialog
      busy={restarting}
      error={
        requestState === "failed"
          ? "Could not start the reset: storage is unavailable."
          : null
      }
      confirmLabel={restarting ? "Restarting..." : "Reset Device"}
      isOpen
      onCancel={onCancel}
      onConfirm={() => {
        try {
          requestDeviceReset();
          setRequestState("restarting");
        } catch {
          setRequestState("failed");
        }
      }}
      phrase="reset device"
      title="Reset this device"
      warning="This is a non-recoverable operation. It erases everything the app keeps on this device: every identity's keys, databases, and stored files, the PIN, and your preferences. The app then restarts as a fresh install. Data on the server remains; an identity's recovery phrase signs it back in."
    />
  );
}
