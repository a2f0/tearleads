import { useId, useState } from "react";
import { RecoveryKeyBackupControls } from "../../../components/identity/recovery-key/RecoveryKeyBackupControls";
import {
  type RecoveryKeyFeedback,
  useRecoveryKeyDisclosure,
} from "../../../components/identity/recovery-key/useRecoveryKeyDisclosure";
import {
  MiniAppSection,
  MiniAppSectionHeading,
  MiniAppStatus,
  type MiniAppTabDescriptor,
  MiniAppTabList,
  MiniAppTabPanel,
} from "../../../components/mini-app/MiniAppLayout";
import { useIdentity } from "../../../providers/identity/IdentityProvider";
import { useLocalKeyringLock } from "../../../providers/local-keyring/LocalKeyringLockProvider";
import { useRecoveryKeyRestore } from "../actions/useRecoveryKeyRestore";
import { RecoveryKeyRestoreForm } from "../recovery/RecoveryKeyRestoreForm";

type RecoveryKeyTabId = "backup" | "recovery";
const RECOVERY_KEY_TABS: ReadonlyArray<MiniAppTabDescriptor<RecoveryKeyTabId>> =
  [
    { id: "backup", label: "Backup" },
    { id: "recovery", label: "Recovery" },
  ];

export function IdentityManagerRecoveryKeySection() {
  const { seedPhrase, signingFingerprint } = useIdentity();
  const localKeyringLock = useLocalKeyringLock();
  const idPrefix = useId();
  const [activeTab, setActiveTab] = useState<RecoveryKeyTabId>("backup");
  const [error, setError] = useState<string | null>(null);
  const [status, setStatus] = useState<string | null>(null);
  const feedback: RecoveryKeyFeedback = { setError, setStatus };
  const disclosure = useRecoveryKeyDisclosure(feedback, activeTab === "backup");
  const restore = useRecoveryKeyRestore(feedback);

  return (
    <MiniAppSection>
      <MiniAppSectionHeading>
        <h2>Recovery Key</h2>
      </MiniAppSectionHeading>
      {error && <MiniAppStatus tone="error">{error}</MiniAppStatus>}
      {status && <MiniAppStatus>{status}</MiniAppStatus>}
      <MiniAppTabList
        activeTab={activeTab}
        idPrefix={idPrefix}
        label="Recovery key sections"
        onSelect={(tab) => {
          if (tab === activeTab) return;
          disclosure.hide();
          disclosure.cancelDisclosure();
          setError(null);
          if (tab === "recovery") {
            setStatus(null);
          }
          if (tab !== "recovery") restore.setRestorePassphrase("");
          setActiveTab(tab);
        }}
        tabs={RECOVERY_KEY_TABS}
      />
      <MiniAppTabPanel activeTab={activeTab} idPrefix={idPrefix}>
        {activeTab === "backup" ? (
          <RecoveryKeyBackupControls
            disclosure={disclosure}
            seedPhrase={seedPhrase}
          />
        ) : (
          <RecoveryKeyRestoreForm
            key={signingFingerprint ?? "no-identity"}
            busy={restore.busy}
            canRestore={restore.canRestore}
            identityTransitionInFlight={restore.identityTransitionInFlight}
            localKeyringLocked={localKeyringLock.isLocked}
            onRestore={restore.restoreRecoveryKey}
            restorePassphrase={restore.restorePassphrase}
            setRestorePassphrase={restore.setRestorePassphrase}
          />
        )}
      </MiniAppTabPanel>
    </MiniAppSection>
  );
}
