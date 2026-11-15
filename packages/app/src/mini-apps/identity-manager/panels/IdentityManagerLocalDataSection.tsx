import { useState } from "react";
import {
  MiniAppButton,
  MiniAppSection,
  MiniAppSectionHeading,
  MiniAppStatus,
} from "../../../components/mini-app/MiniAppLayout";
import { ResetDeviceConfirmationDialog } from "../../../components/shared/ResetDeviceConfirmationDialog";

export function IdentityManagerLocalDataSection() {
  const [confirmingReset, setConfirmingReset] = useState(false);

  return (
    <MiniAppSection>
      <MiniAppSectionHeading>
        <h2>Local Data</h2>
      </MiniAppSectionHeading>
      <MiniAppStatus>
        This device keeps your identities and their keys, the PIN, local
        databases, stored files, and app preferences.
      </MiniAppStatus>
      <div className="identity-manager-danger-zone">
        <div className="identity-manager-danger-zone-copy">
          <strong>Reset this device</strong>
          <MiniAppStatus as="span">
            Erases all local data and restarts the app as a fresh install.
          </MiniAppStatus>
        </div>
        <MiniAppButton
          onClick={() => setConfirmingReset(true)}
          variant="danger"
        >
          Reset Device
        </MiniAppButton>
      </div>
      {confirmingReset && (
        <ResetDeviceConfirmationDialog
          onCancel={() => setConfirmingReset(false)}
        />
      )}
    </MiniAppSection>
  );
}
