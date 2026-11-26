import { EyeSlashIcon } from "@phosphor-icons/react/dist/csr/EyeSlash";
import { type FormEvent, useState } from "react";
import { RECOVERY_KEY_BACKUP_COPY } from "../../../identity/accountBootstrapPhase";
import { useIdentity } from "../../../providers/identity/IdentityProvider";
import { MiniAppButton, MiniAppStatus } from "../../mini-app/MiniAppLayout";
import {
  isPhraseConfirmed,
  PhraseConfirmationField,
} from "../../shared/PhraseConfirmationField";
import { OnboardingStepPanel } from "../OnboardingStepPanel";
import { RecoveryKeyBackupControls } from "./RecoveryKeyBackupControls";
import { useRecoveryKeyDisclosure } from "./useRecoveryKeyDisclosure";
import "./RecoveryKeyBackupConfirmation.css";

/** Typed to confirm that a new identity's recovery key is backed up. */
export const RECOVERY_KEY_BACKUP_AGREEMENT_PHRASE = "I agree";

/**
 * Shown on a wide screen, in the frame that holds the key once it is revealed
 * (RecoveryKeyBackupConfirmation.css); stacked, the revealed key needs no
 * frame to stand in for.
 */
const HIDDEN_KEY_PLACEHOLDER = (
  <p className="recovery-key-backup-placeholder">
    <EyeSlashIcon aria-hidden size={32} weight="light" />
    <span>Choose View or QR Code to show your recovery key here.</span>
  </p>
);

/**
 * Asks the user to back up a newly created identity's recovery key, then to
 * type an agreement that they have, before `onConfirm` lets them continue.
 * The backup controls ask for their own acknowledgement before the key
 * leaves its hidden state, as they do in Identity Manager.
 */
export function RecoveryKeyBackupConfirmation({
  onConfirm,
}: {
  readonly onConfirm: () => void;
}) {
  const { seedPhrase } = useIdentity();
  const [error, setError] = useState<string | null>(null);
  const [status, setStatus] = useState<string | null>(null);
  const disclosure = useRecoveryKeyDisclosure({ setError, setStatus }, true);
  const [agreement, setAgreement] = useState("");
  const agreed = isPhraseConfirmed(
    agreement,
    RECOVERY_KEY_BACKUP_AGREEMENT_PHRASE,
  );
  const submit = (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    if (agreed) onConfirm();
  };

  // A window, a pane, or the empty desktop can each be wide or narrow on its
  // own, so the layout follows the step's host.
  return (
    <OnboardingStepPanel
      className="recovery-key-backup-confirmation"
      description={RECOVERY_KEY_BACKUP_COPY.description}
      panelClassName="recovery-key-backup-confirmation-panel"
      title={RECOVERY_KEY_BACKUP_COPY.title}
    >
      <RecoveryKeyBackupControls
        disclosure={disclosure}
        feedback={
          error || status ? (
            <div className="recovery-key-backup-feedback">
              {error && (
                <MiniAppStatus role="alert" tone="error">
                  {error}
                </MiniAppStatus>
              )}
              {status && <MiniAppStatus>{status}</MiniAppStatus>}
            </div>
          ) : null
        }
        placeholder={HIDDEN_KEY_PLACEHOLDER}
        seedPhrase={seedPhrase}
      />
      <form className="recovery-key-backup-agreement" onSubmit={submit}>
        <PhraseConfirmationField
          onChange={setAgreement}
          phrase={RECOVERY_KEY_BACKUP_AGREEMENT_PHRASE}
          purpose="to confirm you have saved your recovery key"
          value={agreement}
        />
        <MiniAppButton disabled={!agreed} type="submit">
          Continue
        </MiniAppButton>
      </form>
    </OnboardingStepPanel>
  );
}
