import { type FormEvent, useState } from "react";
import { RECOVERY_KEY_BACKUP_COPY } from "../../../identity/accountBootstrapPhase";
import { useIdentity } from "../../../providers/identity/IdentityProvider";
import {
  MiniAppButton,
  MiniAppStatePanel,
  MiniAppStatus,
} from "../../mini-app/MiniAppLayout";
import {
  isPhraseConfirmed,
  PhraseConfirmationField,
} from "../../shared/PhraseConfirmationField";
import { RecoveryKeyBackupControls } from "./RecoveryKeyBackupControls";
import { useRecoveryKeyDisclosure } from "./useRecoveryKeyDisclosure";

/** Typed to confirm that a new identity's recovery key is backed up. */
export const RECOVERY_KEY_BACKUP_AGREEMENT_PHRASE = "I agree";

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

  return (
    <MiniAppStatePanel
      className="recovery-key-backup-confirmation"
      description={RECOVERY_KEY_BACKUP_COPY.description}
      title={RECOVERY_KEY_BACKUP_COPY.title}
    >
      {error && (
        <MiniAppStatus role="alert" tone="error">
          {error}
        </MiniAppStatus>
      )}
      {status && <MiniAppStatus>{status}</MiniAppStatus>}
      <RecoveryKeyBackupControls
        disclosure={disclosure}
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
    </MiniAppStatePanel>
  );
}
