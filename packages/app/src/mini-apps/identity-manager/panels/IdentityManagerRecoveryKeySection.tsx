import { useId, useState } from "react";
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
import { RecoveryKeyDisclosureDialog } from "../recovery/RecoveryKeyDisclosureDialog";
import { RecoveryKeyDisplay } from "../recovery/RecoveryKeyDisplay";
import { RecoveryKeyRestoreForm } from "../recovery/RecoveryKeyRestoreForm";
import { useRecoveryKeyDisclosure } from "../recovery/useRecoveryKeyDisclosure";
import {
  type RecoveryKeyFeedback,
  useRecoveryKeyRestore,
} from "../recovery/useRecoveryKeyRestore";

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
  const disclosure = useRecoveryKeyDisclosure(feedback);
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
          disclosure.hide();
          disclosure.cancelDisclosure();
          if (tab !== "recovery") restore.setRestorePassphrase("");
          setActiveTab(tab);
        }}
        tabs={RECOVERY_KEY_TABS}
      />
      <MiniAppTabPanel activeTab={activeTab} idPrefix={idPrefix}>
        {activeTab === "backup" ? (
          <>
            <RecoveryKeyDisplay
              onHide={disclosure.hide}
              onRequestDisclosure={disclosure.requestDisclosure}
              revealed={disclosure.revealed}
              qrRevealed={disclosure.qrRevealed}
              seedPhrase={seedPhrase}
            />
            <RecoveryKeyDisclosureDialog
              onCancel={disclosure.cancelDisclosure}
              onConfirm={disclosure.confirmDisclosure}
              pendingDisclosure={disclosure.pendingDisclosure}
            />
          </>
        ) : (
          <RecoveryKeyRestoreForm
            key={signingFingerprint}
            busy={restore.busy}
            canRestore={restore.canRestore}
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
