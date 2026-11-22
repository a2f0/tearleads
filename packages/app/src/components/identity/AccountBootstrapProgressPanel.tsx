import { type FormEvent, useState } from "react";
import type { AccountBootstrapCopy } from "../../identity/accountBootstrapPhase";
import { useAutoProvisioningStatus } from "../../identity/autoProvisioningStatus";
import { useRecoveryKeyPrivacy } from "../../identity/useRecoveryKeyPrivacy";
import {
  MiniAppButton,
  MiniAppInput,
  MiniAppStatePanel,
  MiniAppStatus,
  MiniAppTextarea,
  MiniAppToolbar,
} from "../mini-app/MiniAppLayout";
import "./AccountBootstrapProgressPanel.css";
import { RecoveryKeyBackupConfirmation } from "./recovery-key/RecoveryKeyBackupConfirmation";
import { SavedPassphraseButton } from "./SavedPassphraseButton";

function IdentityForm({ copy }: { copy: AccountBootstrapCopy }) {
  const { accountNaming, onboarding, submitAccountName } =
    useAutoProvisioningStatus();
  const restoring = copy.phase === "entering-passphrase";
  const error =
    onboarding && "error" in onboarding.state
      ? onboarding.state.error
      : accountNaming.status === "awaiting"
        ? accountNaming.error
        : undefined;
  const [value, setValue] = useState("");
  // The passphrase the password manager filled in, which a restore does not
  // offer back to it.
  const [picked, setPicked] = useState<string | null>(null);
  useRecoveryKeyPrivacy(() => {
    if (!restoring) return;
    setValue("");
    setPicked(null);
  });
  const submit = (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    if (!value.trim()) return;
    if (onboarding) {
      onboarding.submit(
        restoring ? "entering-passphrase" : "naming-account",
        value,
        { fromKeychain: restoring && value.trim() === picked?.trim() },
      );
    } else if (!restoring) {
      submitAccountName(value);
    }
  };
  return (
    <MiniAppStatePanel description={copy.description} title={copy.title}>
      <form className="identity-onboarding-form" onSubmit={submit}>
        {restoring ? (
          <MiniAppTextarea
            aria-label="Recovery passphrase"
            autoCapitalize="none"
            autoComplete="off"
            autoCorrect="off"
            spellCheck={false}
            rows={3}
            value={value}
            onChange={(event) => setValue(event.currentTarget.value)}
          />
        ) : (
          <MiniAppInput
            aria-label={copy.title}
            autoComplete="nickname"
            onChange={(event) => setValue(event.currentTarget.value)}
            placeholder="Bob"
            value={value}
          />
        )}
        {restoring && (
          <SavedPassphraseButton
            disabled={false}
            onPick={(passphrase) => {
              setValue(passphrase);
              setPicked(passphrase);
            }}
          />
        )}
        <MiniAppToolbar>
          {onboarding && (
            <MiniAppButton
              type="button"
              variant="ghost"
              onClick={() => onboarding.navigate("choosing-identity")}
            >
              Back
            </MiniAppButton>
          )}
          <MiniAppButton disabled={!value.trim()} type="submit">
            {restoring ? "Restore from passphrase" : "Continue"}
          </MiniAppButton>
        </MiniAppToolbar>
      </form>
      {error && (
        <MiniAppStatus role="alert" tone="error">
          {error}
        </MiniAppStatus>
      )}
    </MiniAppStatePanel>
  );
}

export function AccountBootstrapProgressPanel({
  progress,
}: {
  progress: AccountBootstrapCopy;
}) {
  const { onboarding } = useAutoProvisioningStatus();
  if (progress.phase === "choosing-identity" && onboarding) {
    return (
      <MiniAppStatePanel
        description={progress.description}
        title={progress.title}
      >
        <MiniAppToolbar>
          <MiniAppButton onClick={() => onboarding.navigate("naming-account")}>
            Create new identity
          </MiniAppButton>
          <MiniAppButton
            onClick={() => onboarding.navigate("entering-passphrase")}
          >
            Restore identity
          </MiniAppButton>
        </MiniAppToolbar>
      </MiniAppStatePanel>
    );
  }
  if (progress.phase === "confirming-backup" && onboarding) {
    return (
      <RecoveryKeyBackupConfirmation onConfirm={onboarding.confirmBackup} />
    );
  }
  if (
    progress.phase === "naming-account" ||
    progress.phase === "entering-passphrase"
  ) {
    return <IdentityForm key={progress.phase} copy={progress} />;
  }
  return (
    <MiniAppStatePanel
      busy
      description={progress.description}
      title={progress.title}
    />
  );
}
